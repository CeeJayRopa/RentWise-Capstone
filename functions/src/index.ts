import { setGlobalOptions } from "firebase-functions";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";

export { sendPaymentReminders } from "./reminderScheduler";
export { sendPushOnNotification } from "./pushNotifications";
export { notifyAdminsOnPayment } from "./paymentNotifier";
export { cleanupOldDailyReports } from "./reportCleanup";
export { cleanupExpiredNotifications } from "./notificationCleanup";

import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "crypto";

import {
  normalizePhilippinePhone,
  semaphoreApiKey,
  sendSMSWithRetry,
} from "./smsService";
import { getOutstandingBalance } from "./paymentChecker";
import {
  classifyPaymentAttempt,
  isRetryableAttempt,
  PaymongoIntentAttributes,
} from "./paymentAttemptStatus";
import {
  parsePaymongoWebhookEvent,
  PaymongoWebhookEvent,
  mayApplyUnsuccessfulWebhook,
  verifyPaymongoWebhookSignature,
} from "./paymongoWebhook";
import {
  ownsPaymentCreationLock,
  paymentApprovalBindingMatches,
  providerPaymentMatches,
  paymentIntervalDaysFor,
  advancePaymentLimitFor,
  billingPeriodsDueAt,
} from "./paymentSafety";

// Firebase Admin initialization
initializeApp();

const db = getFirestore();
const auth = getAuth();
const paymongoSecretKey = defineSecret("PAYMONGO_SECRET_KEY");
const paymongoWebhookSecret = defineSecret("PAYMONGO_WEBHOOK_SECRET");

function paymentMethodLabel(method: unknown): string {
  if (method === "gcash") return "GCash";
  if (method === "paymaya") return "Maya";
  return "";
}

type PaymentStallSnapshot = {
  stallId: string;
  buildingNumber: string;
  spaceId: string;
  dailyRate: number;
};

async function paymentStallSnapshots(tenant: Record<string, unknown>): Promise<PaymentStallSnapshot[]> {
  const ids = normalizedTenantStallIds(tenant).slice(0, 3);
  if (ids.length === 0) return [];
  const snaps = await Promise.all(ids.map((id) => db.collection("stalls").doc(id).get()));
  return snaps.filter((snap) => snap.exists).map((snap) => ({
    stallId: snap.id,
    buildingNumber: String(snap.data()?.buildingNumber ?? ""),
    spaceId: String(snap.data()?.spaceId ?? snap.id),
    dailyRate: Math.max(0, Number(snap.data()?.price ?? 0)),
  }));
}

export const createTenantTestPayment = onCall({secrets: [paymongoSecretKey]}, async (request) => {
  // Retained as a deployed compatibility stub so older app builds receive a
  // clear failure instead of creating simulated records in production data.
  throw new HttpsError("failed-precondition", "Test payment simulation has been permanently disabled.");
});

async function retrievePaymongoIntent(paymentIntentId: string): Promise<PaymongoIntentAttributes> {
  const secretKey = paymongoSecretKey.value();
  if (!secretKey) throw new HttpsError("failed-precondition", "Payment service is not configured.");
  const response = await fetch(
    `https://api.paymongo.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`,
    {headers: {Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`}},
  );
  if (response.status === 404) {
    throw new HttpsError("not-found", "PayMongo payment intent was not found.");
  }
  if (!response.ok) throw new HttpsError("unavailable", "Unable to verify payment.");
  const body = await response.json() as {data?: {attributes?: PaymongoIntentAttributes}};
  return body.data?.attributes ?? {};
}

async function cancelPaymongoIntent(paymentIntentId: string): Promise<PaymongoIntentAttributes | null> {
  const secretKey = paymongoSecretKey.value();
  if (!secretKey) throw new HttpsError("failed-precondition", "Payment service is not configured.");
  const response = await fetch(
    `https://api.paymongo.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}/cancel`,
    {
      method: "POST",
      headers: {Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`},
    },
  );
  if (response.ok) {
    const body = await response.json() as {data?: {attributes?: PaymongoIntentAttributes}};
    return body.data?.attributes ?? {};
  }
  if (response.status === 400 || response.status === 409) return null;
  if (response.status === 404) throw new HttpsError("not-found", "PayMongo payment intent was not found.");
  throw new HttpsError("unavailable", "Unable to cancel the payment safely.");
}

export const tenantUpdateOwnProfile = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in is required.");
  const input = request.data as Record<string, unknown> | null;
  const firstName = String(input?.firstName ?? "").trim();
  const lastName = String(input?.lastName ?? "").trim();
  const contactNo = String(input?.contactNo ?? "").trim();
  const category = String(input?.category ?? "").trim();
  if (!firstName || firstName.length > 80 || !lastName || lastName.length > 80) {
    throw new HttpsError("invalid-argument", "A valid first and last name are required.");
  }
  if (!/^9\d{9}$/.test(contactNo)) {
    throw new HttpsError("invalid-argument", "Enter a valid 10-digit contact number starting with 9.");
  }
  if (category && !["Wet Market", "Dry Market", "Home Essential"].includes(category)) {
    throw new HttpsError("invalid-argument", "Invalid market category.");
  }

  const userRef = db.collection("users").doc(uid);
  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists || userSnap.data()?.role !== "tenant") {
      throw new HttpsError("permission-denied", "Tenant access required.");
    }
    const existing = userSnap.data()!;
    if (existing.status && existing.status !== "active") {
      throw new HttpsError("permission-denied", "This tenant account is not active.");
    }
    if (contactNo !== String(existing.contactNo ?? "")) {
      const authTimeSeconds = Number(request.auth?.token?.auth_time ?? 0);
      if (!authTimeSeconds || Date.now() - authTimeSeconds * 1000 > 5 * 60_000) {
        throw new HttpsError("unauthenticated", "Sign in again before changing your recovery number.");
      }
    }

    const stallId = String(existing.stallId ?? "");
    const stallRef = stallId ? db.collection("stalls").doc(stallId) : null;
    const stallSnap = stallRef ? await tx.get(stallRef) : null;

    const userUpdate: Record<string, unknown> = {firstName, lastName, contactNo};
    if (category) userUpdate.category = category;
    tx.update(userRef, userUpdate);
    if (stallRef && stallSnap?.exists) {
      tx.update(stallRef, {
        tenantName: [firstName, existing.middleName, lastName].filter(Boolean).join(" "),
        ...(category ? {category} : {}),
      });
    }
  });
  return {success: true};
});

export const tenantFinalizePasswordChange = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in is required.");
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists || userSnap.data()?.role !== "tenant") {
    throw new HttpsError("permission-denied", "Tenant access required.");
  }
  await auth.revokeRefreshTokens(uid);
  await userSnap.ref.update({
    mustChangePassword: false,
    sessionRevokedAt: FieldValue.serverTimestamp(),
  });
  return {success: true};
});

export const ownerUpdateOwnProfile = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in is required.");
  const input = request.data as Record<string, unknown> | null;
  const firstName = String(input?.firstName ?? "").trim();
  const middleName = String(input?.middleName ?? "").trim();
  const lastName = String(input?.lastName ?? "").trim();
  const contactNo = String(input?.contactNo ?? "").trim();
  if (!firstName || firstName.length > 80 || !lastName || lastName.length > 80 || middleName.length > 80) {
    throw new HttpsError("invalid-argument", "Valid owner name details are required.");
  }
  if (!/^9\d{9}$/.test(contactNo)) {
    throw new HttpsError("invalid-argument", "Enter a valid 10-digit contact number starting with 9.");
  }

  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists || userSnap.data()?.role !== "owner") {
    throw new HttpsError("permission-denied", "Owner access required.");
  }
  if (contactNo !== String(userSnap.data()?.contactNo ?? "")) {
    const authTimeSeconds = Number(request.auth?.token?.auth_time ?? 0);
    if (!authTimeSeconds || Date.now() - authTimeSeconds * 1000 > 5 * 60_000) {
      throw new HttpsError("unauthenticated", "Sign in again before changing your recovery number.");
    }
  }
  await userRef.update({firstName, middleName, lastName, contactNo, username: "RWOWNER"});
  return {success: true};
});

export const adminUpdateOwnProfile = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in is required.");
  const input = inputObject(request.data);
  const firstName = validName(input.firstName, "First name");
  const middleNameInput = typeof input.middleName === "string" ? input.middleName.trim() : "";
  const middleName = middleNameInput ? validName(middleNameInput, "Middle name") : "";
  const lastName = validName(input.lastName, "Last name");
  const contactNo = validPhilippinePhone(input.contactNo);
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists || userSnap.data()?.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin access required.");
  }
  if (contactNo !== String(userSnap.data()?.contactNo ?? "")) {
    const authTimeSeconds = Number(request.auth?.token?.auth_time ?? 0);
    if (!authTimeSeconds || Date.now() - authTimeSeconds * 1000 > 5 * 60_000) {
      throw new HttpsError("unauthenticated", "Sign in again before changing your recovery number.");
    }
  }
  await userRef.update({firstName, middleName, lastName, contactNo, username: "RWADMIN"});
  return {success: true};
});

export const ownerFinalizePasswordChange = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in is required.");
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists || userSnap.data()?.role !== "owner") {
    throw new HttpsError("permission-denied", "Owner access required.");
  }
  await auth.revokeRefreshTokens(uid);
  await userSnap.ref.update({sessionRevokedAt: FieldValue.serverTimestamp()});
  return {success: true};
});

export const adminRecordCashPayment = onCall(async (request) => {
  const adminUid = request.auth?.uid;
  if (!adminUid) throw new HttpsError("unauthenticated", "Sign in is required.");
  await assertIsAdmin(adminUid);

  const tenantId = String(request.data?.tenantId ?? "").trim();
  const quantity = Number(request.data?.quantity);
  const cashReceived = Number(request.data?.cashReceived);
  if (!tenantId || !Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(cashReceived)) {
    throw new HttpsError("invalid-argument", "Tenant, quantity, and cash received are required.");
  }

  const tenantRef = db.collection("users").doc(tenantId);
  const paymentRef = db.collection("payments").doc();
  const receiptNo = `RW-${Date.now().toString().slice(-8)}`;

  const result = await db.runTransaction(async (tx) => {
    const tenantSnap = await tx.get(tenantRef);
    if (!tenantSnap.exists || tenantSnap.data()?.role !== "tenant") {
      throw new HttpsError("not-found", "Tenant account was not found.");
    }
    const tenant = tenantSnap.data()!;
    if (tenant.status !== "active") throw new HttpsError("failed-precondition", "Tenant is not active.");
    const stallId = String(tenant.stallId ?? "");
    const stallRef = stallId ? db.collection("stalls").doc(stallId) : null;
    const stallSnap = stallRef ? await tx.get(stallRef) : null;
    const stall = stallSnap?.data() ?? {};

    const schedule = String(tenant.paymentSchedule ?? "monthly").trim().toLowerCase();
    const intervalDays = paymentIntervalDaysFor(schedule);
    const maxQuantity = advancePaymentLimitFor(schedule);
    if (quantity > maxQuantity) {
      throw new HttpsError("invalid-argument", `Maximum advance is ${maxQuantity} payment intervals.`);
    }
    const dailyRate = Number(tenant.price ?? 0);
    if (!Number.isFinite(dailyRate) || dailyRate <= 0) {
      throw new HttpsError("failed-precondition", "Tenant rental rate is invalid.");
    }
    const amount = dailyRate * intervalDays * quantity;
    if (cashReceived < amount) throw new HttpsError("failed-precondition", "Cash received is insufficient.");

    const now = Timestamp.now();
    const rawStart = tenant.nextDueAt ?? tenant.billingStartedAt ?? tenant.createdAt;
    const coverageStart = rawStart?.toDate ? rawStart.toDate() : now.toDate();
    const coverageEnd = new Date(coverageStart);
    coverageEnd.setDate(coverageEnd.getDate() + intervalDays * quantity);
    const nextDueAt = Timestamp.fromDate(coverageEnd);
    const periodsDue = billingPeriodsDueAt(coverageStart, intervalDays, now.toDate());
    const periodsAdvance = Math.max(0, quantity - periodsDue);
    const tenantName = [tenant.firstName, tenant.middleName, tenant.lastName].filter(Boolean).join(" ");
    const breakdown = Array.from({length: quantity}, (_, index) => {
      const periodStart = new Date(coverageStart);
      periodStart.setDate(periodStart.getDate() + intervalDays * index);
      return {
        label: `${intervalDays} ${intervalDays === 1 ? "day" : "days"} rent from ${periodStart.toLocaleDateString("en-PH", {year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila"})}`,
        amount: dailyRate * intervalDays,
      };
    });
    const buildingNumber = String(stall.buildingNumber ?? "");
    const spaceId = String(stall.spaceId ?? "");
    const receiptData = {
      receiptNo,
      tenantName,
      buildingNumber,
      spaceId,
      paymentMethod: "Cash",
      date: now.toDate().toISOString(),
      rentAmount: dailyRate * intervalDays,
      payment: amount,
      amountPaid: amount,
      cashReceived,
      cashTendered: cashReceived,
      change: cashReceived - amount,
      status: "Approved",
      breakdown,
    };

    tx.set(paymentRef, {
      userId: tenantId,
      tenantName,
      stallId,
      buildingNumber,
      spaceId,
      amount,
      rentAmount: amount,
      cashReceived,
      change: cashReceived - amount,
      method: "cash",
      paymentMethod: "Cash",
      status: "approved",
      receiptGenerated: true,
      receiptNo,
      receiptData,
      date: now,
      approvedAt: now,
      paidAt: now,
      createdAt: now,
      paymentSchedule: schedule,
      intervalDays,
      periodsCovered: quantity,
      periodsAdvance,
      coverageStartAt: Timestamp.fromDate(coverageStart),
      paidThroughAt: nextDueAt,
      nextDueAt,
    });
    tx.update(tenantRef, {lastApprovedPaymentAt: now, paidThroughAt: nextDueAt, nextDueAt});
    return {paymentId: paymentRef.id, receiptNo, amount, cashReceived, change: cashReceived - amount,
      schedule, intervalDays, quantity, coverageStartAt: coverageStart.toISOString(), nextDueAt: coverageEnd.toISOString(), tenantName};
  });
  return result;
});

export const adminApproveOnlinePayment = onCall({secrets: [paymongoSecretKey]}, async (request) => {
  const adminUid = request.auth?.uid;
  if (!adminUid) throw new HttpsError("unauthenticated", "Sign in is required.");
  await assertIsAdmin(adminUid);

  const paymentId = String(request.data?.paymentId ?? "").trim();
  if (!paymentId) throw new HttpsError("invalid-argument", "Payment is required.");

  const paymentRef = db.collection("payments").doc(paymentId);
  const verificationSnap = await paymentRef.get();
  if (!verificationSnap.exists) throw new HttpsError("not-found", "Payment was not found.");
  const verificationPayment = verificationSnap.data()!;
  const isTestSimulation = verificationPayment.testMode === true;
  if (isTestSimulation && !paymongoSecretKey.value().startsWith("sk_test_")) {
    throw new HttpsError("failed-precondition", "Test payments cannot be approved outside PayMongo test mode.");
  }
  const verifiedUserId = String(verificationPayment.userId ?? "");
  const verifiedAmountCentavos = Math.round(Number(verificationPayment.amount ?? 0) * 100);
  let verifiedCheckoutSessionId = String(verificationPayment.checkoutSessionId ?? "").trim();
  if (verificationPayment.method === "online") {
    if (!verifiedCheckoutSessionId) {
      const legacyPaymentIntentId = String(request.data?.legacyPaymentIntentId ?? "").trim();
      if (/^pi_[A-Za-z0-9_-]+$/.test(legacyPaymentIntentId) && legacyPaymentIntentId.length <= 200) {
        const legacyProvider = await retrievePaymongoIntent(legacyPaymentIntentId);
        if (!providerPaymentMatches(legacyProvider, verifiedAmountCentavos)) {
          throw new HttpsError(
            "failed-precondition",
            "The supplied historical PayMongo intent is not a successful matching PHP payment.",
          );
        }
        const legacySessionRef = db.collection("paymentSessions").doc(legacyPaymentIntentId);
        await db.runTransaction(async (tx) => {
          const [freshPayment, existingSession] = await Promise.all([
            tx.get(paymentRef),
            tx.get(legacySessionRef),
          ]);
          if (
            !freshPayment.exists ||
            freshPayment.data()?.status !== "pending" ||
            String(freshPayment.data()?.userId ?? "") !== verifiedUserId ||
            Math.round(Number(freshPayment.data()?.amount ?? 0) * 100) !== verifiedAmountCentavos ||
            String(freshPayment.data()?.method ?? "") !== "online" ||
            String(freshPayment.data()?.checkoutSessionId ?? "")
          ) {
            throw new HttpsError("aborted", "Historical payment changed during verification.");
          }
          if (existingSession.exists && (
            String(existingSession.data()?.userId ?? "") !== verifiedUserId ||
            String(existingSession.data()?.paymentId ?? "") !== paymentId
          )) {
            throw new HttpsError("already-exists", "That PayMongo intent is already linked to another payment.");
          }
          tx.set(legacySessionRef, {
            userId: verifiedUserId,
            amount: verifiedAmountCentavos / 100,
            amountInCentavos: verifiedAmountCentavos,
            paymentMethod: "legacy_online",
            status: "used",
            attemptStatus: "paid",
            providerStatus: "succeeded",
            paymentId,
            legacyLinkedAt: FieldValue.serverTimestamp(),
            legacyLinkedBy: adminUid,
          }, {merge: true});
          tx.update(paymentRef, {
            checkoutSessionId: legacyPaymentIntentId,
            verificationStatus: "legacy_provider_verified",
            legacyVerifiedBy: adminUid,
            legacyVerifiedAt: FieldValue.serverTimestamp(),
          });
        });
        verifiedCheckoutSessionId = legacyPaymentIntentId;
      } else {
      await paymentRef.set({
        verificationStatus: "legacy_manual_review_required",
        verificationMessage: "Historical online payment has no PayMongo Intent ID.",
        verificationCheckedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      throw new HttpsError(
        "failed-precondition",
        "This historical payment requires manual PayMongo Dashboard review because it has no provider session ID.",
      );
      }
    }
    const verificationSessionRef = db.collection("paymentSessions").doc(verifiedCheckoutSessionId);
    const verificationSessionSnap = await verificationSessionRef.get();
    if (!verificationSessionSnap.exists || verificationSessionSnap.data()?.userId !== verificationPayment.userId) {
      throw new HttpsError("failed-precondition", "Payment session ownership could not be verified.");
    }
    if (String(verificationSessionSnap.data()?.paymentId ?? "") !== paymentId) {
      throw new HttpsError("failed-precondition", "Payment session is not linked to this payment record.");
    }
    if (
      Math.round(Number(verificationSessionSnap.data()?.amount ?? 0) * 100) !==
      Math.round(Number(verificationPayment.amount ?? 0) * 100)
    ) {
      throw new HttpsError("failed-precondition", "Payment amount does not match its provider session.");
    }
    const provider = isTestSimulation
      ? {status: "succeeded", amount: verifiedAmountCentavos, currency: "PHP"}
      : await retrievePaymongoIntent(verifiedCheckoutSessionId);
    if (provider.status !== "succeeded") {
      const attemptStatus = classifyPaymentAttempt(
        provider,
        Number(verificationSessionSnap.data()?.expiresAt ?? 0) > 0 &&
          Number(verificationSessionSnap.data()?.expiresAt) < Date.now(),
        verificationSessionSnap.data()?.attemptStatus,
      );
      await verificationSessionRef.set({
        attemptStatus,
        providerStatus: String(provider.status ?? ""),
        lastVerifiedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      throw new HttpsError(
        "failed-precondition",
        attemptStatus === "processing"
          ? "PayMongo is still processing this payment. Try again after verification completes."
          : "PayMongo has not confirmed this payment as successful.",
      );
    }
    if (!providerPaymentMatches(provider, verifiedAmountCentavos)) {
      throw new HttpsError("failed-precondition", "PayMongo amount or currency does not match this payment.");
    }
    await verificationSessionRef.set({
      attemptStatus: "paid",
      providerStatus: "succeeded",
      lastVerifiedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    await paymentRef.set({
      verificationStatus: "provider_verified",
      verificationCheckedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
  }

  return db.runTransaction(async (tx) => {
    const paymentSnap = await tx.get(paymentRef);
    if (!paymentSnap.exists) throw new HttpsError("not-found", "Payment was not found.");
    const payment = paymentSnap.data()!;
    if (payment.status !== "pending") {
      throw new HttpsError("failed-precondition", "This payment is no longer pending.");
    }
    const verifiedSessionSnap = await tx.get(db.collection("paymentSessions").doc(verifiedCheckoutSessionId));
    if (!verifiedSessionSnap.exists || !paymentApprovalBindingMatches({
      payment,
      session: verifiedSessionSnap.data()!,
      paymentId,
      checkoutSessionId: verifiedCheckoutSessionId,
      userId: verifiedUserId,
      amountCentavos: verifiedAmountCentavos,
    })) {
      throw new HttpsError("aborted", "Payment session changed after provider verification.");
    }

    const tenantId = String(payment.userId ?? "");
    const tenantRef = db.collection("users").doc(tenantId);
    const tenantSnap = await tx.get(tenantRef);
    if (!tenantSnap.exists || tenantSnap.data()?.role !== "tenant") {
      throw new HttpsError("not-found", "Tenant account was not found.");
    }
    const tenant = tenantSnap.data()!;
    if (tenant.status !== "active") {
      throw new HttpsError("failed-precondition", "Tenant is not active.");
    }

    const verifiedSession = verifiedSessionSnap.data()!;
    const quotedPeriodsCovered = Number(verifiedSession.periodsCovered);
    const quotedAdvancePeriods = Number(verifiedSession.advancePeriods);
    const quotedPeriodCharge = Number(verifiedSession.periodCharge);
    const quotedCoverageStart = verifiedSession.coverageStartAt?.toDate?.();
    const quotedPaidThrough = verifiedSession.paidThroughAt?.toDate?.();
    const quotedBreakdown = Array.isArray(verifiedSession.quoteBreakdown)
      ? verifiedSession.quoteBreakdown
      : [];
    if (
      Number.isInteger(quotedPeriodsCovered) && quotedPeriodsCovered > 0 &&
      Number.isInteger(quotedAdvancePeriods) && quotedAdvancePeriods >= 0 &&
      Number.isFinite(quotedPeriodCharge) && quotedPeriodCharge > 0 &&
      quotedCoverageStart instanceof Date && !Number.isNaN(quotedCoverageStart.getTime()) &&
      quotedPaidThrough instanceof Date && !Number.isNaN(quotedPaidThrough.getTime())
    ) {
      tx.update(paymentRef, {
        status: "approved",
        approvedAt: Timestamp.now(),
        verifiedBy: adminUid,
        paidAt: payment.date ?? Timestamp.now(),
        paymentSchedule: String(verifiedSession.paymentSchedule ?? tenant.paymentSchedule ?? "monthly"),
        intervalDays: Number(verifiedSession.intervalDays ?? 1),
        periodsCovered: quotedPeriodsCovered,
        periodsAdvance: quotedAdvancePeriods,
        coverageStartAt: Timestamp.fromDate(quotedCoverageStart),
        paidThroughAt: Timestamp.fromDate(quotedPaidThrough),
        nextDueAt: Timestamp.fromDate(quotedPaidThrough),
        appliedAmount: Number(payment.amount ?? 0),
        billingCreditAfter: Number(tenant.billingCredit ?? 0),
        "receiptData.status": "Approved",
        "receiptData.rentAmount": quotedPeriodCharge,
        "receiptData.breakdown": quotedBreakdown,
      });
      tx.update(tenantRef, {
        lastApprovedPaymentAt: Timestamp.now(),
        paidThroughAt: Timestamp.fromDate(quotedPaidThrough),
        nextDueAt: Timestamp.fromDate(quotedPaidThrough),
      });
      return {
        paymentId,
        periodsCovered: quotedPeriodsCovered,
        coverageStartAt: quotedCoverageStart.toISOString(),
        nextDueAt: quotedPaidThrough.toISOString(),
        billingCredit: Number(tenant.billingCredit ?? 0),
      };
    }

    const schedule = String(tenant.paymentSchedule ?? "monthly").trim().toLowerCase();
    const intervalDays = paymentIntervalDaysFor(schedule);
    const dailyRate = Number(tenant.price ?? 0);
    const amount = Number(payment.amount ?? 0);
    const existingCredit = Number(tenant.billingCredit ?? 0);
    const periodCharge = dailyRate * intervalDays;
    if (!Number.isFinite(periodCharge) || periodCharge <= 0 || !Number.isFinite(amount) || amount <= 0) {
      throw new HttpsError("failed-precondition", "The payment or rental rate is invalid.");
    }

    const available = amount + (Number.isFinite(existingCredit) ? Math.max(0, existingCredit) : 0);
    const periodsCovered = Math.floor((available + 0.000001) / periodCharge);
    if (periodsCovered < 1) {
      throw new HttpsError("failed-precondition", "The payment does not cover one complete billing interval.");
    }
    const billingCredit = Math.max(0, Math.round((available - periodsCovered * periodCharge) * 100) / 100);

    const now = Timestamp.now();
    const rawStart = tenant.nextDueAt ?? tenant.billingStartedAt ?? tenant.createdAt;
    const coverageStart = rawStart?.toDate ? rawStart.toDate() : now.toDate();
    const coverageEnd = new Date(coverageStart);
    coverageEnd.setDate(coverageEnd.getDate() + intervalDays * periodsCovered);
    const nextDueAt = Timestamp.fromDate(coverageEnd);
    const periodsDue = billingPeriodsDueAt(coverageStart, intervalDays, now.toDate());
    const periodsAdvance = Math.max(0, periodsCovered - periodsDue);
    let priorCreditRemaining = Number.isFinite(existingCredit) ? Math.max(0, existingCredit) : 0;
    const authoritativeBreakdown = Array.from({length: periodsCovered}, (_, index) => {
      const periodStart = new Date(coverageStart);
      periodStart.setDate(periodStart.getDate() + intervalDays * index);
      const priorCreditApplied = Math.min(priorCreditRemaining, periodCharge);
      priorCreditRemaining -= priorCreditApplied;
      return {
        label: `${intervalDays} ${intervalDays === 1 ? "day" : "days"} rent from ${periodStart.toLocaleDateString("en-PH", {year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila"})}`,
        amount: periodCharge - priorCreditApplied,
      };
    });
    const appliedFromThisPayment = authoritativeBreakdown.reduce((sum, line) => sum + line.amount, 0);
    const creditFromThisPayment = Math.max(0, Math.round((amount - appliedFromThisPayment) * 100) / 100);
    if (creditFromThisPayment > 0) {
      authoritativeBreakdown.push({label: "Remaining billing credit", amount: creditFromThisPayment});
    }

    tx.update(paymentRef, {
      status: "approved",
      approvedAt: now,
      verifiedBy: adminUid,
      paidAt: payment.date ?? now,
      paymentSchedule: schedule,
      intervalDays,
      periodsCovered,
      periodsAdvance,
      coverageStartAt: Timestamp.fromDate(coverageStart),
      paidThroughAt: nextDueAt,
      nextDueAt,
      appliedAmount: periodsCovered * periodCharge,
      billingCreditAfter: billingCredit,
      "receiptData.status": "Approved",
      "receiptData.rentAmount": periodCharge,
      "receiptData.breakdown": authoritativeBreakdown,
    });
    tx.update(tenantRef, {
      lastApprovedPaymentAt: now,
      paidThroughAt: nextDueAt,
      nextDueAt,
      billingCredit,
    });

    return {
      paymentId,
      periodsCovered,
      coverageStartAt: coverageStart.toISOString(),
      nextDueAt: coverageEnd.toISOString(),
      billingCredit,
    };
  });
});

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
  await checkRateLimit(`adminCreateTenant:${adminUid}`, 30, 60 * 60_000);

  const input = inputObject(request.data);
  const firstName = validName(input.firstName, "First name");
  const middleNameInput = typeof input.middleName === "string" ? input.middleName.trim() : "";
  const middleName = middleNameInput ? validName(middleNameInput, "Middle name") : "";
  const lastName = validName(input.lastName, "Last name");
  // Usernames are canonical uppercase identifiers. Login remains
  // case-insensitive through resolveLoginEmail, while a single stored form
  // prevents RWJAYCEE/rwjaycee from becoming separate accounts.
  const username = validUsername(input.username).toUpperCase();
  const contactNo = validPhilippinePhone(input.contactNo);
  const password = validPassword(input.password);
  const stallId = requiredText(input.stallId, "Stall ID", 128);

  const email = `${username}@rentwise.app`;

  let createdUser: Awaited<ReturnType<typeof auth.createUser>> | undefined;

  try {
    const [sameCaseUsername, lowerCaseUsername] = await Promise.all([
      db.collection("users").where("username", "==", username).limit(1).get(),
      db.collection("users").where("username", "==", username.toLowerCase()).limit(1).get(),
    ]);
    if (!sameCaseUsername.empty || !lowerCaseUsername.empty) {
      throw new HttpsError("already-exists", "This username is already in use.");
    }

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
    const createdUid = createdUser.uid;

    const userRef = db.collection("users").doc(createdUid);
    const billingStartedAt = Timestamp.now();
    const initialSchedule = String(stallData.paymentSchedule ?? "monthly");
    const stallRef = db.collection("stalls").doc(stallId);
    await db.runTransaction(async (tx) => {
      const currentStall = await tx.get(stallRef);
      if (!currentStall.exists) throw new HttpsError("not-found", "Stall does not exist.");
      const current = currentStall.data()!;
      if (String(current.status ?? "unoccupied").toLowerCase() !== "unoccupied" || current.tenantId) {
        throw new HttpsError("already-exists", "Stall is already occupied.");
      }
      const dailyRate = Number(current.price ?? 0);
      const schedule = String(current.paymentSchedule ?? initialSchedule);
      tx.set(userRef, {
        firstName,
        middleName,
        lastName,
        username,
        email,
        personalEmail: email,
        contactNo,
        role: "tenant",
        status: "active",
        stallId,
        primaryStallId: stallId,
        stallIds: [stallId],
        stallAssignments: [{stallId, dailyRate, assignedAt: billingStartedAt}],
        assignmentVersion: 1,
        price: dailyRate,
        paymentSchedule: schedule,
        paymentIntervalDays: Number(current.paymentIntervalDays) || paymentIntervalDaysFor(schedule),
        category: current.category ?? "",
        mustChangePassword: true,
        createdAt: billingStartedAt,
        billingStartedAt,
        nextDueAt: billingStartedAt,
        lastApprovedPaymentAt: null,
        paidThroughAt: null,
      });
      tx.update(stallRef, {
        tenantId: createdUid,
        tenantName: [firstName, middleName, lastName].filter(Boolean).join(" "),
        status: "occupied",
      });
    });

    return {
      success: true,
      uid: createdUid,
      username,
    };
  } catch (error) {
    // rollback Auth account
    if (createdUser) {
      await auth.deleteUser(createdUser.uid);
    }

    console.error(error);

    if (error instanceof HttpsError) {
      throw error;
    }

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
  await auth.revokeRefreshTokens(uid);
  await clearAccountLoginLockout("tenant", uid);
  await db.collection("users").doc(uid).update({
    sessionRevokedAt: FieldValue.serverTimestamp(),
    mustChangePassword: true,
  });
  const pendingResetRequests = await db.collection("passwordResetRequests")
    .where("tenantId", "==", uid)
    .where("requestedRole", "==", "tenant")
    .where("status", "==", "pending")
    .get();
  if (!pendingResetRequests.empty) {
    const batch = db.batch();
    pendingResetRequests.docs.forEach((requestDoc) => batch.update(requestDoc.ref, {
      status: "resolved",
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: callerUid,
    }));
    await batch.commit();
  }

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
  await assertIsAdminOrOwner(callerUid);

  // Verify the target account is actually an admin, not an arbitrary user
  await assertIsAdmin(uid);

  await auth.updateUser(uid, { password: newPassword });
  await auth.revokeRefreshTokens(uid);
  await clearAccountLoginLockout("admin", uid);
  await db.collection("users").doc(uid).update({
    sessionRevokedAt: FieldValue.serverTimestamp(),
  });

  const pendingResetRequests = await db.collection("passwordResetRequests")
    .where("tenantId", "==", uid)
    .where("requestedRole", "==", "admin")
    .where("status", "==", "pending")
    .get();
  if (!pendingResetRequests.empty) {
    const batch = db.batch();
    pendingResetRequests.docs.forEach((requestDoc) => batch.update(requestDoc.ref, {
      status: "resolved",
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: callerUid,
    }));
    await batch.commit();
  }

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
  const requestedUsername = validUsername(input.username).toUpperCase();
  const username = "RWADMIN";
  if (requestedUsername !== username) {
    throw new HttpsError("invalid-argument", "The admin username must be RWADMIN.");
  }
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
  const advancePeriods = Number(input?.advancePeriods ?? 0);
  const paymentMethod = input?.paymentMethod;
  if (!Number.isInteger(advancePeriods) || advancePeriods < 0) {
    throw new HttpsError("invalid-argument", "Advance quantity must be a whole number.");
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
  const schedule = String(tenant.paymentSchedule ?? "monthly").trim().toLowerCase();
  const intervalDays = paymentIntervalDaysFor(schedule);
  const maxAdvancePeriods = advancePaymentLimitFor(schedule);
  if (advancePeriods > maxAdvancePeriods) {
    throw new HttpsError(
      "invalid-argument",
      `Maximum advance is ${maxAdvancePeriods} payment intervals.`,
    );
  }
  const storedNextDue = tenant.nextDueAt ?? tenant.billingStartedAt ?? tenant.createdAt;
  const nextDueAt = storedNextDue?.toDate ? storedNextDue.toDate() : null;
  const minimumDue = await getOutstandingBalance(
    callerUid,
    schedule,
    dailyRate,
    new Date(),
    nextDueAt,
  );
  const normalizedMinimum = Math.round(minimumDue * 100) / 100;
  const periodCharge = Math.round(dailyRate * intervalDays * 100) / 100;
  const normalizedAmount = Math.round((normalizedMinimum + advancePeriods * periodCharge) * 100) / 100;
  if (normalizedAmount <= 0 || normalizedAmount > 10_000_000) {
    throw new HttpsError(
      "failed-precondition",
      advancePeriods > 0
        ? "The calculated advance payment is invalid."
        : "There is no outstanding balance to pay.",
    );
  }
  const periodsDue = periodCharge > 0 ? Math.round(normalizedMinimum / periodCharge) : 0;
  const periodsCovered = periodsDue + advancePeriods;
  const coverageStart = nextDueAt ?? new Date();
  const coverageEnd = new Date(coverageStart);
  coverageEnd.setDate(coverageEnd.getDate() + intervalDays * periodsCovered);
  const quoteBreakdown = Array.from({length: periodsCovered}, (_, index) => {
    const periodStart = new Date(coverageStart);
    periodStart.setDate(periodStart.getDate() + intervalDays * index);
    return {
      label: `${index >= periodsDue ? "Advance - " : ""}${intervalDays} ${intervalDays === 1 ? "day" : "days"} rent from ${periodStart.toLocaleDateString("en-PH", {year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila"})}`,
      amount: periodCharge,
    };
  });

  // A tenant may have only one unresolved provider attempt for the current
  // obligation. Old/legacy sessions remain compatible because their
  // existing `status: created|used` field is still authoritative for use.
  const [sessionQuery, paymentQuery] = await Promise.all([
    db.collection("paymentSessions").where("userId", "==", callerUid).get(),
    db.collection("payments").where("userId", "==", callerUid).get(),
  ]);
  if (paymentQuery.docs.some((paymentDoc) => {
    const payment = paymentDoc.data();
    return payment.method === "online" && payment.status === "pending";
  })) {
    throw new HttpsError("already-exists", "A verified online payment is already awaiting Admin confirmation.");
  }
  let hasUncertainProviderSession = false;
  for (const sessionDoc of sessionQuery.docs) {
    const existing = sessionDoc.data();
    if (existing.status !== "created") continue;
    let provider: PaymongoIntentAttributes;
    try {
      provider = await retrievePaymongoIntent(sessionDoc.id);
    } catch (error) {
      if (error instanceof HttpsError && error.code === "not-found") {
        await sessionDoc.ref.set({
          attemptStatus: "failed",
          providerStatus: "not_found",
          lastVerifiedAt: FieldValue.serverTimestamp(),
        }, {merge: true});
        continue;
      }
      hasUncertainProviderSession = true;
      await sessionDoc.ref.set({
        verificationStatus: "temporarily_unavailable",
        lastVerificationAttemptAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      continue;
    }
    const attemptStatus = classifyPaymentAttempt(
      provider,
      Number(existing.expiresAt ?? 0) > 0 && Number(existing.expiresAt) < Date.now(),
      existing.attemptStatus,
    );
    await sessionDoc.ref.set({
      attemptStatus,
      providerStatus: String(provider.status ?? ""),
      lastVerifiedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    if (!isRetryableAttempt(attemptStatus)) {
      throw new HttpsError(
        "already-exists",
        attemptStatus === "processing"
          ? "Your previous payment is still being verified."
          : attemptStatus === "paid"
            ? "Your previous payment was successful and is being recovered."
            : "You already have an active payment session.",
      );
    }
  }
  if (hasUncertainProviderSession) {
    throw new HttpsError(
      "unavailable",
      "A previous payment could not be verified safely. Please try again shortly.",
    );
  }

  const secretKey = paymongoSecretKey.value();
  if (!secretKey) {
    console.error("PAYMONGO_SECRET_KEY is not configured");
    throw new HttpsError("failed-precondition", "Payment service is not configured.");
  }
  if (!secretKey.startsWith("sk_test_")) {
    console.error("PayMongo demo checkout refused because the configured key is not a test key");
    throw new HttpsError(
      "failed-precondition",
      "Demo payments require PayMongo test mode. No payment was created.",
    );
  }

  // Serializes concurrent taps/devices for this tenant. The short creating
  // lease is only a mutex; it does not change the one-hour payment-session
  // expiry or PayMongo's independent QR expiry.
  const creationLockRef = db.collection("paymentAttemptLocks").doc(callerUid);
  const creationToken = randomBytes(16).toString("hex");
  await db.runTransaction(async (tx) => {
    const lockSnap = await tx.get(creationLockRef);
    const lock = lockSnap.data();
    if (lock?.state === "creating" && Number(lock.leaseExpiresAt ?? 0) > Date.now()) {
      throw new HttpsError("already-exists", "A payment session is already being created.");
    }
    tx.set(creationLockRef, {
      userId: callerUid,
      state: "creating",
      creationToken,
      leaseExpiresAt: Date.now() + 2 * 60_000,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
  };
  const amountInCentavos = Math.round(normalizedAmount * 100);

  let paymentIntentId = "";
  try {
  const intentResponse = await fetch("https://api.paymongo.com/v1/payment_intents", {
    method: "POST",
    headers,
    body: JSON.stringify({
      data: {
        attributes: {
          amount: amountInCentavos,
          currency: "PHP",
          payment_method_allowed: [paymentMethod],
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
  paymentIntentId = intent.data?.id ?? "";
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
    data?: {attributes?: {
      status?: string;
      next_action?: {redirect?: {url?: string}; code?: {image_url?: string}};
    }};
  };
  const redirectUrl = attached.data?.attributes?.next_action?.redirect?.url ??
    attached.data?.attributes?.next_action?.code?.image_url;
  if (!redirectUrl) throw new HttpsError("internal", "Payment authorization details were not returned.");

  const sessionRef = db.collection("paymentSessions").doc(paymentIntentId);
  await db.runTransaction(async (tx) => {
    const currentLock = await tx.get(creationLockRef);
    if (!ownsPaymentCreationLock(currentLock.data(), creationToken)) {
      throw new HttpsError(
        "aborted",
        "Payment session creation was superseded. No checkout was activated; please try again.",
      );
    }
    tx.create(sessionRef, {
      userId: callerUid,
      amount: normalizedAmount,
      amountInCentavos,
      baseAmountDue: normalizedMinimum,
      advancePeriods,
      advanceAmount: Math.round(advancePeriods * periodCharge * 100) / 100,
      periodsDue,
      periodsCovered,
      periodCharge,
      intervalDays,
      paymentSchedule: schedule,
      coverageStartAt: Timestamp.fromDate(coverageStart),
      paidThroughAt: Timestamp.fromDate(coverageEnd),
      quoteBreakdown,
      paymentMethod,
      redirectUrl,
      status: "created",
      attemptStatus: "pending",
      providerStatus: String(attached.data?.attributes?.status ?? "awaiting_next_action"),
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Date.now() + 60 * 60_000,
    });
    tx.set(creationLockRef, {
      userId: callerUid,
      state: "active",
      creationToken,
      sessionId: paymentIntentId,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    paymentIntentId,
    redirectUrl,
    amount: normalizedAmount,
    baseAmountDue: normalizedMinimum,
    advancePeriods,
    advanceAmount: Math.round(advancePeriods * periodCharge * 100) / 100,
    paidThroughAt: coverageEnd.toISOString(),
  };
  } catch (error) {
    const currentLock = await creationLockRef.get();
    if (currentLock.data()?.creationToken === creationToken) {
      await creationLockRef.set({state: "released", updatedAt: FieldValue.serverTimestamp()}, {merge: true});
    }
    throw error;
  }
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
  if (session.userId !== callerUid) {
    throw new HttpsError("failed-precondition", "Payment session is invalid or expired.");
  }
  if (session.status === "used" && session.paymentId) {
    return {status: "recorded", paymentId: String(session.paymentId), receiptNo: ""};
  }
  if (
    session.status !== "created" ||
    Math.round(Number(session.amount) * 100) !== Math.round(amount * 100)
  ) {
    throw new HttpsError("failed-precondition", "Payment session is invalid or expired.");
  }
  const expectedMethod = paymentMethodLabel(session.paymentMethod);
  if (paymentMethod !== expectedMethod) {
    throw new HttpsError("failed-precondition", "Payment method does not match the session.");
  }

  const provider = await retrievePaymongoIntent(checkoutSessionId);
  const providerStatus = String(provider.status ?? "");
  const attemptStatus = classifyPaymentAttempt(
    provider,
    Number(session.expiresAt ?? 0) > 0 && Number(session.expiresAt) < Date.now(),
    session.attemptStatus,
  );
  if (attemptStatus !== "paid") {
    await sessionRef.set({
      attemptStatus,
      providerStatus,
      lastVerifiedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    return {status: attemptStatus, providerStatus};
  }

  const tenantSnap = await db.collection("users").doc(callerUid).get();
  if (!tenantSnap.exists || tenantSnap.data()?.role !== "tenant") {
    throw new HttpsError("permission-denied", "Tenant access required.");
  }
  const tenant = tenantSnap.data()!;
  if (tenant.status && tenant.status !== "active") {
    throw new HttpsError("permission-denied", "This tenant account is not active.");
  }
  const stalls = await paymentStallSnapshots(tenant);
  const primaryStallId = String(tenant.primaryStallId ?? tenant.stallId ?? stalls[0]?.stallId ?? "");
  const primaryStall = stalls.find((item) => item.stallId === primaryStallId) ?? stalls[0];

  const finiteNonNegative = (value: unknown): number => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
  };
  const boundedInteger = (value: unknown, fallback: number): number => {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 400
      ? numeric
      : fallback;
  };
  const rawBreakdown = Array.isArray(session.quoteBreakdown)
    ? session.quoteBreakdown.slice(0, 400)
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
  const rentAmount = finiteNonNegative(session.periodCharge);
  const periodsCovered = boundedInteger(session.periodsCovered, 1);
  const periodsAdvance = boundedInteger(session.advancePeriods, 0);
  const receiptData = {
    receiptNo,
    tenantName,
    buildingNumber: primaryStall?.buildingNumber ?? "",
    spaceId: primaryStall?.spaceId ?? "",
    stalls,
    paymentMethod,
    date: new Date().toISOString(),
    rentAmount,
    payment: amount,
    change: 0,
    status: "PENDING",
    breakdown,
  };

  const paymentRef = db.collection("payments").doc();
  const recordedPaymentId = await db.runTransaction(async (tx) => {
    const freshSessionSnap = await tx.get(sessionRef);
    if (!freshSessionSnap.exists) {
      throw new HttpsError("failed-precondition", "Payment session was not found.");
    }
    if (freshSessionSnap.data()?.status === "used") {
      return String(freshSessionSnap.data()?.paymentId ?? "");
    }
    if (freshSessionSnap.data()?.status !== "created") {
      throw new HttpsError("failed-precondition", "Payment session is invalid.");
    }
    tx.set(paymentRef, {
      userId: callerUid,
      amount,
      rentAmount,
      periodsCovered,
      periodsAdvance,
      baseAmountDue: finiteNonNegative(session.baseAmountDue),
      advanceAmount: finiteNonNegative(session.advanceAmount),
      paymentSchedule: String(session.paymentSchedule ?? tenant.paymentSchedule ?? "monthly"),
      intervalDays: boundedInteger(session.intervalDays, 30),
      coverageStartAt: session.coverageStartAt ?? null,
      paidThroughAt: session.paidThroughAt ?? null,
      method: "online",
      status: "pending",
      providerStatus,
      tenantName,
      buildingNumber: primaryStall?.buildingNumber ?? "",
      spaceId: primaryStall?.spaceId ?? "",
      stallId: primaryStallId,
      stallIds: stalls.map((item) => item.stallId),
      stalls,
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
      attemptStatus: "paid",
      providerStatus: "succeeded",
      paymentId: paymentRef.id,
      usedAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.collection("paymentAttemptLocks").doc(callerUid), {
      userId: callerUid,
      state: "recorded",
      sessionId: checkoutSessionId,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    return paymentRef.id;
  });

  return {status: "recorded", paymentId: recordedPaymentId, receiptNo};
});

// Recovers a verified wallet payment when Android killed the app or the
// provider redirect never reached the client. The session already contains
// the server-validated amount and method, so no financial values are trusted
// from the device during reconciliation.
export const reconcileTenantPayment = onCall(
  {secrets: [paymongoSecretKey]},
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError("unauthenticated", "You must be logged in.");
    const checkoutSessionId = String(request.data?.checkoutSessionId ?? "").trim();
    if (!checkoutSessionId || checkoutSessionId.length > 200) {
      throw new HttpsError("invalid-argument", "Invalid payment session.");
    }

    const sessionRef = db.collection("paymentSessions").doc(checkoutSessionId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists || sessionSnap.data()?.userId !== callerUid) {
      throw new HttpsError("not-found", "Payment session was not found.");
    }
    const session = sessionSnap.data()!;
    if (session.status === "used") {
      return {status: "recorded", paymentId: String(session.paymentId ?? "")};
    }

    const provider = await retrievePaymongoIntent(checkoutSessionId);
    const providerStatus = String(provider.status ?? "");
    const attemptStatus = classifyPaymentAttempt(
      provider,
      Number(session.expiresAt ?? 0) > 0 && Number(session.expiresAt) < Date.now(),
      session.attemptStatus,
    );
    if (attemptStatus !== "paid") {
      await sessionRef.set({
        attemptStatus,
        providerStatus,
        lastVerifiedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      return {status: attemptStatus, providerStatus};
    }

    const tenantSnap = await db.collection("users").doc(callerUid).get();
    if (!tenantSnap.exists || tenantSnap.data()?.role !== "tenant") {
      throw new HttpsError("permission-denied", "Tenant access required.");
    }
    const tenant = tenantSnap.data()!;
    const stalls = await paymentStallSnapshots(tenant);
    const primaryStallId = String(tenant.primaryStallId ?? tenant.stallId ?? stalls[0]?.stallId ?? "");
    const primaryStall = stalls.find((item) => item.stallId === primaryStallId) ?? stalls[0];
    const amount = Number(session.amount ?? 0);
    const paymentMethod = paymentMethodLabel(session.paymentMethod) || "Online";
    const tenantName = [tenant.firstName, tenant.middleName, tenant.lastName].filter(Boolean).join(" ");
    const receiptNo = `RW-ONLINE-${Date.now().toString().slice(-8)}`;
    const schedule = String(session.paymentSchedule ?? tenant.paymentSchedule ?? "monthly").trim().toLowerCase();
    const intervalDays = Number(session.intervalDays ?? paymentIntervalDaysFor(schedule));
    const rentAmount = Number(session.periodCharge ?? Number(tenant.price ?? 0) * intervalDays);
    const sessionBreakdown = Array.isArray(session.quoteBreakdown) ? session.quoteBreakdown : [];
    const receiptData = {
      receiptNo,
      tenantName,
      buildingNumber: primaryStall?.buildingNumber ?? "",
      spaceId: primaryStall?.spaceId ?? "",
      stalls,
      paymentMethod,
      date: new Date().toISOString(),
      rentAmount,
      payment: amount,
      change: 0,
      status: "PENDING",
      breakdown: sessionBreakdown,
    };
    const paymentRef = db.collection("payments").doc();
    const recordedPaymentId = await db.runTransaction(async (tx) => {
      const freshSession = await tx.get(sessionRef);
      if (!freshSession.exists) throw new HttpsError("not-found", "Payment session was not found.");
      if (freshSession.data()?.status === "used") return String(freshSession.data()?.paymentId ?? "");
      tx.set(paymentRef, {
        userId: callerUid,
        amount,
        rentAmount,
        periodsCovered: Number(session.periodsCovered ?? 0),
        periodsAdvance: Number(session.advancePeriods ?? 0),
        baseAmountDue: Number(session.baseAmountDue ?? 0),
        advanceAmount: Number(session.advanceAmount ?? 0),
        method: "online",
        status: "pending",
        providerStatus,
        tenantName,
        buildingNumber: primaryStall?.buildingNumber ?? "",
        spaceId: primaryStall?.spaceId ?? "",
        stallId: primaryStallId,
        stallIds: stalls.map((item) => item.stallId),
        stalls,
        receiptNo,
        checkoutSessionId,
        paymentMethod,
        paymentSchedule: schedule,
        intervalDays,
        receiptData,
        receipt: null,
        paymentId: null,
        cashReceived: null,
        change: 0,
        date: FieldValue.serverTimestamp(),
        recoveredAt: FieldValue.serverTimestamp(),
      });
      tx.update(sessionRef, {
        status: "used",
        attemptStatus: "paid",
        providerStatus: "succeeded",
        paymentId: paymentRef.id,
        usedAt: FieldValue.serverTimestamp(),
        recoveredAt: FieldValue.serverTimestamp(),
      });
      return paymentRef.id;
    });
    return {status: "recorded", paymentId: recordedPaymentId};
  },
);

// Finds a tenant's unresolved session without trusting device storage. The
// client can then call reconcileTenantPayment with the returned session ID.
export const recoverTenantPaymentSession = onCall(
  {secrets: [paymongoSecretKey]},
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError("unauthenticated", "You must be logged in.");
    const tenantSnap = await db.collection("users").doc(callerUid).get();
    if (!tenantSnap.exists || tenantSnap.data()?.role !== "tenant") {
      throw new HttpsError("permission-denied", "Tenant access required.");
    }

    const snapshot = await db.collection("paymentSessions").where("userId", "==", callerUid).get();
    const candidates = snapshot.docs
      .filter((docSnap) => docSnap.data().status === "created")
      .sort((a, b) => Number(b.data().createdAt?.toMillis?.() ?? 0) - Number(a.data().createdAt?.toMillis?.() ?? 0));

    for (const candidate of candidates) {
      const session = candidate.data();
      let provider: PaymongoIntentAttributes;
      try {
        provider = await retrievePaymongoIntent(candidate.id);
      } catch (error) {
        if (error instanceof HttpsError && error.code === "not-found") {
          await candidate.ref.set({
            attemptStatus: "failed",
            providerStatus: "not_found",
            lastVerifiedAt: FieldValue.serverTimestamp(),
          }, {merge: true});
        } else {
          await candidate.ref.set({
            verificationStatus: "temporarily_unavailable",
            lastVerificationAttemptAt: FieldValue.serverTimestamp(),
          }, {merge: true});
        }
        continue;
      }
      const attemptStatus = classifyPaymentAttempt(
        provider,
        Number(session.expiresAt ?? 0) > 0 && Number(session.expiresAt) < Date.now(),
        session.attemptStatus,
      );
      await candidate.ref.set({
        attemptStatus,
        providerStatus: String(provider.status ?? ""),
        lastVerifiedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      if (!isRetryableAttempt(attemptStatus)) {
        const providerNextAction = (provider as any).next_action;
        const providerRedirectUrl = providerNextAction?.redirect?.url ?? providerNextAction?.code?.image_url;
        const storedRedirectUrl = typeof session.redirectUrl === "string" ? session.redirectUrl : "";
        const redirectUrl = String(providerRedirectUrl ?? storedRedirectUrl);
        return {
          status: attemptStatus,
          sessionId: candidate.id,
          providerStatus: String(provider.status ?? ""),
          redirectUrl: redirectUrl.startsWith("https://") ? redirectUrl : undefined,
          amount: Number(session.amount ?? 0),
          paymentMethod: String(session.paymentMethod ?? ""),
        };
      }
    }
    return {status: "none"};
  },
);

// Cancels only an unresolved provider intent. A provider success or processing
// response always wins over the device's close/background event.
export const interruptTenantPaymentSession = onCall(
  {secrets: [paymongoSecretKey]},
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError("unauthenticated", "You must be logged in.");
    const checkoutSessionId = String(request.data?.checkoutSessionId ?? "").trim();
    if (!checkoutSessionId || checkoutSessionId.length > 200) {
      throw new HttpsError("invalid-argument", "Invalid payment session.");
    }

    const sessionRef = db.collection("paymentSessions").doc(checkoutSessionId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists || sessionSnap.data()?.userId !== callerUid) {
      throw new HttpsError("not-found", "Payment session was not found.");
    }
    if (sessionSnap.data()?.status === "used") {
      return {status: "recorded", paymentId: String(sessionSnap.data()?.paymentId ?? "")};
    }

    let provider = await retrievePaymongoIntent(checkoutSessionId);
    let attemptStatus = classifyPaymentAttempt(provider, false, sessionSnap.data()?.attemptStatus);
    if (attemptStatus === "paid" || attemptStatus === "processing") {
      return {status: attemptStatus, providerStatus: String(provider.status ?? "")};
    }

    const cancelled = await cancelPaymongoIntent(checkoutSessionId);
    provider = cancelled ?? await retrievePaymongoIntent(checkoutSessionId);
    attemptStatus = classifyPaymentAttempt(provider, false, sessionSnap.data()?.attemptStatus);
    const providerStatus = String(provider.status ?? "");
    await sessionRef.set({
      attemptStatus,
      providerStatus,
      interruptedAt: FieldValue.serverTimestamp(),
      lastVerifiedAt: FieldValue.serverTimestamp(),
    }, {merge: true});

    if (attemptStatus === "cancelled") {
      await db.collection("paymentAttemptLocks").doc(callerUid).set({
        userId: callerUid,
        state: "released",
        sessionId: checkoutSessionId,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    }
    return {status: attemptStatus, providerStatus};
  },
);

export const paymongoPaymentWebhook = onRequest(
  {secrets: [paymongoWebhookSecret]},
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).send("Method not allowed");
      return;
    }
    const rawBody = request.rawBody;
    const signatureHeader = String(request.header("paymongo-signature") ?? "");
    const webhookEventBody = request.body as PaymongoWebhookEvent;
    const webhookSecret = paymongoWebhookSecret.value();
    if (!webhookSecret || !rawBody) {
      response.status(401).send("Invalid signature");
      return;
    }
    const signatureCheck = verifyPaymongoWebhookSignature(
      rawBody,
      signatureHeader,
      webhookSecret,
      webhookEventBody.data?.attributes?.livemode === true,
    );
    if (!signatureCheck.valid) {
      response.status(401).send(signatureCheck.reason === "stale" ? "Stale signature" : "Invalid signature");
      return;
    }

    const event = webhookEventBody;
    const {eventId, eventType, resource, paymentIntentId, attemptStatus} = parsePaymongoWebhookEvent(event);
    if (!eventId || !/^evt_[A-Za-z0-9_-]+$/.test(eventId)) {
      response.status(400).send("Invalid event");
      return;
    }

    const eventRef = db.collection("paymongoWebhookEvents").doc(eventId);
    const paymentRef = db.collection("payments").doc();
    await db.runTransaction(async (tx) => {
      if ((await tx.get(eventRef)).exists) return;
      const sessionRef = paymentIntentId && /^pi_[A-Za-z0-9_-]+$/.test(paymentIntentId)
        ? db.collection("paymentSessions").doc(paymentIntentId)
        : null;
      const sessionSnap = sessionRef ? await tx.get(sessionRef) : null;
      let eventResult = "ignored";

      if (sessionRef && sessionSnap?.exists && attemptStatus === "paid") {
        const session = sessionSnap.data()!;
        const webhookAmount = Number(resource?.attributes?.amount);
        const webhookCurrency = String(resource?.attributes?.currency ?? "").toUpperCase();
        const amountMatches = !Number.isFinite(webhookAmount) ||
          webhookAmount === Number(session.amountInCentavos ?? Math.round(Number(session.amount ?? 0) * 100));
        const currencyMatches = !webhookCurrency || webhookCurrency === "PHP";
        if (!amountMatches || !currencyMatches) {
          eventResult = "rejected_amount_or_currency_mismatch";
        } else if (session.status === "used") {
          eventResult = "already_recorded";
        } else if (session.status === "created") {
          const tenantRef = db.collection("users").doc(String(session.userId ?? ""));
          const tenantSnap = await tx.get(tenantRef);
          if (!tenantSnap.exists || tenantSnap.data()?.role !== "tenant") {
            eventResult = "tenant_not_found";
          } else {
            const tenant = tenantSnap.data()!;
            const stallIds = normalizedTenantStallIds(tenant).slice(0, 3);
            const stallSnaps = await Promise.all(
              stallIds.map((id) => tx.get(db.collection("stalls").doc(id))),
            );
            const stalls = stallSnaps.filter((snap) => snap.exists).map((snap) => ({
              stallId: snap.id,
              buildingNumber: String(snap.data()?.buildingNumber ?? ""),
              spaceId: String(snap.data()?.spaceId ?? snap.id),
              dailyRate: Math.max(0, Number(snap.data()?.price ?? 0)),
            }));
            const primaryStallId = String(tenant.primaryStallId ?? tenant.stallId ?? stalls[0]?.stallId ?? "");
            const primaryStall = stalls.find((item) => item.stallId === primaryStallId) ?? stalls[0];
            const amount = Number(session.amount ?? 0);
            const schedule = String(session.paymentSchedule ?? tenant.paymentSchedule ?? "monthly").trim().toLowerCase();
            const intervalDays = Number(session.intervalDays ?? paymentIntervalDaysFor(schedule));
            const rentAmount = Number(session.periodCharge ?? Number(tenant.price ?? 0) * intervalDays);
            const tenantName = [tenant.firstName, tenant.middleName, tenant.lastName].filter(Boolean).join(" ");
            const receiptNo = `RW-ONLINE-${Date.now().toString().slice(-8)}`;
            const sessionBreakdown = Array.isArray(session.quoteBreakdown) ? session.quoteBreakdown : [];
            tx.create(paymentRef, {
              userId: session.userId,
              amount,
              rentAmount,
              periodsCovered: Number(session.periodsCovered ?? 0),
              periodsAdvance: Number(session.advancePeriods ?? 0),
              baseAmountDue: Number(session.baseAmountDue ?? 0),
              advanceAmount: Number(session.advanceAmount ?? 0),
              method: "online",
              status: "pending",
              providerStatus: "succeeded",
              tenantName,
              buildingNumber: primaryStall?.buildingNumber ?? "",
              spaceId: primaryStall?.spaceId ?? "",
              stallId: primaryStallId,
              stallIds: stalls.map((item) => item.stallId),
              stalls,
              receiptNo,
              checkoutSessionId: paymentIntentId,
              paymentMethod: paymentMethodLabel(session.paymentMethod) || "Online",
              paymentSchedule: schedule,
              intervalDays,
              receiptData: {
                receiptNo,
                tenantName,
                buildingNumber: primaryStall?.buildingNumber ?? "",
                spaceId: primaryStall?.spaceId ?? "",
                stalls,
                paymentMethod: paymentMethodLabel(session.paymentMethod) || "Online",
                date: new Date().toISOString(),
                rentAmount,
                payment: amount,
                change: 0,
                status: "PENDING",
                breakdown: sessionBreakdown,
              },
              receipt: null,
              cashReceived: null,
              change: 0,
              date: FieldValue.serverTimestamp(),
              recoveredAt: FieldValue.serverTimestamp(),
              recoveredBy: "paymongo_webhook",
            });
            tx.update(sessionRef, {
              status: "used",
              attemptStatus: "paid",
              providerStatus: "succeeded",
              paymentId: paymentRef.id,
              usedAt: FieldValue.serverTimestamp(),
              recoveredAt: FieldValue.serverTimestamp(),
              lastWebhookEventId: eventId,
              lastWebhookAt: FieldValue.serverTimestamp(),
            });
            eventResult = "payment_recorded";
          }
        }
      } else if (sessionRef && sessionSnap?.exists && attemptStatus) {
        const current = sessionSnap.data()!;
        // Successful/consumed sessions are monotonic and can never be
        // downgraded by a late or out-of-order failure/expiry delivery.
        if (!mayApplyUnsuccessfulWebhook(current.status, current.attemptStatus)) {
          eventResult = "ignored_after_success";
        } else {
        tx.set(sessionRef, {
          attemptStatus,
          providerStatus: attemptStatus,
          lastWebhookEventId: eventId,
          lastWebhookAt: FieldValue.serverTimestamp(),
        }, {merge: true});
          eventResult = `session_${attemptStatus}`;
        }
      }
      tx.create(eventRef, {
        eventType,
        paymentIntentId: paymentIntentId || null,
        livemode: event.data?.attributes?.livemode === true,
        result: eventResult,
        receivedAt: FieldValue.serverTimestamp(),
      });
    });
    response.status(200).json({received: true});
  },
);

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

export const ownerRestoreArchivedTenant = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "You must be logged in.");
  await assertIsAdminOrOwner(callerUid);
  await checkRateLimit(`ownerRestoreArchivedTenant:${callerUid}`, 30, 60 * 60_000);

  const input = inputObject(request.data);
  const uid = validUid(input.uid);
  const requestedStallId = typeof input.newStallId === "string" ? input.newStallId.trim() : "";
  const transferPreviousInfo = input.transferPreviousInfo !== false;

  // The tenant remains blocked by its archived Firestore status while Auth
  // is enabled. If the transaction loses a stall race, Auth is disabled again.
  await assertTargetRole(uid, "tenant");
  await auth.updateUser(uid, {disabled: false});
  try {
    await db.runTransaction(async (tx) => {
      const userRef = db.collection("users").doc(uid);
      const archiveRef = db.collection("archives").doc(uid);
      const [userSnap, archiveSnap] = await Promise.all([tx.get(userRef), tx.get(archiveRef)]);
      if (!userSnap.exists || userSnap.data()?.role !== "tenant" || !archiveSnap.exists) {
        throw new HttpsError("not-found", "Archived tenant was not found.");
      }

      const user = userSnap.data()!;
      const archive = archiveSnap.data()!;
      const targetStallId = requestedStallId || String(archive.stallId ?? "");
      if (!targetStallId) throw new HttpsError("failed-precondition", "Select an available stall.");
      const stallRef = db.collection("stalls").doc(targetStallId);
      const stallSnap = await tx.get(stallRef);
      if (!stallSnap.exists) throw new HttpsError("not-found", "Selected stall was not found.");
      const stall = stallSnap.data()!;
      if (stall.status !== "unoccupied" || stall.tenantId) {
        throw new HttpsError("already-exists", "Selected stall is no longer available.");
      }

      const movingToNewStall = targetStallId !== String(archive.stallId ?? "");
      const schedule = String(
        movingToNewStall && !transferPreviousInfo
          ? (stall.paymentSchedule ?? "monthly")
          : (user.paymentSchedule ?? "monthly"),
      );
      const category = String(
        movingToNewStall && !transferPreviousInfo
          ? (stall.category ?? "")
          : (user.category ?? ""),
      );
      // Restore always starts a clean active assignment set. Historical
      // multi-stall arrays remain in the archive document for reporting only.
      const price = Number(stall.price ?? 0);
      const intervalDays = paymentIntervalDaysFor(schedule);
      const tenantName = [archive.firstName ?? user.firstName, archive.middleName ?? user.middleName, archive.lastName ?? user.lastName]
        .filter(Boolean).join(" ");

      tx.update(userRef, {
        status: "active",
        stallId: targetStallId,
        primaryStallId: targetStallId,
        stallIds: [targetStallId],
        stallAssignments: [{stallId: targetStallId, dailyRate: price, assignedAt: Timestamp.now()}],
        price,
        paymentSchedule: schedule,
        paymentIntervalDays: intervalDays,
        category,
        assignmentVersion: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.update(stallRef, {
        tenantId: uid,
        tenantName,
        status: "occupied",
        price,
        paymentSchedule: schedule,
        paymentIntervalDays: intervalDays,
        category,
      });
      tx.delete(archiveRef);
    });
  } catch (error) {
    await auth.updateUser(uid, {disabled: true}).catch((rollbackError) => {
      console.error("Failed to re-disable tenant after restore rollback", {uid, rollbackError});
    });
    throw error;
  }

  return {success: true};
});

export const adminRelocateTenant = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "You must be logged in.");
  await assertIsAdmin(callerUid);
  await checkRateLimit(`adminRelocateTenant:${callerUid}`, 60, 60 * 60_000);

  const input = inputObject(request.data);
  const uid = validUid(input.uid);
  const requestedOldStallId = requiredText(input.oldStallId, "Current stall", 128);
  const newStallId = requiredText(input.newStallId, "Destination stall", 128);
  const transferPreviousInfo = input.transferPreviousInfo !== false;
  if (requestedOldStallId === newStallId) {
    throw new HttpsError("invalid-argument", "Choose a different destination stall.");
  }

  const preflightTenantSnap = await db.collection("users").doc(uid).get();
  if (!preflightTenantSnap.exists || preflightTenantSnap.data()?.status !== "active") {
    throw new HttpsError("failed-precondition", "Active tenant account was not found.");
  }
  const preflightTenant = preflightTenantSnap.data()!;
  await assertNoOpenPaymentAttempt(uid, "Finish or cancel the tenant's active payment attempt before relocating a stall.");
  const pendingPayment = await db.collection("payments").where("userId", "==", uid).where("status", "==", "pending").limit(1).get();
  if (!pendingPayment.empty) throw new HttpsError("failed-precondition", "Resolve the tenant's pending payment before relocating a stall.");
  const scheduleForBalance = String(preflightTenant.paymentSchedule ?? "monthly");
  const dueValue = preflightTenant.nextDueAt ?? preflightTenant.billingStartedAt ?? preflightTenant.createdAt;
  const dueAt = dueValue?.toDate ? dueValue.toDate() : null;
  const balance = await getOutstandingBalance(
    uid,
    scheduleForBalance,
    Number(preflightTenant.price ?? 0),
    new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Manila"})),
    dueAt,
  );
  if (balance > 0) throw new HttpsError("failed-precondition", `Settle the tenant's existing balance of ₱${balance.toLocaleString()} before relocating a stall.`);

  return db.runTransaction(async (tx) => {
    const userRef = db.collection("users").doc(uid);
    const oldStallRef = db.collection("stalls").doc(requestedOldStallId);
    const newStallRef = db.collection("stalls").doc(newStallId);
    const paymentLockRef = db.collection("paymentAttemptLocks").doc(uid);
    const [userSnap, oldStallSnap, newStallSnap, paymentLockSnap] = await Promise.all([
      tx.get(userRef), tx.get(oldStallRef), tx.get(newStallRef), tx.get(paymentLockRef),
    ]);
    if (hasOpenPaymentAttempt(paymentLockSnap.data())) {
      throw new HttpsError("failed-precondition", "Finish or cancel the tenant's active payment attempt before relocating a stall.");
    }
    if (!userSnap.exists || userSnap.data()?.role !== "tenant" || userSnap.data()?.status !== "active") {
      throw new HttpsError("failed-precondition", "Active tenant account was not found.");
    }
    const user = userSnap.data()!;
    const currentIds = normalizedTenantStallIds(user);
    if (!currentIds.includes(requestedOldStallId) || oldStallSnap.data()?.tenantId !== uid) {
      throw new HttpsError("aborted", "The tenant's current stall changed. Refresh and try again.");
    }
    if (!newStallSnap.exists || newStallSnap.data()?.status !== "unoccupied" || newStallSnap.data()?.tenantId) {
      throw new HttpsError("already-exists", "The destination stall is no longer available.");
    }
    const destination = newStallSnap.data()!;
    const paymentSchedule = String(transferPreviousInfo ? (user.paymentSchedule ?? "monthly") : (destination.paymentSchedule ?? "monthly"));
    const category = transferPreviousInfo ? (user.category ?? "") : (destination.category ?? "");
    const destinationRate = Number(destination.price ?? 0);
    const tenantName = [user.firstName, user.middleName, user.lastName].filter(Boolean).join(" ");
    const oldPrimaryId = String(user.primaryStallId ?? user.stallId ?? currentIds[0]);
    const nextPrimaryId = oldPrimaryId === requestedOldStallId ? newStallId : oldPrimaryId;
    const nextIds = currentIds.map((id) => id === requestedOldStallId ? newStallId : id);
    const existingAssignments = Array.isArray(user.stallAssignments)
      ? user.stallAssignments.filter((entry: unknown) => entry && typeof entry === "object") as Record<string, unknown>[]
      : [];
    const assignmentMap = new Map(existingAssignments.map((entry) => [String(entry.stallId ?? ""), entry]));
    for (const id of currentIds) {
      if (!assignmentMap.has(id)) assignmentMap.set(id, {stallId: id, dailyRate: id === oldPrimaryId ? Number(user.price ?? 0) : 0});
    }
    assignmentMap.delete(requestedOldStallId);
    assignmentMap.set(newStallId, {stallId: newStallId, dailyRate: destinationRate, assignedAt: Timestamp.now()});
    const nextAssignments = nextIds.map((id) => assignmentMap.get(id)!).filter(Boolean);
    const combinedRate = nextAssignments.reduce((sum, entry) => sum + Math.max(0, Number(entry.dailyRate ?? 0)), 0);

    tx.update(userRef, {
      stallId: nextPrimaryId,
      primaryStallId: nextPrimaryId,
      stallIds: nextIds,
      stallAssignments: nextAssignments,
      price: combinedRate,
      paymentSchedule,
      paymentIntervalDays: paymentIntervalDaysFor(paymentSchedule),
      category,
      assignmentVersion: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(newStallRef, {tenantId: uid, tenantName, status: "occupied", price: destinationRate, paymentSchedule, paymentIntervalDays: paymentIntervalDaysFor(paymentSchedule), category});
    tx.update(oldStallRef, {tenantId: null, tenantName: null, status: "unoccupied"});
    return {success: true, stallIds: nextIds, primaryStallId: nextPrimaryId, combinedDailyRate: combinedRate};
  });
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

// App Check is intentionally not enforced per-function yet. The native apps
// must first be registered for Play Integrity/App Attest (and development
// debug tokens registered) or legitimate installed builds are rejected before
// the authenticated owner reaches the safeguards below.
export const ownerSaveSecurityQuestions = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  await checkRateLimit(`ownerSaveSecurityQuestions:${callerUid}`, 10, 60 * 60_000);

  const input = inputObject(request.data);
  const securityQuestions = input.securityQuestions;

  if (
    !Array.isArray(securityQuestions) ||
    (securityQuestions.length !== 3 && securityQuestions.length !== 5) ||
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
  const authTimeSeconds = Number(request.auth?.token?.auth_time ?? 0);
  if (!authTimeSeconds || Date.now() - authTimeSeconds * 1000 > 5 * 60_000) {
    throw new HttpsError("unauthenticated", "Sign in again before changing recovery questions.");
  }

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
  if (new Set(cleanQuestions.map((q) => q.question.toLowerCase())).size !== cleanQuestions.length) {
    throw new HttpsError("invalid-argument", "Security questions must be different.");
  }

  // The client re-authenticates with the owner's current password via
  // Firebase Auth (see owner-profile.tsx) immediately before calling this —
  // that's the real verification, so nothing about the password itself
  // needs to travel here or ever be stored. Only the security Q&A is kept.
  await db.collection("ownerRecovery").doc(callerUid).set({
    securityQuestions: cleanQuestions,
    questionCount: cleanQuestions.length,
    recoveryVersion: cleanQuestions.length === 5 ? 2 : 1,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { success: true };
});

export const getOwnerRecoveryQuestionStatus = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "You must be logged in.");
  await assertIsOwner(callerUid);
  await checkRateLimit(`ownerRecoveryQuestionStatus:${callerUid}`, 60, 60 * 60_000);

  const recoverySnap = await db.collection("ownerRecovery").doc(callerUid).get();
  if (!recoverySnap.exists) return {configured: false, questionCount: 0, questions: []};
  const stored = recoverySnap.data()?.securityQuestions;
  if (!Array.isArray(stored)) return {configured: false, questionCount: 0, questions: []};
  const questions = stored
    .map((entry) => entry && typeof entry.question === "string" ? entry.question : "")
    .filter(Boolean)
    .slice(0, 5);
  return {configured: questions.length >= 3, questionCount: questions.length, questions};
});

export const ownerAcknowledgeUpdates = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "You must be logged in.");
  await assertIsOwner(callerUid);
  await checkRateLimit(`ownerAcknowledgeUpdates:${callerUid}`, 60, 60 * 60_000);
  const rawIds = inputObject(request.data).updateIds;
  if (!Array.isArray(rawIds) || rawIds.length < 1 || rawIds.length > 50) {
    throw new HttpsError("invalid-argument", "Select between 1 and 50 reports.");
  }
  const updateIds = [...new Set(rawIds.map((value) => validUid(value)))];

  await db.runTransaction(async (tx) => {
    const rows: Array<{
      id: string;
      ref: FirebaseFirestore.DocumentReference;
      data: FirebaseFirestore.DocumentData;
      notificationDocs: FirebaseFirestore.QueryDocumentSnapshot[];
    }> = [];
    for (const id of updateIds) {
      const ref = db.collection("updates").doc(id);
      const [snap, notificationSnap] = await Promise.all([
        tx.get(ref),
        tx.get(db.collection("notifications").where("updateId", "==", id)),
      ]);
      if (!snap.exists) throw new HttpsError("not-found", `Report ${id} was not found.`);
      rows.push({
        id,
        ref,
        data: snap.data()!,
        notificationDocs: notificationSnap.docs.filter((docSnap) => docSnap.data().userId === callerUid),
      });
    }

    for (const row of rows) {
      tx.update(row.ref, {
        approvalStatus: "approved",
        acknowledgedBy: callerUid,
        acknowledgedAt: FieldValue.serverTimestamp(),
      });
      for (const notification of row.notificationDocs) {
        tx.update(notification.ref, {status: "Acknowledged", read: true});
      }
      const label = row.data.type ?? row.data.module ?? row.data.category ?? "Update";
      if (row.data.changedBy) {
        const moduleName = String(row.data.module ?? row.data.category ?? "").toLowerCase();
        const notificationRoute = moduleName.includes("stall") || moduleName.includes("building")
          ? "/building"
          : moduleName.includes("financial") || moduleName.includes("payment")
            ? "/financials"
            : moduleName.includes("tenant") || moduleName.includes("archive") || moduleName.includes("account")
              ? "/tenant-management"
              : "/reports-history";
        tx.set(db.collection("notifications").doc(`owner_ack_${row.id}_${row.data.changedBy}`), {
          userId: row.data.changedBy,
          updateId: row.id,
          type: "owner_acknowledgement",
          route: notificationRoute,
          message: `Your "${label}" update was acknowledged by the owner.`,
          read: false,
          fromOwner: true,
          createdAt: FieldValue.serverTimestamp(),
        }, {merge: true});
      }
      tx.set(db.collection("dailyReports").doc(`owner_ack_${row.id}`), {
        type: row.data.type ?? row.data.module ?? row.data.category ?? "Update",
        updateId: row.id,
        spaceNo: row.data.spaceNo ?? null,
        tenantName: row.data.tenantName ?? null,
        approvedBy: "Owner",
        date: FieldValue.serverTimestamp(),
        createdAt: row.data.createdAt ?? FieldValue.serverTimestamp(),
      }, {merge: true});
    }
  });
  return {success: true, acknowledged: updateIds.length};
});

const OWNER_RECOVERY_TTL_MS = 15 * 60_000;

async function ownerResetResult(ownerId: string): Promise<{oobCode: string | null; email: string}> {
  const ownerRecord = await auth.getUser(ownerId);
  if (!ownerRecord.email) {
    throw new HttpsError("failed-precondition", "This account has no email on file.");
  }
  const link = await auth.generatePasswordResetLink(ownerRecord.email, {
    url: "https://rentwise-capstone-project.web.app/reset-password",
    handleCodeInApp: true,
  });
  await auth.revokeRefreshTokens(ownerId);
  await clearAccountLoginLockout("owner", ownerId);
  await db.collection("users").doc(ownerId).update({sessionRevokedAt: FieldValue.serverTimestamp()});
  return {oobCode: new URL(link).searchParams.get("oobCode"), email: ownerRecord.email};
}

export const startOwnerPasswordRecovery = onCall(
  {secrets: [semaphoreApiKey]},
  async (request) => {
    const input = inputObject(request.data);
    const rawPhone = typeof input.contactNo === "string" ? input.contactNo.trim() : "";
    if (!rawPhone) throw new HttpsError("invalid-argument", "Mobile number is required.");
    if (!/^\d+$/.test(rawPhone)) throw new HttpsError("invalid-argument", "Enter a valid mobile number.");
    if (rawPhone.length !== 11) throw new HttpsError("invalid-argument", "Mobile number must be 11 digits.");
    if (!rawPhone.startsWith("09")) throw new HttpsError("invalid-argument", "Mobile number must start with 09.");
    const submittedPhone = normalizePhilippinePhone(rawPhone);
    await checkRateLimit(networkRateLimitKey(request, "startOwnerRecovery"), 10, 15 * 60_000);

    const ownerSnap = await db.collection("users").where("role", "==", "owner").limit(1).get();
    if (ownerSnap.empty) throw new HttpsError("failed-precondition", "Owner recovery is unavailable.");
    const ownerDoc = ownerSnap.docs[0];
    const storedPhone = normalizePhilippinePhone(String(ownerDoc.data().contactNo ?? ""));
    if (submittedPhone !== storedPhone) {
      throw new HttpsError("permission-denied", "We couldn't verify the account using that contact number.");
    }

    const recoveryToken = randomBytes(32).toString("hex");
    const sessionRef = db.collection("ownerPasswordRecoverySessions")
      .doc(createHash("sha256").update(recoveryToken).digest("hex"));
    const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await sessionRef.set({
      ownerId: ownerDoc.id,
      otpHash: createHash("sha256").update(otp).digest("hex"),
      otpAttempts: 0,
      resendCount: 0,
      fallbackUnlocked: false,
      sentAt: Date.now(),
      expiresAt: Date.now() + OWNER_RECOVERY_TTL_MS,
      createdAt: FieldValue.serverTimestamp(),
    });
    try {
      await sendSMSWithRetry(storedPhone, `Your RentWise Owner password reset code is ${otp}. It expires in 15 minutes.`, ownerDoc.id, "password-reset");
    } catch (error) {
      await sessionRef.delete().catch((cleanupError) => {
        console.error("Failed to remove incomplete payment session", {sessionId: sessionRef.id, cleanupError});
      });
      throw new HttpsError("unavailable", "We couldn't send the reset code right now. Please try again.");
    }
    return {recoveryToken, phoneHint: maskPhone(storedPhone), resendCount: 0, fallbackUnlocked: false};
  },
);

export const resendOwnerPasswordRecovery = onCall(
  {secrets: [semaphoreApiKey]},
  async (request) => {
    const input = inputObject(request.data);
    const recoveryToken = requiredText(input.recoveryToken, "Recovery token", 64);
    if (!/^[a-f0-9]{64}$/.test(recoveryToken)) throw new HttpsError("invalid-argument", "Invalid recovery session.");
    const sessionRef = db.collection("ownerPasswordRecoverySessions").doc(createHash("sha256").update(recoveryToken).digest("hex"));
    const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const now = Date.now();
    const reserved = await db.runTransaction(async (tx) => {
      const sessionSnap = await tx.get(sessionRef);
      if (!sessionSnap.exists) throw new HttpsError("deadline-exceeded", "This recovery session has expired.");
      const session = sessionSnap.data()!;
      if (now > Number(session.expiresAt ?? 0)) throw new HttpsError("deadline-exceeded", "This recovery session has expired.");
      const currentCount = Number(session.resendCount ?? 0);
      if (currentCount >= 3) return {ownerId: String(session.ownerId), resendCount: 3, fallbackUnlocked: true, shouldSend: false};
      const remaining = 60_000 - (now - Number(session.sentAt ?? 0));
      if (remaining > 0) throw new HttpsError("resource-exhausted", `Please wait ${Math.ceil(remaining / 1000)} seconds before resending.`);
      const resendCount = currentCount + 1;
      tx.update(sessionRef, {
        otpHash: createHash("sha256").update(otp).digest("hex"),
        otpAttempts: 0,
        resendCount,
        fallbackUnlocked: resendCount >= 3,
        sentAt: now,
      });
      return {ownerId: String(session.ownerId), resendCount, fallbackUnlocked: resendCount >= 3, shouldSend: true};
    });
    if (!reserved.shouldSend) return {resendCount: reserved.resendCount, fallbackUnlocked: reserved.fallbackUnlocked};
    const ownerDoc = await db.collection("users").doc(reserved.ownerId).get();
    const phone = normalizePhilippinePhone(String(ownerDoc.data()?.contactNo ?? ""));
    await sendSMSWithRetry(phone, `Your new RentWise Owner password reset code is ${otp}. It expires in 15 minutes.`, reserved.ownerId, "password-reset");
    return {resendCount: reserved.resendCount, fallbackUnlocked: reserved.fallbackUnlocked};
  },
);

export const verifyOwnerRecoveryOtp = onCall(async (request) => {
  const input = inputObject(request.data);
  const recoveryToken = requiredText(input.recoveryToken, "Recovery token", 64);
  const otp = requiredText(input.otp, "Verification code", 6);
  if (!/^[a-f0-9]{64}$/.test(recoveryToken) || !/^\d{6}$/.test(otp)) {
    throw new HttpsError("invalid-argument", "Invalid recovery code or session.");
  }
  const sessionRef = db.collection("ownerPasswordRecoverySessions").doc(createHash("sha256").update(recoveryToken).digest("hex"));
  const verified = await db.runTransaction(async (tx) => {
    const snap = await tx.get(sessionRef);
    if (!snap.exists || Date.now() > Number(snap.data()?.expiresAt ?? 0)) throw new HttpsError("deadline-exceeded", "This recovery session has expired.");
    const session = snap.data()!;
    const attempts = Number(session.otpAttempts ?? 0);
    if (attempts >= 5) throw new HttpsError("resource-exhausted", "Too many incorrect codes.");
    const matches = createHash("sha256").update(otp).digest("hex") === session.otpHash;
    if (!matches) {
      tx.update(sessionRef, {otpAttempts: attempts + 1});
      return {ownerId: "", attemptsLeft: Math.max(0, 4 - attempts)};
    }
    tx.delete(sessionRef);
    return {ownerId: String(session.ownerId), attemptsLeft: -1};
  });
  if (!verified.ownerId) {
    throw new HttpsError("invalid-argument", `Incorrect code. ${verified.attemptsLeft} attempts left.`);
  }
  return ownerResetResult(verified.ownerId);
});

export const getOwnerSecurityQuestions = onCall(async (request) => {
  // This endpoint returns only the selected questions, never their answers.
  await checkRateLimit(networkRateLimitKey(request, "ownerQuestions"), 30, 5 * 60_000);
  const input = inputObject(request.data);
  const recoveryToken = requiredText(input.recoveryToken, "Recovery token", 64);
  if (!/^[a-f0-9]{64}$/.test(recoveryToken)) throw new HttpsError("invalid-argument", "Invalid recovery session.");
  const sessionRef = db.collection("ownerPasswordRecoverySessions").doc(createHash("sha256").update(recoveryToken).digest("hex"));
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists || Date.now() > Number(sessionSnap.data()?.expiresAt ?? 0)) {
    throw new HttpsError("deadline-exceeded", "This recovery session has expired.");
  }
  if (!sessionSnap.data()?.fallbackUnlocked || Number(sessionSnap.data()?.resendCount ?? 0) < 3) {
    throw new HttpsError("failed-precondition", "Security questions are not available yet.");
  }
  const ownerId = String(sessionSnap.data()?.ownerId ?? "");

  // There's only ever one owner account, so recovery skips identifying an
  // account by email/username — tapping "Forgot password" goes straight to
  // whichever owner has security questions set up.
  const ownerDoc = await db.collection("ownerRecovery").doc(ownerId).get();

  if (!ownerDoc.exists) {
    throw new HttpsError(
      "not-found",
      "No security questions have been set up for this account yet.",
    );
  }

  const stored = (ownerDoc.data()?.securityQuestions ?? []) as {
    question: string;
    answer?: string;
    answerSalt?: string;
    answerHash?: string;
  }[];
  if (stored.length < 3) {
    throw new HttpsError("failed-precondition", "At least three security questions must be configured.");
  }

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

  const existingIndices = sessionSnap.data()?.recoveryQuestionIndices;
  let selectedIndices: number[];
  if (
    Array.isArray(existingIndices) &&
    existingIndices.length === 3 &&
    existingIndices.every((value) => Number.isInteger(value) && value >= 0 && value < stored.length) &&
    new Set(existingIndices).size === 3
  ) {
    selectedIndices = existingIndices;
  } else {
    const available = stored.map((_question, index) => index);
    selectedIndices = [];
    while (selectedIndices.length < 3) {
      selectedIndices.push(available.splice(randomInt(0, available.length), 1)[0]);
    }
  }
  await sessionRef.update({
    recoveryMethod: "security-questions",
    recoveryQuestionIndices: selectedIndices,
    otpHash: FieldValue.delete(),
  });
  return {ownerId: ownerDoc.id, questions: selectedIndices.map((index) => stored[index].question)};
});

export const verifyOwnerSecurityAnswers = onCall(async (request) => {
  const input = inputObject(request.data);
  const ownerId = validUid(input.ownerId);
  const recoveryToken = requiredText(input.recoveryToken, "Recovery token", 64);
  const answers = input.answers;

  if (!Array.isArray(answers) || answers.length !== 3) {
    throw new HttpsError("invalid-argument", "Missing answers.");
  }
  const cleanAnswers = answers.map((answer) => requiredText(answer, "Answer", 120));
  await checkRateLimit(networkRateLimitKey(request, "ownerRecovery"), 15, 15 * 60_000);
  // Keyed per-ownerId (not per-caller, since there's no caller identity yet)
  // so guessing security answers can't be scripted.
  await checkRateLimit(`verifyOwnerSecurityAnswers:${ownerId}`, 5, 15 * 60_000);
  const sessionRef = db.collection("ownerPasswordRecoverySessions").doc(createHash("sha256").update(recoveryToken).digest("hex"));
  const sessionSnap = await sessionRef.get();
  const recoverySession = sessionSnap.data();
  if (
    !sessionSnap.exists ||
    Date.now() > Number(recoverySession?.expiresAt ?? 0) ||
    recoverySession?.ownerId !== ownerId ||
    recoverySession?.recoveryMethod !== "security-questions"
  ) {
    throw new HttpsError("permission-denied", "Invalid or expired recovery session.");
  }

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

  const selectedIndices = recoverySession?.recoveryQuestionIndices;
  if (
    !Array.isArray(selectedIndices) ||
    selectedIndices.length !== 3 ||
    selectedIndices.some((value) => !Number.isInteger(value) || value < 0 || value >= stored.length) ||
    new Set(selectedIndices).size !== 3
  ) {
    throw new HttpsError("permission-denied", "Invalid recovery session.");
  }

  const matches = selectedIndices.every((questionIndex, answerIndex) => {
    const q = stored[questionIndex];
    if (q.answerSalt && q.answerHash) {
      const inputHash = hashSecurityAnswer(cleanAnswers[answerIndex], q.answerSalt);
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
      .update(normalizeSecurityAnswer(cleanAnswers[answerIndex]))
      .digest();
    return timingSafeEqual(expected, actual);
  });

  if (!matches) {
    throw new HttpsError("permission-denied", "One or more answers are incorrect.");
  }

  if (stored.length === 3 && stored.some((q) => !q.answerSalt || !q.answerHash)) {
    const answerByQuestionIndex = new Map(
      selectedIndices.map((questionIndex, answerIndex) => [questionIndex, cleanAnswers[answerIndex]]),
    );
    const migrated = stored.map((q, i) => {
      const answerSalt = randomBytes(16).toString("hex");
      return {
        question: q.question,
        answerSalt,
        answerHash: hashSecurityAnswer(answerByQuestionIndex.get(i) ?? "", answerSalt),
      };
    });
    await recoverySnap.ref.update({
      securityQuestions: migrated,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  await sessionRef.delete();
  return ownerResetResult(ownerId);
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

// Login screens accept a username only. This resolves the stored internal
// Firebase identifier without exposing it in the mobile UI.
type LoginRole = "admin" | "owner" | "tenant";

async function findLoginUser(identifier: string, role: LoginRole): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  const usernameUpper = identifier.toUpperCase();
  const candidates = new Set([identifier, identifier.toLowerCase(), usernameUpper]);
  if (role === "tenant" && usernameUpper.startsWith("RW") && usernameUpper.length > 2) {
    const legacy = usernameUpper.slice(2);
    candidates.add(legacy);
    candidates.add(legacy.toLowerCase());
  }

  const fixedUsername = role === "owner" ? "RWOWNER" : role === "admin" ? "RWADMIN" : null;
  if (fixedUsername === usernameUpper) {
    const fixedMatch = await db.collection("users").where("role", "==", role).limit(1).get();
    if (!fixedMatch.empty) return fixedMatch.docs[0];
  }

  const lookups = await Promise.all(
    ["username", "userName"].flatMap((field) =>
      Array.from(candidates).map((candidate) =>
        db.collection("users").where(field, "==", candidate).limit(1).get(),
      ),
    ),
  );
  return lookups
    .flatMap((snapshot) => snapshot.docs)
    .find((document) => String(document.data().role ?? "").trim().toLowerCase() === role) ?? null;
}

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_DURATIONS_MS = [60_000, 5 * 60_000, 30 * 60_000];
const FIREBASE_WEB_API_KEY = "AIzaSyCo_sM0NvjXReuQsTep28s7onguf0IJvE8";

function accountLoginSecurityRef(role: LoginRole, accountKey: string) {
  const securityKey = createHash("sha256").update(`${role}:${accountKey}`).digest("hex");
  return db.collection("accountLoginSecurity").doc(securityKey);
}

async function clearAccountLoginLockout(role: LoginRole, uid: string) {
  await accountLoginSecurityRef(role, uid).delete();
}

export const loginWithAccountLockout = onCall({enforceAppCheck: false}, async (request) => {
  const input = inputObject(request.data);
  const identifier = validUsername(input.identifier).toUpperCase();
  if (typeof input.password !== "string" || !input.password || input.password.length > 128) {
    throw new HttpsError("invalid-argument", "Password is required.");
  }
  const password = input.password;
  const role = input.role as LoginRole;
  if (role !== "admin" && role !== "owner" && role !== "tenant") {
    throw new HttpsError("invalid-argument", "Invalid account role.");
  }

  await checkRateLimit(networkRateLimitKey(request, "accountLogin"), 40, 5 * 60_000);
  const account = await findLoginUser(identifier, role);
  const accountData = account?.data();
  if (role === "tenant" && account && accountData?.status && accountData.status !== "active") {
    throw new HttpsError(
      "permission-denied",
      "This account is inactive. Contact the administrator.",
      {reason: "inactive-tenant"},
    );
  }
  const securityRef = accountLoginSecurityRef(role, account?.id ?? identifier);
  const now = Date.now();
  const securitySnap = await securityRef.get();
  const security = securitySnap.data();
  const activeLockout = Number(security?.lockoutUntil ?? 0);
  if (activeLockout > now) {
    throw new HttpsError("resource-exhausted", "This account is temporarily locked.", {
      lockoutUntil: activeLockout,
      lockoutLevel: Number(security?.lockoutLevel ?? 1),
    });
  }
  const email = typeof accountData?.email === "string" ? accountData.email : "";
  const isActive = !accountData?.status || accountData.status === "active";
  let credentialValid = false;
  let firebaseUid = "";

  if (account && email && isActive) {
    let response: Response;
    try {
      response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_WEB_API_KEY}`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({email, password, returnSecureToken: true}),
      });
    } catch {
      throw new HttpsError("unavailable", "The login service is temporarily unavailable.");
    }
    if (response.ok) {
      const payload = await response.json() as {localId?: string};
      firebaseUid = String(payload.localId ?? "");
      credentialValid = firebaseUid === account.id;
    } else if (response.status >= 500) {
      throw new HttpsError("unavailable", "The login service is temporarily unavailable.");
    }
  }

  if (!credentialValid) {
    const failed = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(securityRef);
      const state = snapshot.data() ?? {};
      const stillLockedUntil = Number(state.lockoutUntil ?? 0);
      if (stillLockedUntil > now) {
        return {lockoutUntil: stillLockedUntil, remainingAttempts: 0, lockoutLevel: Number(state.lockoutLevel ?? 1)};
      }
      const failCount = Number(state.failCount ?? 0) + 1;
      const currentLevel = Number(state.lockoutLevel ?? 0);
      if (failCount >= LOGIN_MAX_ATTEMPTS) {
        const lockoutLevel = currentLevel + 1;
        const duration = LOGIN_LOCKOUT_DURATIONS_MS[Math.min(lockoutLevel, LOGIN_LOCKOUT_DURATIONS_MS.length) - 1];
        const lockoutUntil = now + duration;
        transaction.set(securityRef, {
          role,
          accountId: account?.id ?? null,
          failCount: 0,
          lockoutLevel,
          lockoutUntil,
          lastFailedAt: FieldValue.serverTimestamp(),
        }, {merge: true});
        return {lockoutUntil, remainingAttempts: 0, lockoutLevel};
      }
      transaction.set(securityRef, {
        role,
        accountId: account?.id ?? null,
        failCount,
        lockoutLevel: currentLevel,
        lockoutUntil: null,
        lastFailedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      return {lockoutUntil: null, remainingAttempts: LOGIN_MAX_ATTEMPTS - failCount, lockoutLevel: currentLevel};
    });
    throw new HttpsError("unauthenticated", "Invalid username or password.", failed);
  }

  await securityRef.set({
    role,
    accountId: firebaseUid,
    failCount: 0,
    lockoutLevel: 0,
    lockoutUntil: null,
    lastSuccessfulLoginAt: FieldValue.serverTimestamp(),
  }, {merge: true});
  return {customToken: await auth.createCustomToken(firebaseUid)};
});

export const resolveLoginEmail = onCall({enforceAppCheck: false}, async (request) => {
  const input = inputObject(request.data);
  const identifier = requiredText(input.identifier, "Identifier", 254);
  const role = input.role;
  if (role !== "admin" && role !== "owner" && role !== "tenant") {
    throw new HttpsError("invalid-argument", "Invalid account role.");
  }
  await checkRateLimit(networkRateLimitKey(request, "resolveLoginEmail"), 40, 5 * 60_000);
  const usernameKey = identifier.toLowerCase();
  const usernameUpper = identifier.toUpperCase();
  // Older tenant accounts were stored as FIRSTNAME (for example, JAYCEE),
  // while every new account uses the canonical RW + FIRSTNAME form
  // (RWJAYCEE). Accept the canonical username for both generations without
  // mutating the tenant's Firebase Auth account or password.
  const legacyTenantUsername =
    role === "tenant" && usernameUpper.startsWith("RW") && usernameUpper.length > 2
      ? usernameUpper.slice(2)
      : null;
  await checkRateLimit(`resolveLoginEmail:${role}:${usernameKey}`, 15, 5 * 60_000);

  // RentWise has one owner and one market-admin account. Their public login
  // usernames are fixed, even when an older database record still contains
  // the former name-derived username. This compatibility lookup keeps the
  // fixed credentials working while profile saves migrate the stored value.
  const fixedRoleUsername = role === "owner" ? "RWOWNER" : role === "admin" ? "RWADMIN" : null;
  if (fixedRoleUsername && usernameUpper === fixedRoleUsername) {
    const roleMatch = await db.collection("users").where("role", "==", role).limit(1).get();
    if (!roleMatch.empty) {
      const data = roleMatch.docs[0].data();
      return { email: data.email ?? null, accountStatus: data.status ?? "active", accountType: role };
    }
  }

  // Two field-name conventions exist in the data (see the old
  // getUserByUsername for why) -- try both.
  const lookups = await Promise.all([
    db.collection("users").where("username", "==", identifier).where("role", "==", role).limit(1).get(),
    db.collection("users").where("username", "==", usernameKey).where("role", "==", role).limit(1).get(),
    db.collection("users").where("username", "==", usernameUpper).where("role", "==", role).limit(1).get(),
    db.collection("users").where("userName", "==", identifier).where("role", "==", role).limit(1).get(),
    db.collection("users").where("userName", "==", usernameKey).where("role", "==", role).limit(1).get(),
    db.collection("users").where("userName", "==", usernameUpper).where("role", "==", role).limit(1).get(),
    ...(legacyTenantUsername
      ? [
          db.collection("users").where("username", "==", legacyTenantUsername).where("role", "==", role).limit(1).get(),
          db.collection("users").where("username", "==", legacyTenantUsername.toLowerCase()).where("role", "==", role).limit(1).get(),
          db.collection("users").where("userName", "==", legacyTenantUsername).where("role", "==", role).limit(1).get(),
          db.collection("users").where("userName", "==", legacyTenantUsername.toLowerCase()).where("role", "==", role).limit(1).get(),
        ]
      : []),
  ]);
  const match = lookups.find((snapshot) => !snapshot.empty);
  if (match) {
    const data = match.docs[0].data();
    return { email: data.email ?? null, accountStatus: data.status ?? "active", accountType: role };
  }

  // Distinguish a real username belonging to another RentWise app from a
  // completely unregistered username, without returning that account's
  // email. Tenant login uses this only to show the correct guidance and
  // never attempts authentication for an owner/admin account.
  const otherRoleLookups = await Promise.all(
    [identifier, usernameKey, usernameUpper].flatMap((candidate) => [
      db.collection("users").where("username", "==", candidate).limit(1).get(),
      db.collection("users").where("userName", "==", candidate).limit(1).get(),
    ]),
  );
  const otherRoleMatch = otherRoleLookups.find((snapshot) => !snapshot.empty);
  if (otherRoleMatch) {
    return { email: null, accountStatus: null, accountType: "other-role" };
  }

  if (role === "tenant" && (usernameUpper === "RWOWNER" || usernameUpper === "RWADMIN")) {
    return { email: null, accountStatus: null, accountType: "other-role" };
  }

  return { email: null, accountStatus: null, accountType: "unregistered" };
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

type TenantRecoveryAccount = {
  id: string;
  data: FirebaseFirestore.DocumentData;
  canonicalUsername: string;
};

async function findTenantRecoveryAccount(rawIdentifier: unknown): Promise<TenantRecoveryAccount | null> {
  const identifier = validUsername(rawIdentifier);
  const upper = identifier.toUpperCase();
  if (!upper.startsWith("RW") || upper.length <= 3) {
    throw new HttpsError(
      "invalid-argument",
      "Tenant usernames must begin with RW.",
    );
  }
  const withoutPrefix = upper.slice(2);
  const candidates = Array.from(new Set([
    identifier,
    identifier.toLowerCase(),
    upper,
    withoutPrefix,
    withoutPrefix.toLowerCase(),
    `RW${withoutPrefix}`,
    `rw${withoutPrefix.toLowerCase()}`,
  ]));

  const lookups = await Promise.all(
    ["username", "userName"].flatMap((field) =>
      candidates.map((candidate) =>
        db.collection("users")
          .where(field, "==", candidate)
          .limit(1)
          .get(),
      ),
    ),
  );
  const tenantDoc = lookups
    .flatMap((snapshot) => snapshot.docs)
    .find((document) => String(document.data().role ?? "").trim().toLowerCase() === "tenant");
  if (!tenantDoc) return null;

  const data = tenantDoc.data();
  const storedUsername = String(data.username ?? data.userName ?? withoutPrefix).toUpperCase();
  const canonicalUsername = storedUsername.startsWith("RW")
    ? storedUsername
    : `RW${storedUsername}`;
  return {id: tenantDoc.id, data, canonicalUsername};
}

export const sendResetOtp = onCall(
  {secrets: [semaphoreApiKey], enforceAppCheck: false},
  async (request) => {
  const input = inputObject(request.data);
  const identifier = validUsername(input.identifier);
  await checkRateLimit(networkRateLimitKey(request, "sendResetOtp"), 10, 15 * 60_000);
  await checkRateLimit(`sendResetOtp:${identifier.toLowerCase()}`, 3, 15 * 60_000);

  const account = await findTenantRecoveryAccount(identifier);

  // Every gate failure below returns the SAME { status: "manual" } response,
  // so this endpoint can't be used to probe which emails exist or are
  // verified (account enumeration). Only a fully-eligible tenant gets a code.
  if (!account || (account.data.status && account.data.status !== "active")) {
    return { status: "manual" };
  }

  const {id: tenantId, data, canonicalUsername} = account;

  // The username identifies the tenant account. Possession is confirmed by
  // the SMS sent to the phone number stored on that account.
  const contactNo = data.contactNo as string | undefined;
  if (!contactNo) {
    return { status: "manual" };
  }

  // Treat a malformed stored number the same as a missing number. Sending it
  // would otherwise throw a plain Error which Firebase exposes to the app only
  // as the unhelpful generic "INTERNAL" message.
  try {
    normalizePhilippinePhone(contactNo);
  } catch {
    console.warn("[sendResetOtp] Tenant has an invalid phone number", { tenantId });
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
      usernameKey: canonicalUsername,
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

    return { status: "sent", phoneHint: maskPhone(contactNo), username: canonicalUsername };
  },
);

export const verifyResetOtp = onCall({enforceAppCheck: false}, async (request) => {
  const input = inputObject(request.data);
  const identifier = validUsername(input.identifier);
  const otp = typeof input.otp === "string" ? input.otp.trim() : "";
  if (!/^\d{6}$/.test(otp)) {
    throw new HttpsError("invalid-argument", "Enter the 6-digit code.");
  }
  await checkRateLimit(networkRateLimitKey(request, "verifyResetOtp"), 30, 15 * 60_000);
  await checkRateLimit(`verifyResetOtp:${identifier.toLowerCase()}`, 10, 15 * 60_000);

  const account = await findTenantRecoveryAccount(identifier);
  if (!account || (account.data.status && account.data.status !== "active")) {
    throw new HttpsError("failed-precondition", "No active code. Please request a new one.");
  }
  const tenantId = account.id;
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
      username: account.canonicalUsername,
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

export const requestTenantAdminRecovery = onCall({enforceAppCheck: false}, async (request) => {
  const input = inputObject(request.data);
  const identifier = validUsername(input.identifier);
  await checkRateLimit(networkRateLimitKey(request, "requestTenantAdminRecovery"), 10, 15 * 60_000);
  await checkRateLimit(`requestTenantAdminRecovery:${identifier.toLowerCase()}`, 3, 60 * 60_000);

  const account = await findTenantRecoveryAccount(identifier);
  if (!account || (account.data.status && account.data.status !== "active")) {
    return {ok: true};
  }

  const existing = await db.collection("passwordResetRequests")
    .where("tenantId", "==", account.id)
    .where("status", "==", "pending")
    .limit(1)
    .get();
  if (existing.empty) {
    await db.collection("passwordResetRequests").add({
      tenantId: account.id,
      username: account.canonicalUsername,
      tenantName: `${account.data.firstName ?? ""} ${account.data.lastName ?? ""}`.trim(),
      spaceId: account.data.spaceId ?? account.data.stallId ?? "",
      contactHint: maskPhone(String(account.data.contactNo ?? "")),
      requestedRole: "tenant",
      requestMethod: "lost-phone",
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  return {ok: true};
});

export const completeTenantPasswordReset = onCall(
  {enforceAppCheck: false},
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
    await clearAccountLoginLockout("tenant", result.tenantId);
    await db.collection("users").doc(result.tenantId).update({
      mustChangePassword: false,
      sessionRevokedAt: FieldValue.serverTimestamp(),
    });

    return {success: true};
  },
);

// This recovery entry point is intentionally callable before authentication.
// App Check must not be enforced here until every native build is registered
// for valid Play Integrity/App Attest (and development debug) tokens.
export const adminForgotPassword = onCall(async (request) => {
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
  const existing = await db.collection("passwordResetRequests")
    .where("tenantId", "==", matched.id)
    .where("requestedRole", "==", "admin")
    .where("status", "==", "pending")
    .limit(1)
    .get();
  if (existing.empty) {
    await db.collection("passwordResetRequests").add({
      email,
      tenantId: matched.id,
      tenantName: `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim(),
      requestedRole: "admin",
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });
  }
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
const PUBLIC_STALLS_CACHE_VERSION = 2;

function publicStallData(id: string, data: FirebaseFirestore.DocumentData) {
  const numericPrice = Number(data.price);
  return {
    id,
    name: typeof data.name === "string" ? data.name : "",
    spaceId: typeof data.spaceId === "string" ? data.spaceId : "",
    status: typeof data.status === "string" ? data.status : "unknown",
    buildingNumber: data.buildingNumber == null ? "" : String(data.buildingNumber).trim(),
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
    schemaVersion: PUBLIC_STALLS_CACHE_VERSION,
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

  const stallId = event.params.stallId;
  let cacheNeedsSeed = false;

  // Update only the changed entry in the single public projection. A
  // transaction prevents two simultaneous stall edits from losing one
  // another. The full collection is read only if the cache is missing or
  // malformed, which keeps normal changes to one cache read + one write.
  await db.runTransaction(async (transaction) => {
    const cacheSnap = await transaction.get(publicStallsCacheRef);
    const cached = cacheSnap.data()?.stalls;
    if (!Array.isArray(cached)) {
      cacheNeedsSeed = true;
      return;
    }

    const nextStalls = cached.filter((stall: {id?: string}) => stall?.id !== stallId);
    if (after.exists) nextStalls.push(publicStallData(stallId, after.data() ?? {}));
    nextStalls.sort((a: {buildingNumber?: string; spaceId?: string}, b: {buildingNumber?: string; spaceId?: string}) => {
      const buildingOrder = String(a.buildingNumber ?? "").localeCompare(String(b.buildingNumber ?? ""));
      return buildingOrder || String(a.spaceId ?? "").localeCompare(String(b.spaceId ?? ""));
    });

    transaction.set(publicStallsCacheRef, {
      stalls: nextStalls,
      updatedAt: FieldValue.serverTimestamp(),
      sourceCount: nextStalls.length,
      schemaVersion: PUBLIC_STALLS_CACHE_VERSION,
    });
  });

  if (cacheNeedsSeed) await rebuildPublicStallsCache();
});

export const getPublicStalls = onCall(async (request) => {
  // The guest app refreshes at a low frequency, and each refresh now costs one
  // cache-document read instead of one read for every stall in the market.
  await checkRateLimit(publicCallerKey(request, "stalls"), 120, 60 * 60_000);
  const cacheSnap = await publicStallsCacheRef.get();
  const cacheData = cacheSnap.data();
  const cachedStalls = cacheData?.stalls;
  if (Array.isArray(cachedStalls) && cacheData?.schemaVersion === PUBLIC_STALLS_CACHE_VERSION) return cachedStalls;

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
  const storedBillingStart = tenant.createdAt?.toDate ? tenant.createdAt.toDate() : null;
  if (storedBillingStart) {
    const billingStartManila = new Date(
      storedBillingStart.toLocaleString("en-US", {timeZone: "Asia/Manila"}),
    );
    const billingStartDay = new Date(
      billingStartManila.getFullYear(),
      billingStartManila.getMonth(),
      billingStartManila.getDate(),
    );
    if (billingStartDay > cursor) cursor = billingStartDay;
  }
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

  const archiveDueValue = tenant.nextDueAt ?? tenant.billingStartedAt ?? tenant.createdAt;
  const archiveNextDueAt = archiveDueValue?.toDate ? archiveDueValue.toDate() : null;
  const outstandingBalance = await getOutstandingBalance(
    uid,
    schedule,
    dailyRate,
    nowManila,
    archiveNextDueAt,
  );
  return {
    canArchive: outstandingBalance <= 0 && !hasPendingPayment,
    outstandingBalance,
    hasPendingPayment,
  };
});

function normalizedTenantStallIds(tenant: Record<string, unknown>): string[] {
  const listed = Array.isArray(tenant.stallIds) ? tenant.stallIds : [];
  return [...new Set([
    ...listed.map((value) => String(value ?? "").trim()),
    String(tenant.primaryStallId ?? "").trim(),
    String(tenant.stallId ?? "").trim(),
  ].filter(Boolean))];
}

function hasOpenPaymentAttempt(lock: Record<string, unknown> | undefined): boolean {
  const state = String(lock?.state ?? "").toLowerCase();
  return state === "creating" || state === "active";
}

async function assertNoOpenPaymentAttempt(tenantId: string, message: string): Promise<void> {
  const lock = await db.collection("paymentAttemptLocks").doc(tenantId).get();
  if (hasOpenPaymentAttempt(lock.data())) {
    throw new HttpsError("failed-precondition", message);
  }
}

export const assignStallToExistingTenant = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "You must be logged in.");
  await assertIsAdminOrOwner(callerUid);

  const input = inputObject(request.data);
  const tenantId = validUid(input.tenantId);
  const stallId = validUid(input.stallId);
  const tenantRef = db.collection("users").doc(tenantId);
  const stallRef = db.collection("stalls").doc(stallId);

  const preflightTenantSnap = await tenantRef.get();
  if (!preflightTenantSnap.exists || preflightTenantSnap.data()?.role !== "tenant") {
    throw new HttpsError("not-found", "Tenant account was not found.");
  }
  const preflightTenant = preflightTenantSnap.data()!;
  if (preflightTenant.status !== "active") {
    throw new HttpsError("failed-precondition", "Only active tenants can receive another stall.");
  }
  await assertNoOpenPaymentAttempt(tenantId, "Finish or cancel the tenant's active payment attempt before adding a stall.");
  const pendingPayment = await db.collection("payments")
    .where("userId", "==", tenantId)
    .where("status", "==", "pending")
    .limit(1)
    .get();
  if (!pendingPayment.empty) {
    throw new HttpsError("failed-precondition", "Resolve the tenant's pending payment before adding a stall.");
  }
  const schedule = String(preflightTenant.paymentSchedule ?? "monthly");
  const dueValue = preflightTenant.nextDueAt ?? preflightTenant.billingStartedAt ?? preflightTenant.createdAt;
  const nextDueAt = dueValue?.toDate ? dueValue.toDate() : null;
  const outstandingBalance = await getOutstandingBalance(
    tenantId,
    schedule,
    Number(preflightTenant.price ?? 0),
    new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Manila"})),
    nextDueAt,
  );
  if (outstandingBalance > 0) {
    throw new HttpsError(
      "failed-precondition",
      `Settle the tenant's existing balance of ₱${outstandingBalance.toLocaleString()} before adding a stall.`,
    );
  }
  const preflightVersion = Number(preflightTenant.assignmentVersion ?? 0);

  const result = await db.runTransaction(async (tx) => {
    const paymentLockRef = db.collection("paymentAttemptLocks").doc(tenantId);
    const [tenantSnap, stallSnap, paymentLockSnap] = await Promise.all([
      tx.get(tenantRef), tx.get(stallRef), tx.get(paymentLockRef),
    ]);
    if (hasOpenPaymentAttempt(paymentLockSnap.data())) {
      throw new HttpsError("failed-precondition", "Finish or cancel the tenant's active payment attempt before adding a stall.");
    }
    if (!tenantSnap.exists || tenantSnap.data()?.role !== "tenant") {
      throw new HttpsError("not-found", "Tenant account was not found.");
    }
    const tenant = tenantSnap.data()!;
    if (tenant.status !== "active") {
      throw new HttpsError("failed-precondition", "Only active tenants can receive another stall.");
    }
    if (Number(tenant.assignmentVersion ?? 0) !== preflightVersion) {
      throw new HttpsError("aborted", "Tenant assignments changed. Refresh and try again.");
    }
    if (!stallSnap.exists) throw new HttpsError("not-found", "Stall was not found.");

    const currentIds = normalizedTenantStallIds(tenant);
    if (currentIds.includes(stallId)) {
      throw new HttpsError("already-exists", "This stall is already assigned to the tenant.");
    }
    if (currentIds.length >= 3) {
      throw new HttpsError("failed-precondition", "This tenant already has the maximum of three stalls.");
    }

    const stall = stallSnap.data()!;
    if (String(stall.status ?? "unoccupied").toLowerCase() !== "unoccupied" || stall.tenantId) {
      throw new HttpsError("already-exists", "This stall is no longer available.");
    }

    const assignments = Array.isArray(tenant.stallAssignments)
      ? tenant.stallAssignments.filter((entry: unknown) => entry && typeof entry === "object") as Record<string, unknown>[]
      : [];
    const assignmentById = new Map(assignments.map((entry) => [String(entry.stallId ?? ""), entry]));
    const primaryId = String(tenant.primaryStallId ?? tenant.stallId ?? currentIds[0] ?? stallId);
    for (const existingId of currentIds) {
      if (!assignmentById.has(existingId)) {
        assignmentById.set(existingId, {
          stallId: existingId,
          dailyRate: existingId === primaryId ? Number(tenant.price ?? 0) : 0,
          assignedAt: tenant.billingStartedAt ?? tenant.createdAt ?? Timestamp.now(),
        });
      }
    }
    assignmentById.set(stallId, {
      stallId,
      dailyRate: Number(stall.price ?? 0),
      assignedAt: Timestamp.now(),
    });
    const nextAssignments = [...assignmentById.values()];
    const combinedDailyRate = nextAssignments.reduce((sum, entry) => sum + Math.max(0, Number(entry.dailyRate ?? 0)), 0);
    const nextIds = [...currentIds, stallId];
    const tenantName = [tenant.firstName, tenant.middleName, tenant.lastName].filter(Boolean).join(" ");

    tx.update(tenantRef, {
      stallIds: nextIds,
      primaryStallId: primaryId,
      stallId: primaryId,
      stallAssignments: nextAssignments,
      price: combinedDailyRate,
      billingRateHistory: FieldValue.arrayUnion({
        previousDailyRate: Number(tenant.price ?? 0),
        newDailyRate: combinedDailyRate,
        effectiveAt: Timestamp.now(),
        reason: "Stall added",
        addedStallId: stallId,
        changedBy: callerUid,
      }),
      assignmentVersion: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(stallRef, {status: "occupied", tenantId, tenantName});
    const updateRef = db.collection("updates").doc();
    tx.set(updateRef, {
      module: "Manage Tenant",
      type: "Additional Stall Assigned",
      tenantId,
      tenantName,
      stallId,
      spaceNo: String(stall.spaceId ?? stallId),
      buildingNo: String(stall.buildingNumber ?? ""),
      oldValue: "Unoccupied",
      newValue: "Assigned to existing tenant",
      changedBy: callerUid,
      approvalStatus: "pending",
      createdAt: FieldValue.serverTimestamp(),
      timestamp: FieldValue.serverTimestamp(),
    });
    return {stallIds: nextIds, combinedDailyRate};
  });

  return {success: true, ...result};
});

export const removeStallFromTenantSafely = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "You must be logged in.");
  await assertIsAdminOrOwner(callerUid);

  const input = inputObject(request.data);
  const tenantId = validUid(input.tenantId);
  const stallId = validUid(input.stallId);
  const tenantRef = db.collection("users").doc(tenantId);
  const stallRef = db.collection("stalls").doc(stallId);
  const tenantSnap = await tenantRef.get();
  if (!tenantSnap.exists || tenantSnap.data()?.role !== "tenant") {
    throw new HttpsError("not-found", "Tenant account was not found.");
  }
  const tenant = tenantSnap.data()!;
  if (tenant.status !== "active") throw new HttpsError("failed-precondition", "Only active tenants can release a stall.");
  const currentIds = normalizedTenantStallIds(tenant);
  if (!currentIds.includes(stallId)) throw new HttpsError("failed-precondition", "This stall is not assigned to the tenant.");
  if (currentIds.length <= 1) throw new HttpsError("failed-precondition", "The tenant's final stall cannot be removed. Archive the tenant instead.");
  await assertNoOpenPaymentAttempt(tenantId, "Finish or cancel the tenant's active payment attempt before removing a stall.");

  // A rate change is only safe when no old balance or payment attempt can be
  // re-priced. This keeps all historical coverage immutable.
  const pendingPayment = await db.collection("payments")
    .where("userId", "==", tenantId)
    .where("status", "==", "pending")
    .limit(1)
    .get();
  if (!pendingPayment.empty) throw new HttpsError("failed-precondition", "A payment is still pending. Resolve it before removing a stall.");
  const schedule = String(tenant.paymentSchedule ?? "monthly");
  const currentDailyRate = Number(tenant.price ?? 0);
  const nowManila = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Manila"}));
  const dueValue = tenant.nextDueAt ?? tenant.billingStartedAt ?? tenant.createdAt;
  const nextDueAt = dueValue?.toDate ? dueValue.toDate() : null;
  const outstandingBalance = await getOutstandingBalance(tenantId, schedule, currentDailyRate, nowManila, nextDueAt);
  if (outstandingBalance > 0) {
    throw new HttpsError("failed-precondition", `Settle the tenant's existing balance of ₱${outstandingBalance.toLocaleString()} before removing a stall.`);
  }

  const result = await db.runTransaction(async (tx) => {
    const paymentLockRef = db.collection("paymentAttemptLocks").doc(tenantId);
    const [freshTenantSnap, freshStallSnap, paymentLockSnap] = await Promise.all([
      tx.get(tenantRef), tx.get(stallRef), tx.get(paymentLockRef),
    ]);
    if (hasOpenPaymentAttempt(paymentLockSnap.data())) {
      throw new HttpsError("failed-precondition", "Finish or cancel the tenant's active payment attempt before removing a stall.");
    }
    if (!freshTenantSnap.exists || freshTenantSnap.data()?.status !== "active") {
      throw new HttpsError("aborted", "Tenant status changed. Refresh and try again.");
    }
    if (!freshStallSnap.exists || freshStallSnap.data()?.tenantId !== tenantId) {
      throw new HttpsError("failed-precondition", "Tenant and stall records do not match. No changes were made.");
    }
    const freshTenant = freshTenantSnap.data()!;
    const freshIds = normalizedTenantStallIds(freshTenant);
    if (!freshIds.includes(stallId) || freshIds.length <= 1) {
      throw new HttpsError("aborted", "Tenant stall assignments changed. Refresh and try again.");
    }
    const assignments = Array.isArray(freshTenant.stallAssignments)
      ? freshTenant.stallAssignments.filter((entry: unknown) => entry && typeof entry === "object") as Record<string, unknown>[]
      : [];
    const removedAssignment = assignments.find((entry) => String(entry.stallId ?? "") === stallId);
    const removedRate = Math.max(0, Number(removedAssignment?.dailyRate ?? freshStallSnap.data()?.price ?? 0));
    const remainingIds = freshIds.filter((id) => id !== stallId);
    const remainingAssignments = assignments.filter((entry) => String(entry.stallId ?? "") !== stallId);
    const assignmentsComplete = remainingIds.every((id) =>
      remainingAssignments.some((entry) => String(entry.stallId ?? "") === id),
    );
    const newDailyRate = assignmentsComplete
      ? remainingAssignments.reduce(
        (sum, entry) => sum + Math.max(0, Number(entry.dailyRate ?? 0)),
        0,
      )
      : Math.max(0, Number(freshTenant.price ?? 0) - removedRate);
    const oldPrimaryId = String(freshTenant.primaryStallId ?? freshTenant.stallId ?? freshIds[0]);
    const newPrimaryId = oldPrimaryId === stallId ? remainingIds[0] : oldPrimaryId;
    const tenantName = [freshTenant.firstName, freshTenant.middleName, freshTenant.lastName].filter(Boolean).join(" ");
    const stall = freshStallSnap.data()!;

    tx.update(tenantRef, {
      stallIds: remainingIds,
      primaryStallId: newPrimaryId,
      stallId: newPrimaryId,
      stallAssignments: remainingAssignments,
      price: newDailyRate,
      billingRateHistory: FieldValue.arrayUnion({
        previousDailyRate: Number(freshTenant.price ?? 0),
        newDailyRate,
        effectiveAt: Timestamp.now(),
        reason: "Stall removed",
        removedStallId: stallId,
        changedBy: callerUid,
      }),
      assignmentVersion: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(stallRef, {status: "unoccupied", tenantId: null, tenantName: null});
    tx.set(db.collection("updates").doc(), {
      module: "Manage Tenant",
      type: "Stall Removed",
      tenantId,
      tenantName,
      stallId,
      spaceNo: String(stall.spaceId ?? stallId),
      buildingNo: String(stall.buildingNumber ?? ""),
      oldValue: `Assigned · ₱${Number(freshTenant.price ?? 0)}/day`,
      newValue: `Unoccupied · tenant total ₱${newDailyRate}/day`,
      changedBy: callerUid,
      approvalStatus: "pending",
      createdAt: FieldValue.serverTimestamp(),
      timestamp: FieldValue.serverTimestamp(),
    });
    return {stallIds: remainingIds, primaryStallId: newPrimaryId, combinedDailyRate: newDailyRate};
  });
  return {success: true, ...result};
});

export const adminUpdateStallRentalTermsSafely = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "You must be logged in.");
  await assertIsAdmin(callerUid);
  const input = inputObject(request.data);
  const stallId = validUid(input.stallId);
  const length = Number(input.length);
  const width = Number(input.width);
  const dailyRate = Number(input.dailyRate);
  const paymentSchedule = requiredText(input.paymentSchedule, "Payment schedule", 32).toLowerCase();
  const category = requiredText(input.category, "Category", 100);
  if (![length, width, dailyRate].every(Number.isFinite) || length <= 0 || width <= 0 || dailyRate < 0) {
    throw new HttpsError("invalid-argument", "Enter valid stall dimensions and rental rate.");
  }
  if (!['daily', 'weekly', 'semi-monthly', 'monthly'].includes(paymentSchedule)) {
    throw new HttpsError("invalid-argument", "Invalid payment schedule.");
  }
  const stallRef = db.collection("stalls").doc(stallId);
  const initialStall = await stallRef.get();
  if (!initialStall.exists) throw new HttpsError("not-found", "Stall was not found.");
  const tenantId = String(initialStall.data()?.tenantId ?? "");

  if (tenantId) {
    const tenantSnap = await db.collection("users").doc(tenantId).get();
    if (!tenantSnap.exists || tenantSnap.data()?.status !== "active") throw new HttpsError("failed-precondition", "The occupying tenant record is not active.");
    const tenant = tenantSnap.data()!;
    await assertNoOpenPaymentAttempt(tenantId, "Finish or cancel the tenant's active payment attempt before changing rental terms.");
    const pending = await db.collection("payments").where("userId", "==", tenantId).where("status", "==", "pending").limit(1).get();
    if (!pending.empty) throw new HttpsError("failed-precondition", "Resolve the tenant's pending payment before changing rental terms.");
    const dueValue = tenant.nextDueAt ?? tenant.billingStartedAt ?? tenant.createdAt;
    const dueAt = dueValue?.toDate ? dueValue.toDate() : null;
    const balance = await getOutstandingBalance(
      tenantId,
      String(tenant.paymentSchedule ?? "monthly"),
      Number(tenant.price ?? 0),
      new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Manila"})),
      dueAt,
    );
    if (balance > 0) throw new HttpsError("failed-precondition", `Settle the tenant's existing balance of ₱${balance.toLocaleString()} before changing rental terms.`);
  }

  return db.runTransaction(async (tx) => {
    const tenantRef = tenantId ? db.collection("users").doc(tenantId) : null;
    const paymentLockRef = tenantId ? db.collection("paymentAttemptLocks").doc(tenantId) : null;
    const reads = tenantRef && paymentLockRef
      ? await Promise.all([tx.get(stallRef), tx.get(tenantRef), tx.get(paymentLockRef)])
      : [await tx.get(stallRef)];
    const freshStall = reads[0];
    const freshTenant = reads[1];
    const paymentLock = reads[2];
    if (hasOpenPaymentAttempt(paymentLock?.data())) {
      throw new HttpsError("failed-precondition", "Finish or cancel the tenant's active payment attempt before changing rental terms.");
    }
    if (!freshStall.exists) throw new HttpsError("not-found", "Stall was not found.");
    if (String(freshStall.data()?.tenantId ?? "") !== tenantId) throw new HttpsError("aborted", "Stall occupancy changed. Refresh and try again.");

    tx.update(stallRef, {
      length,
      width,
      price: dailyRate,
      paymentSchedule,
      paymentIntervalDays: paymentIntervalDaysFor(paymentSchedule),
      category,
    });

    let combinedDailyRate = dailyRate;
    if (tenantRef && freshTenant?.exists) {
      const tenant = freshTenant.data()!;
      const ids = normalizedTenantStallIds(tenant);
      if (!ids.includes(stallId)) throw new HttpsError("failed-precondition", "Tenant and stall assignments do not match. No changes were made.");
      const entries = Array.isArray(tenant.stallAssignments)
        ? tenant.stallAssignments.filter((entry: unknown) => entry && typeof entry === "object") as Record<string, unknown>[]
        : [];
      const map = new Map(entries.map((entry) => [String(entry.stallId ?? ""), entry]));
      const primaryId = String(tenant.primaryStallId ?? tenant.stallId ?? ids[0]);
      for (const id of ids) {
        if (!map.has(id)) map.set(id, {stallId: id, dailyRate: id === primaryId ? Number(tenant.price ?? 0) : 0});
      }
      map.set(stallId, {...(map.get(stallId) ?? {}), stallId, dailyRate, updatedAt: Timestamp.now()});
      const assignments = ids.map((id) => map.get(id)!).filter(Boolean);
      combinedDailyRate = assignments.reduce((sum, entry) => sum + Math.max(0, Number(entry.dailyRate ?? 0)), 0);
      tx.update(tenantRef, {
        stallId: primaryId,
        primaryStallId: primaryId,
        stallIds: ids,
        stallAssignments: assignments,
        price: combinedDailyRate,
        paymentSchedule,
        paymentIntervalDays: paymentIntervalDaysFor(paymentSchedule),
        category,
        billingRateHistory: FieldValue.arrayUnion({previousDailyRate: Number(tenant.price ?? 0), newDailyRate: combinedDailyRate, effectiveAt: Timestamp.now(), reason: "Stall rental terms updated", stallId, changedBy: callerUid}),
        assignmentVersion: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return {success: true, combinedDailyRate};
  });
});

export const archiveTenantSafely = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "You must be logged in.");
  await assertIsAdminOrOwner(callerUid);
  const tenantId = validUid(inputObject(request.data).uid);
  const tenantRef = db.collection("users").doc(tenantId);
  const tenantSnap = await tenantRef.get();
  if (!tenantSnap.exists || tenantSnap.data()?.role !== "tenant") {
    throw new HttpsError("not-found", "Tenant account was not found.");
  }
  const tenant = tenantSnap.data()!;
  if (tenant.status === "archived") return {success: true, alreadyArchived: true};
  await assertNoOpenPaymentAttempt(tenantId, "Finish or cancel the tenant's active payment attempt before archiving the account.");

  const paymentsSnap = await db.collection("payments").where("userId", "==", tenantId).where("status", "==", "pending").limit(1).get();
  if (!paymentsSnap.empty) throw new HttpsError("failed-precondition", "An online payment is awaiting approval.");
  const schedule = String(tenant.paymentSchedule ?? "monthly");
  const dailyRate = Number(tenant.price ?? 0);
  const nowManila = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Manila"}));
  const dueValue = tenant.nextDueAt ?? tenant.billingStartedAt ?? tenant.createdAt;
  const nextDueAt = dueValue?.toDate ? dueValue.toDate() : null;
  const outstandingBalance = await getOutstandingBalance(tenantId, schedule, dailyRate, nowManila, nextDueAt);
  if (outstandingBalance > 0) {
    throw new HttpsError("failed-precondition", `Tenant has an unsettled balance of ₱${outstandingBalance.toLocaleString()}.`);
  }

  const stallIds = normalizedTenantStallIds(tenant);
  const stallRefs = stallIds.map((id) => db.collection("stalls").doc(id));
  const stallSnaps = await Promise.all(stallRefs.map((ref) => ref.get()));
  const ownedStalls = stallSnaps.filter((snap) => snap.exists && snap.data()?.tenantId === tenantId);
  const archiveRef = db.collection("archives").doc(tenantId);
  const tenantName = [tenant.firstName, tenant.middleName, tenant.lastName].filter(Boolean).join(" ");

  await db.runTransaction(async (tx) => {
    const paymentLockRef = db.collection("paymentAttemptLocks").doc(tenantId);
    const [freshTenantSnap, paymentLockSnap, ...freshStallSnaps] = await Promise.all([
      tx.get(tenantRef),
      tx.get(paymentLockRef),
      ...stallRefs.map((ref) => tx.get(ref)),
    ]);
    if (hasOpenPaymentAttempt(paymentLockSnap.data())) {
      throw new HttpsError("failed-precondition", "Finish or cancel the tenant's active payment attempt before archiving the account.");
    }
    if (!freshTenantSnap.exists || freshTenantSnap.data()?.status !== "active") {
      throw new HttpsError("aborted", "Tenant status changed. Refresh and try again.");
    }
    const freshIds = normalizedTenantStallIds(freshTenantSnap.data()!);
    if (freshIds.length !== stallIds.length || freshIds.some((id) => !stallIds.includes(id))) {
      throw new HttpsError("aborted", "Tenant stall assignments changed. Refresh and try again.");
    }
    if (freshStallSnaps.some((snap) => !snap.exists || snap.data()?.tenantId !== tenantId)) {
      throw new HttpsError("failed-precondition", "Tenant and stall records do not match. No changes were made.");
    }
    tx.set(archiveRef, {
      ...tenant,
      originalUid: tenantId,
      stallIds,
      primaryStallId: tenant.primaryStallId ?? tenant.stallId ?? stallIds[0] ?? null,
      archivedAt: FieldValue.serverTimestamp(),
    });
    tx.update(tenantRef, {status: "archiving", updatedAt: FieldValue.serverTimestamp()});
    ownedStalls.forEach((snap) => tx.update(snap.ref, {status: "archiving"}));
  });

  try {
    await auth.updateUser(tenantId, {disabled: true});
  } catch (error) {
    await db.runTransaction(async (tx) => {
      tx.update(tenantRef, {status: "active", updatedAt: FieldValue.serverTimestamp()});
      tx.delete(archiveRef);
      ownedStalls.forEach((snap) => tx.update(snap.ref, {status: "occupied", tenantId, tenantName}));
    });
    throw new HttpsError("internal", "The tenant account could not be disabled. No archive changes were kept.");
  }

  try {
    await db.runTransaction(async (tx) => {
      tx.update(tenantRef, {status: "archived", updatedAt: FieldValue.serverTimestamp()});
      ownedStalls.forEach((snap) => tx.update(snap.ref, {status: "unoccupied", tenantId: null, tenantName: null}));
      const updateRef = db.collection("updates").doc();
      tx.set(updateRef, {
        module: "Manage Tenant",
        type: "Tenant Archived",
        tenantId,
        tenantName,
        stallIds,
        spaceNo: ownedStalls.map((snap) => String(snap.data()?.spaceId ?? snap.id)).join(", "),
        oldValue: "Active",
        newValue: "Archived",
        changedBy: callerUid,
        approvalStatus: "pending",
        createdAt: FieldValue.serverTimestamp(),
        timestamp: FieldValue.serverTimestamp(),
      });
    });
  } catch (error) {
    try {
      await auth.updateUser(tenantId, {disabled: false});
      await db.runTransaction(async (tx) => {
        tx.update(tenantRef, {status: "active", updatedAt: FieldValue.serverTimestamp()});
        tx.delete(archiveRef);
        ownedStalls.forEach((snap) => tx.update(snap.ref, {status: "occupied", tenantId, tenantName}));
      });
    } catch (rollbackError) {
      console.error("Archive finalization and rollback both failed", {tenantId, error, rollbackError});
      throw new HttpsError("internal", "Archive could not finish safely. The account remains locked for administrator review.");
    }
    throw new HttpsError("internal", "Archive could not be completed. All changes were rolled back.");
  }
  return {success: true};
});
