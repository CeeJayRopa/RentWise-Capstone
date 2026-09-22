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
import { createHash, randomInt, timingSafeEqual } from "crypto";

import {
  normalizePhilippinePhone,
  semaphoreApiKey,
  sendSMSWithRetry,
} from "./smsService";

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
    // Billing terms (price/paymentSchedule/category) now live on the
    // TENANT, not the stall -- a new tenant starts out with whatever the
    // stall was last listing (its own denormalized display copy), same as
    // before this changed, they just now own that data going forward
    // instead of sharing the stall's copy with whoever rents it next.
    const stallSnap = await db.collection("stalls").doc(stallId).get();
    const stallData = stallSnap.data() ?? {};

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

      price: stallData.price ?? 0,
      paymentSchedule: stallData.paymentSchedule ?? "monthly",
      category: stallData.category ?? "",

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

// =====================================
// TENANT PASSWORD RESET — SMS OTP GATE
// Two-step, possession-checked version of the reset above. Closes the
// "knowing an email is enough to reset" hole: sendResetOtp texts a 6-digit
// code to the phone on the tenant's account, and verifyResetOtp only mints
// the Firebase reset code (oobCode) AFTER that code is proven server-side.
// The oobCode is never generated until the OTP matches -- that's the whole
// security point. See OTP_RESET_PLAN.md.
// =====================================

// Show just enough of the destination number to reassure the tenant where
// the code went, without printing the full number back to an unauthenticated
// caller.
function maskPhone(phone: string): string {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length < 3) return "the number on your account";
  return `••••••${digits.slice(-3)}`;
}

export const sendResetOtp = onCall({secrets: [semaphoreApiKey]}, async (request) => {
  const { email } = request.data as { email: string };
  if (!email) throw new HttpsError("invalid-argument", "Email is required.");
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new HttpsError("invalid-argument", "Invalid email address.");
  }
  await checkRateLimit(`sendResetOtp:${email}`, 3, 15 * 60_000);

  const snap = await db
    .collection("users")
    .where("personalEmail", "==", email)
    .where("role", "==", "tenant")
    .limit(1)
    .get();

  // Every gate failure below returns the SAME { status: "manual" } response,
  // so this endpoint can't be used to probe which emails exist or are
  // verified (account enumeration). Only a fully-eligible tenant gets a code.
  if (snap.empty) {
    return { status: "manual" };
  }

  const tenantDoc = snap.docs[0];
  const data = tenantDoc.data();
  const tenantId = tenantDoc.id;

  // Preserves the existing admin-handled manual path (same doc shape as
  // tenantForgotPassword) for tenants who can't self-serve yet.
  const fileManual = async () => {
    await db.collection("passwordResetRequests").add({
      email,
      tenantId,
      tenantName: `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim(),
      spaceId: data.spaceId ?? data.stallId ?? "",
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });
  };

  // Gate 1: the email must be verified on the Auth account itself -- the
  // authoritative source, not the denormalized Firestore `emailVerified`
  // badge copy. getUserByEmail resolves because syncPersonalEmail sets the
  // Auth login email to the personalEmail.
  let authUser;
  try {
    authUser = await auth.getUserByEmail(email);
  } catch {
    await fileManual();
    return { status: "manual" };
  }
  if (!authUser.emailVerified) {
    await fileManual();
    return { status: "manual" };
  }

  // Gate 2: a phone number must be on file to receive the code.
  const contactNo = data.contactNo as string | undefined;
  if (!contactNo) {
    await fileManual();
    return { status: "manual" };
  }

  // Treat a malformed stored number the same as a missing number. Sending it
  // would otherwise throw a plain Error which Firebase exposes to the app only
  // as the unhelpful generic "INTERNAL" message.
  try {
    normalizePhilippinePhone(contactNo);
  } catch {
    console.warn("[sendResetOtp] Tenant has an invalid phone number", { tenantId });
    await fileManual();
    return { status: "manual" };
  }

  // Issue a fresh 6-digit code, keyed by uid so a new request replaces any
  // still-outstanding code for this tenant. Only the SHA-256 hash is stored,
  // so a DB leak never exposes a live code.
  const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const otpHash = createHash("sha256").update(otp).digest("hex");

  const otpRef = db.collection("passwordResetOtps").doc(tenantId);
  await otpRef.set({
    emailKey: email,
    otpHash,
    attempts: 0,
    expiresAt: Date.now() + 10 * 60_000,
    createdAt: FieldValue.serverTimestamp(),
  });

  try {
    await sendSMSWithRetry(
      contactNo,
      `Your RentWise password reset code is ${otp}. It expires in 10 minutes. Do not share it with anyone.`,
      tenantId,
      "password-reset",
    );
  } catch (error) {
    // Never leave a valid OTP behind when no SMS was delivered. Log the real
    // server-side cause, but return a safe and useful message to the app.
    await otpRef.delete().catch((cleanupError) => {
      console.error("[sendResetOtp] Failed to remove undelivered OTP", {
        tenantId,
        cleanupError,
      });
    });
    console.error("[sendResetOtp] SMS delivery failed", { tenantId, error });
    throw new HttpsError(
      "unavailable",
      "We couldn't send the reset code right now. Please try again in a few minutes.",
    );
  }

  return { status: "sent", phoneHint: maskPhone(contactNo) };
});

export const verifyResetOtp = onCall(async (request) => {
  const { email, otp } = request.data as { email: string; otp: string };
  if (!email || !otp) {
    throw new HttpsError("invalid-argument", "Email and code are required.");
  }
  if (!/^\d{6}$/.test(otp)) {
    throw new HttpsError("invalid-argument", "Enter the 6-digit code.");
  }
  await checkRateLimit(`verifyResetOtp:${email}`, 10, 15 * 60_000);

  const snap = await db
    .collection("users")
    .where("personalEmail", "==", email)
    .where("role", "==", "tenant")
    .limit(1)
    .get();
  if (snap.empty) {
    throw new HttpsError("not-found", "No account found with this email.");
  }
  const tenantId = snap.docs[0].id;
  const otpRef = db.collection("passwordResetOtps").doc(tenantId);

  const inputHash = createHash("sha256").update(otp).digest("hex");

  // A transaction so a burst of guesses can't race the attempt counter or
  // reuse a code that another call is consuming at the same moment.
  const result = await db.runTransaction(async (tx) => {
    const otpSnap = await tx.get(otpRef);
    if (!otpSnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "No active code. Please request a new one.",
      );
    }
    const o = otpSnap.data() as {
      otpHash: string;
      attempts: number;
      expiresAt: number;
    };

    if (Date.now() > o.expiresAt) {
      tx.delete(otpRef);
      throw new HttpsError(
        "deadline-exceeded",
        "This code has expired. Please request a new one.",
      );
    }
    if (o.attempts >= 5) {
      tx.delete(otpRef);
      throw new HttpsError(
        "resource-exhausted",
        "Too many incorrect attempts. Please request a new code.",
      );
    }

    // Constant-time compare of equal-length SHA-256 hex digests.
    const match =
      o.otpHash.length === inputHash.length &&
      timingSafeEqual(Buffer.from(inputHash), Buffer.from(o.otpHash));

    if (!match) {
      tx.update(otpRef, { attempts: FieldValue.increment(1) });
      return { ok: false, attemptsLeft: 5 - (o.attempts + 1) };
    }

    tx.delete(otpRef); // one-time use — consume on success
    return { ok: true, attemptsLeft: 0 };
  });

  if (!result.ok) {
    throw new HttpsError(
      "invalid-argument",
      `Incorrect code. ${result.attemptsLeft} attempt${
        result.attemptsLeft === 1 ? "" : "s"
      } left.`,
    );
  }

  // OTP proven — NOW (and only now) mint the Firebase reset code, the same
  // way tenantForgotPassword does, and hand it to the app's own reset screen.
  const link = await auth.generatePasswordResetLink(email, {
    url: "https://rentwise-capstone-project.web.app/reset-password",
    handleCodeInApp: true,
  });
  const oobCode = new URL(link).searchParams.get("oobCode");

  return { oobCode };
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

// =====================================
// PUBLIC GUEST API
// Keeps anonymous browsers away from raw Firestore documents and applies
// server-side validation/rate limiting to public write operations.
// =====================================
function publicCallerKey(request: any, endpoint: string): string {
  const forwarded = String(request.rawRequest?.headers?.["x-forwarded-for"] ?? "");
  const ip = forwarded.split(",")[0].trim() || String(request.rawRequest?.ip ?? "unknown");
  return `public:${endpoint}:${createHash("sha256").update(ip).digest("hex").slice(0, 32)}`;
}

function requiredPublicString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new HttpsError("invalid-argument", `${field} must be text.`);
  const clean = value.trim();
  if (!clean || clean.length > maxLength) {
    throw new HttpsError("invalid-argument", `${field} is required and must be under ${maxLength} characters.`);
  }
  return clean;
}

export const getPublicStalls = onCall(async (request) => {
  // The guest home page and map each refresh every 15 seconds. Allow several
  // simultaneous tabs/devices behind the same public IP while still placing
  // a firm ceiling on automated scraping.
  await checkRateLimit(publicCallerKey(request, "stalls"), 1200, 60 * 60_000);
  const snapshot = await db.collection("stalls").get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    const numericPrice = Number(data.price);
    return {
      id: doc.id,
      name: typeof data.name === "string" ? data.name : "",
      spaceId: typeof data.spaceId === "string" ? data.spaceId : "",
      status: typeof data.status === "string" ? data.status : "unknown",
      buildingNumber: typeof data.buildingNumber === "string" ? data.buildingNumber : "",
      category: typeof data.category === "string" ? data.category : "",
      marketType: typeof data.marketType === "string" ? data.marketType : "",
      width: Number.isFinite(Number(data.width)) ? Number(data.width) : null,
      length: Number.isFinite(Number(data.length)) ? Number(data.length) : null,
      price: Number.isFinite(numericPrice) ? numericPrice : null,
      spaceDimension: typeof data.spaceDimension === "string" ? data.spaceDimension : "",
    };
  });
});

export const submitPublicContactMessage = onCall(async (request) => {
  await checkRateLimit(publicCallerKey(request, "contact"), 5, 60 * 60_000);
  const input = request.data ?? {};
  const firstName = requiredPublicString(input.firstName, "First name", 60);
  const lastName = requiredPublicString(input.lastName, "Last name", 60);
  const email = requiredPublicString(input.email, "Email", 200).toLowerCase();
  const message = requiredPublicString(input.message, "Message", 2000);
  const phone = typeof input.phone === "string" ? input.phone.trim().slice(0, 30) : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError("invalid-argument", "Enter a valid email address.");
  }
  await db.collection("contactMessages").add({ firstName, lastName, email, phone, message, createdAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

export const logPublicArPlacement = onCall(async (request) => {
  await checkRateLimit(publicCallerKey(request, "ar-placement"), 60, 60 * 60_000);
  const input = request.data ?? {};
  const objectId = requiredPublicString(input.objectId, "Object ID", 200);
  const objectName = requiredPublicString(input.objectName, "Object name", 200);
  const category = typeof input.category === "string" ? input.category.trim().slice(0, 100) : "";
  const objectDoc = await db.collection("arObjects").doc(objectId).get();
  if (!objectDoc.exists) throw new HttpsError("invalid-argument", "Unknown AR object.");
  await db.collection("arPlacementEvents").add({ objectId, objectName, category, createdAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

// Read-only guard used immediately before the existing client-side archive
// flow. It deliberately does not archive, disable, or update anything.
export const checkTenantArchiveEligibility = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  await assertIsAdminOrOwner(callerUid);

  const { uid } = request.data as { uid?: string };
  if (!uid) {
    throw new HttpsError("invalid-argument", "Tenant ID is required.");
  }

  const tenantSnap = await db.collection("users").doc(uid).get();
  if (!tenantSnap.exists || tenantSnap.data()?.role !== "tenant") {
    throw new HttpsError("not-found", "Tenant account was not found.");
  }

  const tenant = tenantSnap.data()!;
  const dailyRate = Number(tenant.price ?? 0);
  const schedule = String(tenant.paymentSchedule ?? "monthly");
  const nowManila = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }),
  );

  const nextPeriodStart = (date: Date): Date => {
    const next = new Date(date);
    if (schedule === "daily") {
      next.setDate(next.getDate() + 1);
      return next;
    }
    if (schedule === "weekly") {
      next.setDate(next.getDate() + 7);
      return next;
    }
    if (schedule === "semi-monthly") {
      if (next.getDate() <= 15) {
        next.setDate(16);
        return next;
      }
      return new Date(next.getFullYear(), next.getMonth() + 1, 1);
    }
    return new Date(next.getFullYear(), next.getMonth() + 1, 1);
  };

  const monthEnd = new Date(nowManila.getFullYear(), nowManila.getMonth() + 1, 1);
  let chargedToDate = 0;
  let cursor = new Date(nowManila.getFullYear(), nowManila.getMonth(), 1);
  let guard = 0;
  while (cursor <= nowManila && guard < 31) {
    const periodEnd = nextPeriodStart(cursor);
    const cappedEnd = periodEnd < monthEnd ? periodEnd : monthEnd;
    const days = Math.round((cappedEnd.getTime() - cursor.getTime()) / 86400000);
    chargedToDate += dailyRate * days;
    cursor = periodEnd;
    guard++;
  }

  const paymentsSnap = await db
    .collection("payments")
    .where("userId", "==", uid)
    .get();

  let paidThisMonth = 0;
  let hasPendingPayment = false;
  for (const paymentDoc of paymentsSnap.docs) {
    const payment = paymentDoc.data();
    const rawDate = payment.date?.toDate
      ? payment.date.toDate()
      : new Date(payment.date);
    if (Number.isNaN(rawDate.getTime())) continue;

    const paymentManila = new Date(
      rawDate.toLocaleString("en-US", { timeZone: "Asia/Manila" }),
    );
    const isCurrentMonth =
      paymentManila.getFullYear() === nowManila.getFullYear() &&
      paymentManila.getMonth() === nowManila.getMonth();
    if (!isCurrentMonth) continue;

    if (payment.status === "approved") {
      paidThisMonth += Number(payment.amount ?? 0);
    } else if (payment.status === "pending") {
      hasPendingPayment = true;
    }
  }

  const outstandingBalance = Math.max(0, chargedToDate - paidThisMonth);
  return {
    canArchive: outstandingBalance <= 0 && !hasPendingPayment,
    outstandingBalance,
    hasPendingPayment,
  };
});
