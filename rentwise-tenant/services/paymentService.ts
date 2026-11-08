import {
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

import { db, firebaseApp } from "../shared/firebaseConfig";
import { readLocalCache, saveLocalCache } from "../shared/services/localCache";

export type PaymentMethodType = "gcash" | "paymaya";

export interface Payment {
  id: string;

  userId: string;

  amount: number;

  method: string;

  status: string;

  receipt?: string;

  paymentId?: string;

  date: any;
}

export type PaymentAttemptStatus =
  | "pending"
  | "processing"
  | "paid"
  | "expired"
  | "failed"
  | "cancelled";

export type PaymentRecordingResult = {
  status: PaymentAttemptStatus | "recorded";
  paymentId?: string;
  receiptNo?: string;
  providerStatus?: string;
};

export type PaymentRecoveryResult =
  | ({ status: PaymentAttemptStatus; providerStatus?: string; sessionId: string; redirectUrl?: string; amount?: number; paymentMethod?: PaymentMethodType })
  | { status: "none" };

export async function createPayment(data: any): Promise<PaymentRecordingResult> {
  const createPendingPayment = httpsCallable<
    Record<string, unknown>,
    PaymentRecordingResult
  >(getFunctions(firebaseApp), "createTenantPendingPayment");
  const result = await createPendingPayment(data);
  return result.data;
}

export async function reconcilePendingPayment(checkoutSessionId: string): Promise<PaymentRecordingResult> {
  const reconcile = httpsCallable<
    { checkoutSessionId: string },
    PaymentRecordingResult
  >(getFunctions(firebaseApp), "reconcileTenantPayment");
  const result = await reconcile({ checkoutSessionId });
  return result.data;
}

export async function recoverPaymentSession(): Promise<PaymentRecoveryResult> {
  const recover = httpsCallable<
    Record<string, never>,
    PaymentRecoveryResult
  >(getFunctions(firebaseApp), "recoverTenantPaymentSession");
  const result = await recover({});
  return result.data;
}

export async function interruptPaymentSession(checkoutSessionId: string): Promise<PaymentRecordingResult> {
  const interrupt = httpsCallable<
    { checkoutSessionId: string },
    PaymentRecordingResult
  >(getFunctions(firebaseApp), "interruptTenantPaymentSession");
  const result = await interrupt({ checkoutSessionId });
  return result.data;
}

export async function createOnlinePayment(
  advancePeriods: number,
  paymentMethod: PaymentMethodType,
  _customer?: { name: string; email: string },
): Promise<{ redirectUrl: string; paymentIntentId: string; amount: number; paidThroughAt?: string }> {
  const createIntent = httpsCallable<
    { advancePeriods: number; paymentMethod: PaymentMethodType },
    { redirectUrl: string; paymentIntentId: string; amount: number; paidThroughAt?: string }
  >(getFunctions(firebaseApp), "createTenantPaymongoPaymentIntent");
  const result = await createIntent({ advancePeriods, paymentMethod });
  return {
    redirectUrl: result.data.redirectUrl,
    paymentIntentId: result.data.paymentIntentId,
    amount: result.data.amount,
    paidThroughAt: result.data.paidThroughAt,
  };
}

export async function createTestPayment(
  _amount: number,
  _paymentMethod: PaymentMethodType,
  _requestId: string,
): Promise<{ status: "recorded"; paymentId: string; receiptNo: string }> {
  throw new Error("Test payment simulation has been permanently disabled.");
}

export async function getTenantPayments(userId: string) {
  const cacheKey = `tenant:${userId}:payments`;
  try {
    const ref = collection(db, "payments");

  const q = query(
    ref,

    where("userId", "==", userId),
  );

  const snapshot = await getDocs(q);

    const payments = snapshot.docs.map((doc) => ({id: doc.id, ...doc.data()}));
    await saveLocalCache(cacheKey, payments);
    return payments;
  } catch (error) {
    const cached = await readLocalCache<Array<Record<string, unknown>>>(cacheKey);
    if (cached) return cached;
    throw error;
  }
}
