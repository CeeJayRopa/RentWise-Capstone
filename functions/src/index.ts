import { setGlobalOptions } from "firebase-functions";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { https as httpsV1 } from "firebase-functions/v1";

export { sendPaymentReminders } from "./reminderScheduler";
export { sendPushOnNotification } from "./pushNotifications";
export { notifyAdminsOnPayment } from "./paymentNotifier";
export { cleanupOldDailyReports } from "./reportCleanup";

import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

// Firebase Admin initialization
initializeApp();

const db = getFirestore();
const auth = getAuth();

// Limit instances
setGlobalOptions({
  maxInstances: 10,
});

// =====================================
// ADMIN AUTH CHECK
// =====================================

/**
 * Throws if the given uid does not belong to an admin user.
 * @param {string} uid - The Firebase Auth UID to check.
 */
async function assertIsAdmin(uid: string) {
  const adminDoc = await db.collection("users").doc(uid).get();

  if (!adminDoc.exists) {
    throw new HttpsError("permission-denied", "User does not exist");
  }

  const data = adminDoc.data();

  if (data?.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin access required");
  }
}

/**
 * Throws if the given uid does not belong to an owner user.
 * @param {string} uid - The Firebase Auth UID to check.
 */
async function assertIsOwner(uid: string) {
  const ownerDoc = await db.collection("users").doc(uid).get();

  if (!ownerDoc.exists) {
    throw new HttpsError("permission-denied", "User does not exist");
  }

  const data = ownerDoc.data();

  if (data?.role !== "owner") {
    throw new HttpsError("permission-denied", "Owner access required");
  }
}

/**
 * Throws if the given uid does not belong to an admin or owner user. Owner
 * is the supervisory role over admin, so it's granted the same account
 * management access (archive restore/delete).
 * @param {string} uid - The Firebase Auth UID to check.
 */
async function assertIsAdminOrOwner(uid: string) {
  const userDoc = await db.collection("users").doc(uid).get();

  if (!userDoc.exists) {
    throw new HttpsError("permission-denied", "User does not exist");
  }

  const role = userDoc.data()?.role;

  if (role !== "admin" && role !== "owner") {
    throw new HttpsError("permission-denied", "Admin or owner access required");
  }
}

// =====================================
// RATE LIMITING
// Cloud Functions v2 onCall has no built-in per-caller throttling, and this
// project has no App Check/API gateway in front of it, so without this a
// script can call any endpoint as fast as it wants. Firestore-backed
// fixed-window counter, keyed per-endpoint + per-identity (authenticated
// uid, or the target identifier for pre-auth lookups so a specific
// account/email can't be hammered). Not a substitute for real
// infrastructure-level protection (e.g. Cloud Armor) at real scale, but
// stops naive scripted abuse of a single endpoint.
// =====================================
async function checkRateLimit(key: string, maxAttempts: number, windowMs: number) {
  const ref = db.collection("rateLimits").doc(key);
  const now = Date.now();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists
      ? (snap.data() as { count: number; windowStart: number })
      : null;

    if (!data || now - data.windowStart > windowMs) {
      tx.set(ref, { count: 1, windowStart: now });
      return;
    }

    if (data.count >= maxAttempts) {
      throw new HttpsError(
        "resource-exhausted",
        "Too many attempts. Please try again later.",
      );
    }

    tx.update(ref, { count: FieldValue.increment(1) });
  });
}

// =====================================
// CREATE TENANT ACCOUNT
// =====================================

export const adminCreateTenant = onCall(async (request) => {
  const adminUid = request.auth?.uid;

  if (!adminUid) {
    throw new HttpsError("unauthenticated", "You must be logged in");
  }

  await assertIsAdmin(adminUid);

  const { firstName, lastName, username, contactNo, password, stallId } =
    request.data;

  if (!firstName || !lastName || !username || !password || !stallId) {
    throw new HttpsError("invalid-argument", "Missing required fields");
  }

  const email = `${username}@rentwise.app`;

  let createdUser;

  try {
    // Create Firebase Auth account

    createdUser = await auth.createUser({
      email,
      password,
    });

    const batch = db.batch();

    // users/{uid}

    const userRef = db.collection("users").doc(createdUser.uid);

    batch.set(userRef, {
      firstName,

      lastName,

      username,

      email,

      contactNo,

      role: "tenant",

      stallId,

      status: "active",

      createdAt: FieldValue.serverTimestamp(),
    });

    // update stall

    const stallRef = db.collection("stalls").doc(stallId);

    batch.update(stallRef, {
      tenantId: createdUser.uid,

      status: "occupied",
    });

    await batch.commit();

    return {
      success: true,

      uid: createdUser.uid,
    };
  } catch (error) {
    // rollback Auth account
    if (createdUser) {
      await auth.deleteUser(createdUser.uid);
    }

    console.error(error);

    throw new HttpsError(
      "internal",

      "Failed creating tenant",
    );
  }
});

// =====================================
// RESET TENANT PASSWORD
// =====================================

export const adminResetTenantPassword = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  await checkRateLimit(`adminResetTenantPassword:${callerUid}`, 20, 60 * 60_000);

  const { uid, newPassword } = request.data as { uid: string; newPassword: string };
  if (!uid || !newPassword) {
    throw new HttpsError("invalid-argument", "Missing password data");
  }

  // Verify caller is an admin using the caller's OWN verified auth identity
  // (request.auth.uid, set by Firebase from the caller's ID token) -- NOT a
  // client-supplied uid. Trusting a client-supplied "callerUid" field here
  // used to let anyone claim to be any admin and reset any tenant's
  // password; see CAPSTONE_NOTES.txt for the full writeup.
  await assertIsAdmin(callerUid);

  await auth.updateUser(uid, { password: newPassword });

  return { success: true };
});

// =====================================
// SYNC PERSONAL EMAIL (self-service, any role)
// =====================================
// Lets a tenant or admin add/replace their own real email — this becomes
// their actual Firebase Auth sign-in email, which is what enables
// self-service password reset (Firebase always emails whatever address is
// currently on the Auth account). No elevated role required: this only ever
// acts on the caller's own account, never someone else's.

export const syncPersonalEmail = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  await checkRateLimit(`syncPersonalEmail:${callerUid}`, 10, 60 * 60_000);

  // Uses the caller's OWN verified auth identity (request.auth.uid) --
  // previously trusted a client-supplied "callerUid" field instead, which
  // let anyone change ANY account's login email (and from there, take it
  // over via a normal password reset). See CAPSTONE_NOTES.txt.
  const { personalEmail } = request.data as { personalEmail: string };

  if (!personalEmail) {
    throw new HttpsError("invalid-argument", "Missing email data");
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(personalEmail)) {
    throw new HttpsError("invalid-argument", "Invalid email address");
  }

  const userDoc = await db.collection("users").doc(callerUid).get();
  if (!userDoc.exists) {
    throw new HttpsError("permission-denied", "User does not exist");
  }

  try {
    // Firebase Auth itself enforces email uniqueness across all accounts.
    await auth.updateUser(callerUid, { email: personalEmail });
  } catch (error) {
    const authError = error as { code?: string };
    if (authError?.code === "auth/email-already-exists") {
      throw new HttpsError(
        "already-exists",
        "That email is already in use by another account.",
      );
    }
    throw error;
  }

  await db.collection("users").doc(callerUid).update({
    email: personalEmail,
    personalEmail,
  });

  return { success: true };
});

// =====================================
// RESET ADMIN PASSWORD (owner-only)
// =====================================

export const ownerResetAdminPassword = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  await checkRateLimit(`ownerResetAdminPassword:${callerUid}`, 20, 60 * 60_000);

  const { uid, newPassword } = request.data as { uid: string; newPassword: string };
  if (!uid || !newPassword) {
    throw new HttpsError("invalid-argument", "Missing password data");
  }

  // Verify caller is an owner using the caller's OWN verified auth identity
  // (request.auth.uid) -- NOT a client-supplied uid. See CAPSTONE_NOTES.txt.
  await assertIsOwner(callerUid);

  // Verify the target account is actually an admin, not an arbitrary user
  await assertIsAdmin(uid);

  await auth.updateUser(uid, { password: newPassword });

  return { success: true };
});

// =====================================
// UPDATE ADMIN PROFILE (owner-only)
// =====================================
// The admin's Firestore doc isn't the owner's own doc, so a direct client
// updateDoc() is rejected by security rules — same reason the password
// reset above has to go through the Admin SDK.

export const ownerUpdateAdminProfile = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  await checkRateLimit(`ownerUpdateAdminProfile:${callerUid}`, 30, 60 * 60_000);

  const { uid, firstName, lastName, username, contactNo } = request.data as {
    uid: string;
    firstName: string;
    lastName: string;
    username: string;
    contactNo: string;
  };

  if (!uid || !firstName || !lastName || !username || !contactNo) {
    throw new HttpsError("invalid-argument", "Missing profile data");
  }

  // Verify caller is an owner using the caller's OWN verified auth identity
  // (request.auth.uid) -- NOT a client-supplied uid. See CAPSTONE_NOTES.txt.
  await assertIsOwner(callerUid);
  await assertIsAdmin(uid);

  const dupeSnap = await db
    .collection("users")
    .where("username", "==", username)
    .where("role", "==", "admin")
    .get();
  if (dupeSnap.docs.some((d) => d.id !== uid)) {
    throw new HttpsError("already-exists", "This username is already in use.");
  }

  await db.collection("users").doc(uid).update({
    firstName,
    lastName,
    username,
    contactNo,
  });

  return { success: true };
});

// =====================================
// ENABLE / DISABLE ACCOUNT
// =====================================

export const adminSetAccountDisabled = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  await checkRateLimit(`adminSetAccountDisabled:${callerUid}`, 30, 60 * 60_000);

  const { uid, disabled } = request.data as { uid: string; disabled: boolean };

  if (!uid || typeof disabled !== "boolean") {
    throw new HttpsError("invalid-argument", "Missing account data");
  }

  // Admin or owner can enable/disable a tenant's login access. Verified via
  // the caller's OWN auth identity (request.auth.uid), not a client-supplied
  // uid. See CAPSTONE_NOTES.txt.
  await assertIsAdminOrOwner(callerUid);

  await auth.updateUser(uid, { disabled });

  // `disabled` alone only blocks NEW sign-ins — a tenant already signed in
  // on their device keeps a valid ID token (and can keep using the app)
  // until it naturally expires. Revoking refresh tokens forces Firebase to
  // reject the next refresh, so the session actually dies once archived.
  if (disabled) {
    await auth.revokeRefreshTokens(uid);
  }

  return { success: true };
});

// =====================================
// CREATE PAYMONGO CHECKOUT SESSION
// =====================================

export const createPaymongoCheckout = httpsV1.onCall(
  async (data: { amount: number }, context: httpsV1.CallableContext) => {
    const uid = context.auth?.uid;

    if (!uid) {
      throw new httpsV1.HttpsError("unauthenticated", "Login required");
    }

    const { amount } = data;

    if (!amount || Number(amount) <= 0) {
      throw new httpsV1.HttpsError("invalid-argument", "Invalid amount");
    }

    const amountInCentavos = Math.round(Number(amount) * 100);
    const secretKey = process.env.PAYMONGO_SECRET_KEY ?? "";
    const encoded = Buffer.from(`${secretKey}:`).toString("base64");

    const response = await fetch(
      "https://api.paymongo.com/v1/checkout_sessions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${encoded}`,
        },
        body: JSON.stringify({
          data: {
            attributes: {
              line_items: [
                {
                  currency: "PHP",
                  amount: amountInCentavos,
                  name: "RentWise Online Rent Payment",
                  quantity: 1,
                },
              ],
              payment_method_types: ["gcash", "paymaya"],
              description: "RentWise Online Rent Payment",
              success_url: "rentwise://payment-success",
              cancel_url: "rentwise://payment-cancel",
            },
          },
        }),
      },
    );

    if (!response.ok) {
      const errBody = (await response.json()) as Record<string, unknown>;
      console.error("PayMongo error:", errBody);
      throw new httpsV1.HttpsError(
        "internal",
        "Failed to create checkout session",
      );
    }

    const parsed = (await response.json()) as {
      data: { id: string; attributes: { checkout_url: string } };
    };

    return {
      checkoutSessionId: parsed.data.id,
      checkoutUrl: parsed.data.attributes.checkout_url,
    };
  },
);

// ── BLAZE PLAN ONLY ──────────────────────────────────────────────────────────
// After capstone defense: delete this entire function and downgrade Firebase
// to Spark plan. Also remove the BLAZE PLAN block in
// rentwise-admin/shared/services/accountServices.ts and uncomment the
// FREE PLAN block in that same file.
// ─────────────────────────────────────────────────────────────────────────────
export const adminDeleteTenant = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  await checkRateLimit(`adminDeleteTenant:${callerUid}`, 30, 60 * 60_000);

  const { uid } = request.data as { uid: string };

  if (!uid) {
    throw new HttpsError("invalid-argument", "Missing required fields");
  }

  // Admin or owner can permanently delete an archived tenant. Verified via
  // the caller's OWN auth identity (request.auth.uid), not a client-supplied
  // uid. See CAPSTONE_NOTES.txt.
  await assertIsAdminOrOwner(callerUid);

  // Delete Firebase Auth account — silently ignore if already gone
  try {
    await auth.deleteUser(uid);
  } catch (err: any) {
    if (err?.errorInfo?.code !== "auth/user-not-found") {
      throw new HttpsError("internal", "Failed to delete auth account");
    }
  }

  return { success: true };
});

// =====================================
// OWNER SECURITY-QUESTION PASSWORD RECOVERY
// Owner has no one above them to review a reset request (unlike
// tenant→admin and admin→owner), so this is fully self-service: set up 3
// security questions in advance, and answering them correctly on the
// forgot-password screen reveals the current password. All reads/writes of
// the `ownerRecovery` collection go through these functions (Admin SDK) —
// the client never touches that collection directly.
// =====================================

export const ownerSaveSecurityQuestions = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  await checkRateLimit(`ownerSaveSecurityQuestions:${callerUid}`, 10, 60 * 60_000);

  const { securityQuestions } = request.data as {
    securityQuestions: { question: string; answer: string }[];
  };

  if (
    !Array.isArray(securityQuestions) ||
    securityQuestions.length !== 3 ||
    securityQuestions.some((q) => !q.question || !q.answer)
  ) {
    throw new HttpsError("invalid-argument", "Missing security question data");
  }

  // Verified via the caller's OWN auth identity (request.auth.uid) -- a
  // client-supplied "callerUid" here used to let anyone overwrite ANY
  // owner's recovery security questions with their own answers, then use
  // those to obtain a real password-reset link for that owner's account.
  // See CAPSTONE_NOTES.txt.
  await assertIsOwner(callerUid);

  // The client re-authenticates with the owner's current password via
  // Firebase Auth (see owner-profile.tsx) immediately before calling this —
  // that's the real verification, so nothing about the password itself
  // needs to travel here or ever be stored. Only the security Q&A is kept.
  await db.collection("ownerRecovery").doc(callerUid).set({
    securityQuestions,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { success: true };
});

export const getOwnerSecurityQuestions = onCall(async () => {
  await checkRateLimit("getOwnerSecurityQuestions:global", 30, 5 * 60_000);

  // There's only ever one owner account, so recovery skips identifying an
  // account by email/username — tapping "Forgot password" goes straight to
  // whichever owner has security questions set up.
  const recoverySnap = await db.collection("ownerRecovery").limit(1).get();

  if (recoverySnap.empty) {
    throw new HttpsError(
      "not-found",
      "No security questions have been set up for this account yet.",
    );
  }

  const ownerDoc = recoverySnap.docs[0];
  const stored = (ownerDoc.data()?.securityQuestions ?? []) as {
    question: string;
  }[];

  return { ownerId: ownerDoc.id, questions: stored.map((q) => q.question) };
});

export const verifyOwnerSecurityAnswers = onCall(async (request) => {
  const { ownerId, answers } = request.data as {
    ownerId: string;
    answers: string[];
  };

  if (!ownerId || !Array.isArray(answers) || answers.length !== 3) {
    throw new HttpsError("invalid-argument", "Missing answers.");
  }
  // Keyed per-ownerId (not per-caller, since there's no caller identity yet)
  // so guessing security answers can't be scripted.
  await checkRateLimit(`verifyOwnerSecurityAnswers:${ownerId}`, 5, 15 * 60_000);

  const recoverySnap = await db.collection("ownerRecovery").doc(ownerId).get();
  if (!recoverySnap.exists) {
    throw new HttpsError("not-found", "No security questions found for this account.");
  }

  const stored = (recoverySnap.data()?.securityQuestions ?? []) as {
    question: string;
    answer: string;
  }[];

  const normalize = (s: string) => (s ?? "").trim().toLowerCase();
  const allMatch =
    stored.length === 3 &&
    stored.every((q, i) => normalize(q.answer) === normalize(answers[i]));

  if (!allMatch) {
    throw new HttpsError("permission-denied", "One or more answers are incorrect.");
  }

  // Same approach as generateTenantResetLink below: a real, one-time-use
  // Firebase password-reset code, handed to the owner's own in-app "choose
  // a new password" screen — nothing about the owner's actual password is
  // ever stored or read here, only a fresh reset code is generated.
  const ownerRecord = await auth.getUser(ownerId);
  if (!ownerRecord.email) {
    throw new HttpsError("failed-precondition", "This account has no email on file.");
  }
  const link = await auth.generatePasswordResetLink(ownerRecord.email, {
    url: "https://rentwise-capstone-project.web.app/reset-password",
    handleCodeInApp: true,
  });
  const oobCode = new URL(link).searchParams.get("oobCode");

  return { oobCode, email: ownerRecord.email };
});

// Owner notifications are now created explicitly by the admin FAB
// "Apply Changes" button — see rentwise-admin/app/components/UpdatesReportFAB.tsx.

// =====================================
// TENANT SELF-SERVICE PASSWORD RESET (in-app, no real email round-trip)
// Generates a real Firebase password-reset link via the Admin SDK WITHOUT
// sending it anywhere — the tenant app opens it directly in its own
// in-app WebView instead of making an elderly tenant go check email.
// Trade-off (capstone scope): knowing a tenant's personal email is enough
// to reset their password here, since there's no inbox-possession check
// anymore. See CAPSTONE_NOTES.txt.
// =====================================
export const generateTenantResetLink = onCall(async (request) => {
  const { email } = request.data as { email: string };
  if (!email) throw new HttpsError("invalid-argument", "Email is required.");
  await checkRateLimit(`generateTenantResetLink:${email}`, 5, 15 * 60_000);

  const snap = await db
    .collection("users")
    .where("personalEmail", "==", email)
    .where("role", "==", "tenant")
    .limit(1)
    .get();

  if (snap.empty) {
    throw new HttpsError("not-found", "No tenant account found with this email.");
  }

  // The Admin SDK only returns a full link, not the raw code — but this
  // flow never loads that URL anywhere (no email, no WebView), so we just
  // extract the oobCode from it and hand that to the tenant app's own
  // native reset-password screen instead.
  const link = await auth.generatePasswordResetLink(email, {
    url: "https://rentwise-capstone-project.web.app/reset-password",
    handleCodeInApp: true,
  });
  const oobCode = new URL(link).searchParams.get("oobCode");

  return { oobCode };
});

// =====================================
// PRE-AUTH USER LOOKUPS (server-side, narrow-response versions of what
// used to be direct client-side Firestore reads against `users`). These
// exist so `firestore.rules` can require auth on `users` get/list without
// breaking login or forgot-password, which all run before the user is
// signed in. Each returns only the minimum field(s) the caller actually
// needs -- never the full user document -- unlike the old client-side
// `getUserByUsername()`/inline queries this replaces.
// =====================================

// Owner/admin login screens accept either a username or a raw email. This
// resolves a username to its account email so the client can hand it to
// signInWithEmailAndPassword; a null result just means "treat the input as
// a raw email instead", not an error -- the client already falls back to
// that.
export const resolveLoginEmail = onCall(async (request) => {
  const { identifier, role } = request.data as { identifier: string; role: string };
  if (!identifier || !role) {
    throw new HttpsError("invalid-argument", "Identifier and role are required.");
  }
  await checkRateLimit(`resolveLoginEmail:${role}:${identifier}`, 15, 5 * 60_000);

  // Two field-name conventions exist in the data (see the old
  // getUserByUsername for why) -- try both.
  const q1 = await db
    .collection("users")
    .where("username", "==", identifier)
    .where("role", "==", role)
    .limit(1)
    .get();
  if (!q1.empty) return { email: q1.docs[0].data().email ?? null };

  const q2 = await db
    .collection("users")
    .where("userName", "==", identifier)
    .where("role", "==", role)
    .limit(1)
    .get();
  if (!q2.empty) return { email: q2.docs[0].data().email ?? null };

  return { email: null };
});

export const tenantForgotPassword = onCall(async (request) => {
  const { email } = request.data as { email: string };
  if (!email) throw new HttpsError("invalid-argument", "Email is required.");
  await checkRateLimit(`tenantForgotPassword:${email}`, 5, 15 * 60_000);

  const snap = await db
    .collection("users")
    .where("email", "==", email)
    .where("role", "==", "tenant")
    .limit(1)
    .get();

  if (snap.empty) {
    throw new HttpsError("not-found", "No account found with this email.");
  }

  const matched = snap.docs[0];
  const data = matched.data();

  if (data.personalEmail) {
    // Same approach as generateTenantResetLink above: a real, one-time-use
    // reset code handed straight to the tenant app's own reset screen.
    const link = await auth.generatePasswordResetLink(data.personalEmail, {
      url: "https://rentwise-capstone-project.web.app/reset-password",
      handleCodeInApp: true,
    });
    const oobCode = new URL(link).searchParams.get("oobCode");
    return { method: "self-service", oobCode };
  }

  // No personal email on file -- fall back to a manual request the admin
  // handles. Written here (Admin SDK) instead of client-side so the client
  // never needs to read firstName/lastName/spaceId off the users doc itself.
  await db.collection("passwordResetRequests").add({
    email,
    tenantId: matched.id,
    tenantName: `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim(),
    spaceId: data.spaceId ?? data.stallId ?? "",
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
  });
  return { method: "manual" };
});

export const adminForgotPassword = onCall(async (request) => {
  const { email } = request.data as { email: string };
  if (!email) throw new HttpsError("invalid-argument", "Email is required.");
  await checkRateLimit(`adminForgotPassword:${email}`, 5, 15 * 60_000);

  const snap = await db
    .collection("users")
    .where("email", "==", email)
    .where("role", "==", "admin")
    .limit(1)
    .get();

  if (snap.empty) {
    throw new HttpsError("not-found", "No admin account found with this email.");
  }

  const matched = snap.docs[0];
  const data = matched.data();

  // Admin password resets always go to the owner to handle manually -- no
  // self-service path, by design (an admin account resetting itself isn't
  // something to automate).
  await db.collection("passwordResetRequests").add({
    email,
    tenantId: matched.id,
    tenantName: `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim(),
    requestedRole: "admin",
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});
