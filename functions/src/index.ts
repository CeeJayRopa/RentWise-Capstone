import { setGlobalOptions } from "firebase-functions";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { https as httpsV1 } from "firebase-functions/v1";

export { sendPaymentReminders } from "./reminderScheduler";
export { sendPushOnNotification } from "./pushNotifications";

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
  const adminUid = request.auth?.uid;

  if (!adminUid) {
    throw new HttpsError("unauthenticated", "Login required");
  }

  await assertIsAdmin(adminUid);

  const {
    uid,

    newPassword,
  } = request.data;

  if (!uid || !newPassword) {
    throw new HttpsError("invalid-argument", "Missing password data");
  }

  await auth.updateUser(
    uid,

    {
      password: newPassword,
    },
  );

  return {
    success: true,
  };
});

// =====================================
// ENABLE / DISABLE ACCOUNT
// =====================================

export const adminSetAccountDisabled = onCall(async (request) => {
  const adminUid = request.auth?.uid;

  if (!adminUid) {
    throw new HttpsError("unauthenticated", "Login required");
  }

  await assertIsAdmin(adminUid);

  const {
    uid,

    disabled,
  } = request.data;

  if (!uid) {
    throw new HttpsError("invalid-argument", "Missing user UID");
  }

  await auth.updateUser(
    uid,

    {
      disabled,
    },
  );

  return {
    success: true,
  };
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

// Owner notifications are now created explicitly by the admin FAB
// "Apply Changes" button — see rentwise-admin/app/components/UpdatesReportFAB.tsx.
