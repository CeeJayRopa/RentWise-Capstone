import { setGlobalOptions } from "firebase-functions";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { https as httpsV1 } from "firebase-functions/v1";

export { sendPaymentReminders } from "./reminderScheduler";
export { sendPushOnNotification } from "./pushNotifications";
export { notifyAdminsOnPayment } from "./paymentNotifier";

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
  const { uid, newPassword, callerUid } = request.data as {
    uid: string;
    newPassword: string;
    callerUid: string;
  };

  if (!uid || !newPassword || !callerUid) {
    throw new HttpsError("invalid-argument", "Missing password data");
  }

  // Verify caller is an admin via Firestore (works even when request.auth is unavailable in RN)
  await assertIsAdmin(callerUid);

  await auth.updateUser(uid, { password: newPassword });

  return { success: true };
});

// =====================================
// RESET ADMIN PASSWORD (owner-only)
// =====================================

export const ownerResetAdminPassword = onCall(async (request) => {
  const { uid, newPassword, callerUid } = request.data as {
    uid: string;
    newPassword: string;
    callerUid: string;
  };

  if (!uid || !newPassword || !callerUid) {
    throw new HttpsError("invalid-argument", "Missing password data");
  }

  // Verify caller is an owner via Firestore (works even when request.auth is unavailable in RN)
  await assertIsOwner(callerUid);

  // Verify the target account is actually an admin, not an arbitrary user
  await assertIsAdmin(uid);

  await auth.updateUser(uid, { password: newPassword });

  return { success: true };
});

// =====================================
// ENABLE / DISABLE ACCOUNT
// =====================================

export const adminSetAccountDisabled = onCall(async (request) => {
  const { uid, disabled, callerUid } = request.data as {
    uid: string;
    disabled: boolean;
    callerUid: string;
  };

  if (!uid || typeof disabled !== "boolean" || !callerUid) {
    throw new HttpsError("invalid-argument", "Missing account data");
  }

  // Admin or owner can enable/disable a tenant's login access
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
  const { uid, callerUid } = request.data as { uid: string; callerUid: string };

  if (!uid || !callerUid) {
    throw new HttpsError("invalid-argument", "Missing required fields");
  }

  // Admin or owner can permanently delete an archived tenant
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
  const { callerUid, securityQuestions, currentPassword } = request.data as {
    callerUid: string;
    securityQuestions: { question: string; answer: string }[];
    currentPassword: string;
  };

  if (
    !callerUid ||
    !currentPassword ||
    !Array.isArray(securityQuestions) ||
    securityQuestions.length !== 3 ||
    securityQuestions.some((q) => !q.question || !q.answer)
  ) {
    throw new HttpsError("invalid-argument", "Missing security question data");
  }

  await assertIsOwner(callerUid);

  // The client re-authenticates with currentPassword via Firebase Auth
  // (see owner-profile.tsx) immediately before calling this, so by the time
  // we get here it's already been confirmed correct — we just store it,
  // since Firebase Auth never exposes a user's password once set.
  await db.collection("ownerRecovery").doc(callerUid).set({
    securityQuestions,
    plainPassword: currentPassword,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { success: true };
});

export const getOwnerSecurityQuestions = onCall(async () => {
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

  // Returns the email alongside the password so the client can sign the
  // owner straight in and drop them on the dashboard.
  const ownerRecord = await auth.getUser(ownerId);
  return {
    password: recoverySnap.data()?.plainPassword ?? null,
    email: ownerRecord.email ?? null,
  };
});

// Keeps the recovery record's plaintext password in sync whenever the owner
// changes their password normally — a no-op merge if they haven't set up
// security questions yet.
export const ownerSyncRecoveryPassword = onCall(async (request) => {
  const { callerUid, newPassword } = request.data as {
    callerUid: string;
    newPassword: string;
  };
  if (!callerUid || !newPassword) {
    throw new HttpsError("invalid-argument", "Missing password.");
  }
  await assertIsOwner(callerUid);

  await db.collection("ownerRecovery").doc(callerUid).set(
    { plainPassword: newPassword, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

  return { success: true };
});

// Owner notifications are now created explicitly by the admin FAB
// "Apply Changes" button — see rentwise-admin/app/components/UpdatesReportFAB.tsx.
