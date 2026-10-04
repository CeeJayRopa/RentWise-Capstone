import { setGlobalOptions } from "firebase-functions";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";

export { sendPaymentReminders } from "./reminderScheduler";
export { sendPushOnNotification } from "./pushNotifications";
export { notifyAdminsOnPayment } from "./paymentNotifier";
export { cleanupOldDailyReports } from "./reportCleanup";

import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "crypto";

import {
  normalizePhilippinePhone,
  semaphoreApiKey,
  sendSMSWithRetry,
} from "./smsService";
import { getOutstandingBalance } from "./paymentChecker";

// Firebase Admin initialization
initializeApp();

const db = getFirestore();
const auth = getAuth();
const paymongoSecretKey = defineSecret("PAYMONGO_SECRET_KEY");

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

// Client-side checks improve the UI, but callers can bypass the app and call
// callable functions directly. These are the authoritative server checks.
function inputObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpsError("invalid-argument", "Invalid request data.");
  }
  return value as Record<string, unknown>;
}

function networkRateLimitKey(request: any, endpoint: string): string {
  const forwarded = String(request.rawRequest?.headers?.["x-forwarded-for"] ?? "");
  const ip = forwarded.split(",")[0].trim() || String(request.rawRequest?.ip ?? "unknown");
  const networkHash = createHash("sha256").update(ip).digest("hex").slice(0, 32);
  return `network:${endpoint}:${networkHash}`;
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${field} must be text.`);
  }
  const clean = value.trim();
  if (!clean || clean.length > maxLength || /[\u0000-\u001F\u007F]/.test(clean)) {
    throw new HttpsError("invalid-argument", `${field} is required and must be at most ${maxLength} characters.`);
  }
  return clean;
}

function validUid(value: unknown): string {
  const uid = requiredText(value, "Account ID", 128);
  if (!/^[A-Za-z0-9_-]+$/.test(uid)) {
    throw new HttpsError("invalid-argument", "Invalid account ID.");
  }
  return uid;
}

function validName(value: unknown, field: string): string {
  const name = requiredText(value, field, 80);
  if (!/^[\p{L}\p{M} .'-]+$/u.test(name)) {
    throw new HttpsError("invalid-argument", `${field} contains invalid characters.`);
  }
  return name;
}

function validUsername(value: unknown): string {
  const username = requiredText(value, "Username", 40);
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) {
    throw new HttpsError("invalid-argument", "Username must be 3-40 characters using letters, numbers, dot, underscore, or hyphen.");
  }
  return username;
}

function validEmail(value: unknown): string {
  const email = requiredText(value, "Email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError("invalid-argument", "Invalid email address.");
  }
  return email;
}

function validPassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw new HttpsError("invalid-argument", "Password must be between 8 and 128 characters.");
  }
  if (!/[A-Z]/.test(value) || !/\d/.test(value) || !/[^A-Za-z0-9]/.test(value)) {
    throw new HttpsError("invalid-argument", "Password must include an uppercase letter, a number, and a special character.");
  }
  return value;
}

function validPhilippinePhone(value: unknown): string {
  const phone = requiredText(value, "Phone number", 20);
  try {
    return normalizePhilippinePhone(phone).slice(1);
  } catch {
    throw new HttpsError("invalid-argument", "Phone number must be a valid Philippine mobile number.");
  }
}

function normalizeSecurityAnswer(value: string): string {
  return value.trim().toLowerCase();
}

function hashSecurityAnswer(answer: string, salt: string): string {
  return scryptSync(normalizeSecurityAnswer(answer), salt, 64).toString("hex");
}

async function assertTargetRole(uid: string, expectedRole: "admin" | "tenant") {
  const targetDoc = await db.collection("users").doc(uid).get();
  if (!targetDoc.exists || targetDoc.data()?.role !== expectedRole) {
    throw new HttpsError("failed-precondition", `Target account must be a ${expectedRole}.`);
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

  const input = inputObject(request.data);
  const firstName = validName(input.firstName, "First name");
  const middleNameInput = typeof input.middleName === "string" ? input.middleName.trim() : "";
  const middleName = middleNameInput ? validName(middleNameInput, "Middle name") : "";
  const lastName = validName(input.lastName, "Last name");
  const username = validUsername(input.username);
  const contactNo = validPhilippinePhone(input.contactNo);
  const password = validPassword(input.password);
  const stallId = requiredText(input.stallId, "Stall ID", 128);

  const email = `${username}@rentwise.app`;

  let createdUser;

  try {
    // Billing terms (price/paymentSchedule/category) now live on the
    // TENANT, not the stall -- a new tenant starts out with whatever the
    // stall was last listing (its own denormalized display copy), same as
    // before this changed, they just now own that data going forward
    // instead of sharing the stall's copy with whoever rents it next.
    const stallSnap = await db.collection("stalls").doc(stallId).get();
    if (!stallSnap.exists) {
      throw new HttpsError("not-found", "Stall does not exist.");
    }
    const stallData = stallSnap.data() ?? {};
    if (stallData.status === "occupied" || stallData.tenantId) {
      throw new HttpsError("failed-precondition", "Stall is already occupied.");
    }

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

      middleName,

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

  const input = inputObject(request.data);
  const uid = validUid(input.uid);
  const newPassword = validPassword(input.newPassword);

  // Verify caller is an admin using the caller's OWN verified auth identity
  // (request.auth.uid, set by Firebase from the caller's ID token) -- NOT a
  // client-supplied uid. Trusting a client-supplied "callerUid" field here
  // used to let anyone claim to be any admin and reset any tenant's
  // password; see CAPSTONE_NOTES.txt for the full writeup.
  await assertIsAdmin(callerUid);
  await assertTargetRole(uid, "tenant");

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
  const input = inputObject(request.data);
  const personalEmail = validEmail(input.personalEmail);

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

  const input = inputObject(request.data);
  const uid = validUid(input.uid);
  const newPassword = validPassword(input.newPassword);

  // Verify caller is an owner using the caller's OWN verified auth identity
  // (request.auth.uid) -- NOT a client-supplied uid. See CAPSTONE_NOTES.txt.
  await assertIsOwner(callerUid);

  // Verify the target account is actually an admin, not an arbitrary user
  await assertIsAdmin(uid);

  await auth.updateUser(uid, { password: newPassword });
  await auth.revokeRefreshTokens(uid);
  await db.collection("users").doc(uid).update({
    sessionRevokedAt: FieldValue.serverTimestamp(),
  });

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

  const input = inputObject(request.data);
  const uid = validUid(input.uid);
  const firstName = validName(input.firstName, "First name");
  const middleNameInput = typeof input.middleName === "string" ? input.middleName.trim() : "";
  const middleName = middleNameInput ? validName(middleNameInput, "Middle name") : "";
  const lastName = validName(input.lastName, "Last name");
  const username = validUsername(input.username);
  const contactNo = validPhilippinePhone(input.contactNo);

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
    middleName,
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

  const input = inputObject(request.data);
  const uid = validUid(input.uid);
  const disabled = input.disabled;

  if (typeof disabled !== "boolean") {
    throw new HttpsError("invalid-argument", "Missing account data");
  }

  // Admin or owner can enable/disable a tenant's login access. Verified via
  // the caller's OWN auth identity (request.auth.uid), not a client-supplied
  // uid. See CAPSTONE_NOTES.txt.
  await assertIsAdminOrOwner(callerUid);
  await assertTargetRole(uid, "tenant");

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

// ── BLAZE PLAN ONLY ──────────────────────────────────────────────────────────
// After capstone defense: delete this entire function and downgrade Firebase
// to Spark plan. Also remove the BLAZE PLAN block in
// rentwise-admin/shared/services/accountServices.ts and uncomment the
// FREE PLAN block in that same file.
// ─────────────────────────────────────────────────────────────────────────────
// Creates the PayMongo intent from a server-validated amount and records a
// short-lived, one-use session tying that intent to the authenticated tenant.
export const createTenantPaymongoPaymentIntent = onCall(
  {secrets: [paymongoSecretKey]},
  async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "You must be logged in.");
  await checkRateLimit(`createTenantPaymongoPaymentIntent:${callerUid}`, 10, 60 * 60_000);

  const input = request.data as Record<string, unknown> | null;
  const requestedAmount = Number(input?.amount);
  const paymentMethod = input?.paymentMethod;
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0 || requestedAmount > 10_000_000) {
    throw new HttpsError("invalid-argument", "Invalid payment amount.");
  }
  if (paymentMethod !== "gcash" && paymentMethod !== "paymaya") {
    throw new HttpsError("invalid-argument", "Invalid payment method.");
  }

  const tenantSnap = await db.collection("users").doc(callerUid).get();
  if (!tenantSnap.exists || tenantSnap.data()?.role !== "tenant") {
    throw new HttpsError("permission-denied", "Tenant access required.");
  }
  const tenant = tenantSnap.data()!;
  if (tenant.status && tenant.status !== "active") {
    throw new HttpsError("permission-denied", "This tenant account is not active.");
  }

  const dailyRate = Number(tenant.price ?? 0);
  if (!Number.isFinite(dailyRate) || dailyRate <= 0) {
    throw new HttpsError("failed-precondition", "This account has no valid rental rate.");
  }
  const schedule = String(tenant.paymentSchedule ?? "monthly");
  const minimumDue = await getOutstandingBalance(callerUid, schedule, dailyRate, new Date());
  const normalizedAmount = Math.round(requestedAmount * 100) / 100;
  const normalizedMinimum = Math.round(minimumDue * 100) / 100;
  if (normalizedMinimum <= 0) {
    throw new HttpsError("failed-precondition", "There is no outstanding balance to pay.");
  }
  if (normalizedAmount < normalizedMinimum) {
    throw new HttpsError(
      "invalid-argument",
      `Payment must be at least PHP ${normalizedMinimum.toFixed(2)}.`,
    );
  }

  const secretKey = paymongoSecretKey.value();
  if (!secretKey) {
    console.error("PAYMONGO_SECRET_KEY is not configured");
    throw new HttpsError("failed-precondition", "Payment service is not configured.");
  }
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
  };
  const amountInCentavos = Math.round(normalizedAmount * 100);

  const intentResponse = await fetch("https://api.paymongo.com/v1/payment_intents", {
    method: "POST",
    headers,
    body: JSON.stringify({
      data: {
        attributes: {
          amount: amountInCentavos,
          currency: "PHP",
          payment_method_allowed: ["gcash", "paymaya"],
          description: "RentWise Online Rent Payment",
        },
      },
    }),
  });
  if (!intentResponse.ok) {
    console.error("PayMongo create-intent failed", {status: intentResponse.status});
    throw new HttpsError("unavailable", "Unable to start payment.");
  }
  const intent = await intentResponse.json() as {data?: {id?: string}};
  const paymentIntentId = intent.data?.id;
  if (!paymentIntentId) throw new HttpsError("internal", "Payment intent was not returned.");

  const methodResponse = await fetch("https://api.paymongo.com/v1/payment_methods", {
    method: "POST",
    headers,
    body: JSON.stringify({
      data: {
        attributes: {
          type: paymentMethod,
          billing: {
            name: `${tenant.firstName ?? ""} ${tenant.lastName ?? ""}`.trim(),
            email: String(tenant.personalEmail ?? tenant.email ?? ""),
          },
        },
      },
    }),
  });
  if (!methodResponse.ok) {
    console.error("PayMongo create-method failed", {status: methodResponse.status});
    throw new HttpsError("unavailable", "Unable to start payment.");
  }
  const method = await methodResponse.json() as {data?: {id?: string}};
  if (!method.data?.id) throw new HttpsError("internal", "Payment method was not returned.");

  const returnUrl =
    `https://rentwise-paymongo-api.vercel.app/api/payment-return?amount=${amountInCentavos}` +
    `&pi=${encodeURIComponent(paymentIntentId)}`;
  const attachResponse = await fetch(
    `https://api.paymongo.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}/attach`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        data: {attributes: {payment_method: method.data.id, return_url: returnUrl}},
      }),
    },
  );
  if (!attachResponse.ok) {
    console.error("PayMongo attach failed", {status: attachResponse.status});
    throw new HttpsError("unavailable", "Unable to start payment authorization.");
  }
  const attached = await attachResponse.json() as {
    data?: {attributes?: {next_action?: {redirect?: {url?: string}}}};
  };
  const redirectUrl = attached.data?.attributes?.next_action?.redirect?.url;
  if (!redirectUrl) throw new HttpsError("internal", "Payment authorization URL was not returned.");

  await db.collection("paymentSessions").doc(paymentIntentId).set({
    userId: callerUid,
    amount: normalizedAmount,
    amountInCentavos,
    paymentMethod,
    status: "created",
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Date.now() + 60 * 60_000,
  });

  return {paymentIntentId, redirectUrl, amount: normalizedAmount};
});

// Tenant payment records are created server-side so a modified app cannot
// manufacture an approved payment or attribute one to another account.
export const createTenantPendingPayment = onCall(
  {secrets: [paymongoSecretKey]},
  async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "You must be logged in.");
  await checkRateLimit(`createTenantPendingPayment:${callerUid}`, 20, 60 * 60_000);

  const input = request.data as Record<string, unknown> | null;
  if (!input || typeof input !== "object") {
    throw new HttpsError("invalid-argument", "Payment data is required.");
  }
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
    throw new HttpsError("invalid-argument", "Invalid payment amount.");
  }
  const paymentMethod = input.paymentMethod;
  if (paymentMethod !== "GCash" && paymentMethod !== "Maya") {
    throw new HttpsError("invalid-argument", "Invalid payment method.");
  }
  const checkoutSessionId = typeof input.checkoutSessionId === "string"
    ? input.checkoutSessionId.trim()
    : "";
  if (!checkoutSessionId || checkoutSessionId.length > 200) {
    throw new HttpsError("invalid-argument", "Invalid payment session.");
  }

  const sessionRef = db.collection("paymentSessions").doc(checkoutSessionId);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    throw new HttpsError("failed-precondition", "Payment session was not found.");
  }
  const session = sessionSnap.data()!;
  if (
    session.userId !== callerUid ||
    session.status !== "created" ||
    Number(session.expiresAt) < Date.now() ||
    Math.round(Number(session.amount) * 100) !== Math.round(amount * 100)
  ) {
    throw new HttpsError("failed-precondition", "Payment session is invalid or expired.");
  }
  const expectedMethod = session.paymentMethod === "gcash" ? "GCash" : "Maya";
  if (paymentMethod !== expectedMethod) {
    throw new HttpsError("failed-precondition", "Payment method does not match the session.");
  }

  const secretKey = paymongoSecretKey.value();
  if (!secretKey) throw new HttpsError("failed-precondition", "Payment service is not configured.");
  const statusResponse = await fetch(
    `https://api.paymongo.com/v1/payment_intents/${encodeURIComponent(checkoutSessionId)}`,
    {headers: {Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`}},
  );
  if (!statusResponse.ok) {
    throw new HttpsError("unavailable", "Unable to verify payment.");
  }
  const statusBody = await statusResponse.json() as {data?: {attributes?: {status?: string}}};
  const providerStatus = statusBody.data?.attributes?.status;
  if (providerStatus !== "succeeded" && providerStatus !== "processing") {
    throw new HttpsError("failed-precondition", "Payment has not been completed.");
  }

  const tenantSnap = await db.collection("users").doc(callerUid).get();
  if (!tenantSnap.exists || tenantSnap.data()?.role !== "tenant") {
    throw new HttpsError("permission-denied", "Tenant access required.");
  }
  const tenant = tenantSnap.data()!;
  if (tenant.status && tenant.status !== "active") {
    throw new HttpsError("permission-denied", "This tenant account is not active.");
  }
  const stallId = typeof tenant.stallId === "string" ? tenant.stallId : "";
  const stallSnap = stallId ? await db.collection("stalls").doc(stallId).get() : null;
  const stall = stallSnap?.data() ?? {};

  const finiteNonNegative = (value: unknown): number => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
  };
  const boundedInteger = (value: unknown, fallback: number): number => {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 100
      ? numeric
      : fallback;
  };
  const rawReceipt = input.receiptData && typeof input.receiptData === "object"
    ? input.receiptData as Record<string, unknown>
    : {};
  const rawBreakdown = Array.isArray(rawReceipt.breakdown)
    ? rawReceipt.breakdown.slice(0, 40)
    : [];
  const breakdown = rawBreakdown.flatMap((line) => {
    if (!line || typeof line !== "object") return [];
    const item = line as Record<string, unknown>;
    const label = typeof item.label === "string" ? item.label.trim().slice(0, 120) : "";
    const lineAmount = Number(item.amount);
    return label && Number.isFinite(lineAmount) && lineAmount >= 0
      ? [{label, amount: lineAmount}]
      : [];
  });

  const tenantName = `${tenant.firstName ?? ""} ${tenant.lastName ?? ""}`.trim();
  const receiptNo = `RW-ONLINE-${Date.now().toString().slice(-8)}`;
  const rentAmount = finiteNonNegative(input.rentAmount);
  const periodsCovered = boundedInteger(input.periodsCovered, 1);
  const periodsAdvance = boundedInteger(input.periodsAdvance, 0);
  const receiptData = {
    receiptNo,
    tenantName,
    buildingNumber: String(stall.buildingNumber ?? ""),
    spaceId: String(stall.spaceId ?? ""),
    paymentMethod,
    date: new Date().toISOString(),
    rentAmount,
    payment: amount,
    change: 0,
    status: "PENDING",
    breakdown,
  };

  const paymentRef = db.collection("payments").doc();
  await db.runTransaction(async (tx) => {
    const freshSessionSnap = await tx.get(sessionRef);
    if (!freshSessionSnap.exists || freshSessionSnap.data()?.status !== "created") {
      throw new HttpsError("already-exists", "This payment has already been recorded.");
    }
    tx.set(paymentRef, {
      userId: callerUid,
      amount,
      rentAmount,
      periodsCovered,
      periodsAdvance,
      method: "online",
      status: "pending",
      providerStatus,
      tenantName,
      buildingNumber: String(stall.buildingNumber ?? ""),
      spaceId: String(stall.spaceId ?? ""),
      stallId,
      receiptNo,
      checkoutSessionId,
      paymentMethod,
      receiptData,
      receipt: null,
      paymentId: null,
      cashReceived: null,
      change: 0,
      date: FieldValue.serverTimestamp(),
    });
    tx.update(sessionRef, {
      status: "used",
      paymentId: paymentRef.id,
      usedAt: FieldValue.serverTimestamp(),
    });
  });

  return {paymentId: paymentRef.id, receiptNo};
});

export const adminDeleteTenant = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  await checkRateLimit(`adminDeleteTenant:${callerUid}`, 30, 60 * 60_000);

  const input = inputObject(request.data);
  const uid = validUid(input.uid);

  await assertIsAdminOrOwner(callerUid);
  await assertTargetRole(uid, "tenant");
  throw new HttpsError(
    "failed-precondition",
    "Permanent tenant deletion is disabled. Archived accounts must retain their credentials.",
  );
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

export const ownerSaveSecurityQuestions = onCall({enforceAppCheck: true}, async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  await checkRateLimit(`ownerSaveSecurityQuestions:${callerUid}`, 10, 60 * 60_000);

  const input = inputObject(request.data);
  const securityQuestions = input.securityQuestions;

  if (
    !Array.isArray(securityQuestions) ||
    securityQuestions.length !== 3 ||
    securityQuestions.some((q) => !q || typeof q !== "object" || Array.isArray(q))
  ) {
    throw new HttpsError("invalid-argument", "Missing security question data");
  }

  // Verified via the caller's OWN auth identity (request.auth.uid) -- a
  // client-supplied "callerUid" here used to let anyone overwrite ANY
  // owner's recovery security questions with their own answers, then use
  // those to obtain a real password-reset link for that owner's account.
  // See CAPSTONE_NOTES.txt.
  await assertIsOwner(callerUid);

  const cleanQuestions = securityQuestions.map((entry) => {
    const q = entry as Record<string, unknown>;
    const answer = requiredText(q.answer, "Security answer", 120);
    const answerSalt = randomBytes(16).toString("hex");
    return {
      question: requiredText(q.question, "Security question", 160),
      answerSalt,
      answerHash: hashSecurityAnswer(answer, answerSalt),
    };
  });
  if (new Set(cleanQuestions.map((q) => q.question.toLowerCase())).size !== 3) {
    throw new HttpsError("invalid-argument", "Security questions must be different.");
  }

  // The client re-authenticates with the owner's current password via
  // Firebase Auth (see owner-profile.tsx) immediately before calling this —
  // that's the real verification, so nothing about the password itself
  // needs to travel here or ever be stored. Only the security Q&A is kept.
  await db.collection("ownerRecovery").doc(callerUid).set({
    securityQuestions: cleanQuestions,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { success: true };
});

export const getOwnerSecurityQuestions = onCall({enforceAppCheck: true}, async (request) => {
  // This endpoint returns only the selected questions, never their answers.
  await checkRateLimit(networkRateLimitKey(request, "ownerQuestions"), 30, 5 * 60_000);

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
    answer?: string;
    answerSalt?: string;
    answerHash?: string;
  }[];

  // Transparently remove legacy plaintext answers as soon as the recovery
  // flow is opened. This migration does not need the caller to know them;
  // it hashes the existing values and overwrites the old representation.
  if (stored.some((q) => typeof q.answer === "string" && !q.answerHash)) {
    const migrated = stored.map((q) => {
      if (typeof q.answer !== "string") return q;
      const answerSalt = randomBytes(16).toString("hex");
      return {
        question: q.question,
        answerSalt,
        answerHash: hashSecurityAnswer(q.answer, answerSalt),
      };
    });
    await ownerDoc.ref.update({
      securityQuestions: migrated,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  return { ownerId: ownerDoc.id, questions: stored.map((q) => q.question) };
});

export const verifyOwnerSecurityAnswers = onCall({enforceAppCheck: true}, async (request) => {
  const input = inputObject(request.data);
  const ownerId = validUid(input.ownerId);
  const answers = input.answers;

  if (!Array.isArray(answers) || answers.length !== 3) {
    throw new HttpsError("invalid-argument", "Missing answers.");
  }
  const cleanAnswers = answers.map((answer) => requiredText(answer, "Answer", 120));
  await checkRateLimit(networkRateLimitKey(request, "ownerRecovery"), 15, 15 * 60_000);
  // Keyed per-ownerId (not per-caller, since there's no caller identity yet)
  // so guessing security answers can't be scripted.
  await checkRateLimit(`verifyOwnerSecurityAnswers:${ownerId}`, 5, 15 * 60_000);

  const recoverySnap = await db.collection("ownerRecovery").doc(ownerId).get();
  if (!recoverySnap.exists) {
    throw new HttpsError("not-found", "No security questions found for this account.");
  }

  const stored = (recoverySnap.data()?.securityQuestions ?? []) as {
    question: string;
    answer?: string;
    answerSalt?: string;
    answerHash?: string;
  }[];

  const matches = stored.length === 3 && stored.every((q, i) => {
    if (q.answerSalt && q.answerHash) {
      const inputHash = hashSecurityAnswer(cleanAnswers[i], q.answerSalt);
      const expected = Buffer.from(q.answerHash, "hex");
      const actual = Buffer.from(inputHash, "hex");
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    }

    // Backward-compatible check for recovery data saved before answers were
    // hashed. A successful legacy recovery is immediately migrated below.
    if (typeof q.answer !== "string") return false;
    const expected = createHash("sha256")
      .update(normalizeSecurityAnswer(q.answer))
      .digest();
    const actual = createHash("sha256")
      .update(normalizeSecurityAnswer(cleanAnswers[i]))
      .digest();
    return timingSafeEqual(expected, actual);
  });

  if (!matches) {
    throw new HttpsError("permission-denied", "One or more answers are incorrect.");
  }

  if (stored.some((q) => !q.answerSalt || !q.answerHash)) {
    const migrated = stored.map((q, i) => {
      const answerSalt = randomBytes(16).toString("hex");
      return {
        question: q.question,
        answerSalt,
        answerHash: hashSecurityAnswer(cleanAnswers[i], answerSalt),
      };
    });
    await recoverySnap.ref.update({
      securityQuestions: migrated,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  // Generate a real, one-time-use Firebase password-reset code after the
  // security answers are verified, then hand it to the owner's in-app "choose
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

// Owner notifications are created automatically with each completed admin
// action by shared/services/updatesService.ts.

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
export const resolveLoginEmail = onCall({enforceAppCheck: false}, async (request) => {
  const input = inputObject(request.data);
  const identifier = requiredText(input.identifier, "Identifier", 254);
  const role = input.role;
  if (role !== "admin" && role !== "owner") {
    throw new HttpsError("invalid-argument", "Invalid account role.");
  }
  await checkRateLimit(networkRateLimitKey(request, "resolveLoginEmail"), 40, 5 * 60_000);
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

export const sendResetOtp = onCall(
  {secrets: [semaphoreApiKey], enforceAppCheck: true},
  async (request) => {
  const input = inputObject(request.data);
  const email = validEmail(input.email);
  await checkRateLimit(networkRateLimitKey(request, "sendResetOtp"), 10, 15 * 60_000);
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

  // Preserves the existing admin-handled manual path for tenants who cannot
  // complete the verified-email and SMS requirements yet.
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

  // The registered Gmail identifies the tenant account. Possession is
  // confirmed by the SMS sent to the phone number stored on that account.
  // Gmail inbox verification is intentionally not part of this flow.
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
  const issuedAt = Date.now();
  await db.runTransaction(async (tx) => {
    const existingSnap = await tx.get(otpRef);
    const previousSentAt = existingSnap.exists ? Number(existingSnap.data()?.sentAt ?? 0) : 0;
    const remainingCooldownMs = 60_000 - (issuedAt - previousSentAt);
    if (remainingCooldownMs > 0) {
      const remainingSeconds = Math.ceil(remainingCooldownMs / 1000);
      throw new HttpsError(
        "resource-exhausted",
        `Please wait ${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"} before requesting another code.`,
      );
    }
    tx.set(otpRef, {
      emailKey: email,
      otpHash,
      attempts: 0,
      expiresAt: issuedAt + 10 * 60_000,
      sentAt: issuedAt,
      createdAt: FieldValue.serverTimestamp(),
    });
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
  },
);

export const verifyResetOtp = onCall({enforceAppCheck: true}, async (request) => {
  const input = inputObject(request.data);
  const email = validEmail(input.email);
  const otp = typeof input.otp === "string" ? input.otp.trim() : "";
  if (!/^\d{6}$/.test(otp)) {
    throw new HttpsError("invalid-argument", "Enter the 6-digit code.");
  }
  await checkRateLimit(networkRateLimitKey(request, "verifyResetOtp"), 30, 15 * 60_000);
  await checkRateLimit(`verifyResetOtp:${email}`, 10, 15 * 60_000);

  const snap = await db
    .collection("users")
    .where("personalEmail", "==", email)
    .where("role", "==", "tenant")
    .limit(1)
    .get();
  if (snap.empty) {
    throw new HttpsError("failed-precondition", "No active code. Please request a new one.");
  }
  const tenantId = snap.docs[0].id;
  const otpRef = db.collection("passwordResetOtps").doc(tenantId);

  const inputHash = createHash("sha256").update(otp).digest("hex");
  const resetToken = randomBytes(32).toString("hex");
  const resetTokenHash = createHash("sha256").update(resetToken).digest("hex");
  const resetSessionRef = db.collection("passwordResetSessions").doc(resetTokenHash);

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
      return {status: "expired" as const, attemptsLeft: 0};
    }
    if (o.attempts >= 5) {
      tx.delete(otpRef);
      return {status: "locked" as const, attemptsLeft: 0};
    }

    // Constant-time compare of equal-length SHA-256 hex digests.
    const match =
      o.otpHash.length === inputHash.length &&
      timingSafeEqual(Buffer.from(inputHash), Buffer.from(o.otpHash));

    if (!match) {
      const nextAttempts = o.attempts + 1;
      if (nextAttempts >= 5) {
        tx.delete(otpRef);
        return {status: "locked" as const, attemptsLeft: 0};
      }
      tx.update(otpRef, {attempts: nextAttempts});
      return {status: "incorrect" as const, attemptsLeft: 5 - nextAttempts};
    }

    tx.delete(otpRef); // one-time use — consume on success
    tx.set(resetSessionRef, {
      tenantId,
      email,
      expiresAt: Date.now() + 10 * 60_000,
      createdAt: FieldValue.serverTimestamp(),
    });
    return {status: "ok" as const, attemptsLeft: 0};
  });

  if (result.status === "expired") {
    throw new HttpsError(
      "deadline-exceeded",
      "This code has expired. Please request a new one.",
    );
  }
  if (result.status === "locked") {
    throw new HttpsError(
      "resource-exhausted",
      "Too many incorrect attempts. Please request a new code.",
    );
  }
  if (result.status === "incorrect") {
    throw new HttpsError(
      "invalid-argument",
      `Incorrect code. ${result.attemptsLeft} attempt${
        result.attemptsLeft === 1 ? "" : "s"
      } left.`,
    );
  }

  // OTP proven — NOW (and only now) mint the Firebase reset code, the same
  // and hand it to the app's own reset screen.
  return {resetToken};
});

export const completeTenantPasswordReset = onCall(
  {enforceAppCheck: true},
  async (request) => {
    const input = inputObject(request.data);
    const resetToken = typeof input.resetToken === "string" ? input.resetToken.trim() : "";
    if (!/^[a-f0-9]{64}$/.test(resetToken)) {
      throw new HttpsError("invalid-argument", "This reset session is invalid or expired.");
    }
    const newPassword = validPassword(input.newPassword);
    const resetTokenHash = createHash("sha256").update(resetToken).digest("hex");
    const resetSessionRef = db.collection("passwordResetSessions").doc(resetTokenHash);

    const result = await db.runTransaction(async (tx) => {
      const sessionSnap = await tx.get(resetSessionRef);
      if (!sessionSnap.exists) return {status: "invalid" as const, tenantId: ""};
      const session = sessionSnap.data() as {tenantId?: string; expiresAt?: number};
      tx.delete(resetSessionRef);
      if (!session.tenantId || Date.now() > Number(session.expiresAt ?? 0)) {
        return {status: "invalid" as const, tenantId: ""};
      }
      return {status: "ok" as const, tenantId: session.tenantId};
    });

    if (result.status !== "ok") {
      throw new HttpsError("deadline-exceeded", "This reset session is invalid or expired.");
    }

    await assertTargetRole(result.tenantId, "tenant");
    await auth.updateUser(result.tenantId, {password: newPassword});
    await auth.revokeRefreshTokens(result.tenantId);
    await db.collection("users").doc(result.tenantId).update({
      mustChangePassword: false,
      sessionRevokedAt: FieldValue.serverTimestamp(),
    });

    return {success: true};
  },
);

export const adminForgotPassword = onCall({enforceAppCheck: true}, async (request) => {
  const input = inputObject(request.data);
  const email = validEmail(input.email);
  await checkRateLimit(networkRateLimitKey(request, "adminForgotPassword"), 15, 15 * 60_000);
  await checkRateLimit(`adminForgotPassword:${email}`, 5, 15 * 60_000);

  const snap = await db
    .collection("users")
    .where("email", "==", email)
    .where("role", "==", "admin")
    .limit(1)
    .get();

  if (snap.empty) {
    // Generic success prevents unauthenticated callers from discovering
    // which email addresses belong to administrator accounts.
    return { ok: true };
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

const publicStallsCacheRef = db.collection("publicApiCache").doc("stalls");

function publicStallData(id: string, data: FirebaseFirestore.DocumentData) {
  const numericPrice = Number(data.price);
  return {
    id,
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
}

async function rebuildPublicStallsCache() {
  const snapshot = await db.collection("stalls").get();
  const stalls = snapshot.docs.map((doc) => publicStallData(doc.id, doc.data()));
  await publicStallsCacheRef.set({
    stalls,
    updatedAt: FieldValue.serverTimestamp(),
    sourceCount: stalls.length,
  });
  return stalls;
}

// Rebuild the one-document public projection only when a field displayed by
// the Guest map changes. Private/internal stall edits do not create needless
// cache writes or notify every connected Guest listener.
export const syncPublicStallsCache = onDocumentWritten("stalls/{stallId}", async (event) => {
  const before = event.data?.before;
  const after = event.data?.after;
  if (!before || !after) return;

  if (before.exists && after.exists) {
    const beforeData = before.data() ?? {};
    const afterData = after.data() ?? {};
    const publicFields = [
      "name",
      "spaceId",
      "status",
      "buildingNumber",
      "category",
      "marketType",
      "width",
      "length",
      "price",
      "spaceDimension",
    ];
    const publicDataChanged = publicFields.some((field) => beforeData[field] !== afterData[field]);
    if (!publicDataChanged) return;
  }

  await rebuildPublicStallsCache();
});

export const getPublicStalls = onCall(async (request) => {
  // The guest app refreshes at a low frequency, and each refresh now costs one
  // cache-document read instead of one read for every stall in the market.
  await checkRateLimit(publicCallerKey(request, "stalls"), 120, 60 * 60_000);
  const cacheSnap = await publicStallsCacheRef.get();
  const cachedStalls = cacheSnap.data()?.stalls;
  if (Array.isArray(cachedStalls)) return cachedStalls;

  // Safe self-seeding path for the first request after deployment or if the
  // cache document is ever removed.
  return rebuildPublicStallsCache();
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

  const input = inputObject(request.data);
  const uid = validUid(input.uid);

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
