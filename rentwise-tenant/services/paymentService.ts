import {
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

import { db, firebaseApp } from "../shared/firebaseConfig";

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

export async function createPayment(data: any) {
  const createPendingPayment = httpsCallable<
    Record<string, unknown>,
    { paymentId: string; receiptNo: string }
  >(getFunctions(firebaseApp), "createTenantPendingPayment");
  const result = await createPendingPayment(data);
  return result.data.paymentId;
}

export async function createOnlinePayment(
  amount: number,
  paymentMethod: PaymentMethodType,
  _customer?: { name: string; email: string },
): Promise<{ redirectUrl: string; paymentIntentId: string }> {
  const createIntent = httpsCallable<
    { amount: number; paymentMethod: PaymentMethodType },
    { redirectUrl: string; paymentIntentId: string; amount: number }
  >(getFunctions(firebaseApp), "createTenantPaymongoPaymentIntent");
  const result = await createIntent({ amount, paymentMethod });
  return {
    redirectUrl: result.data.redirectUrl,
    paymentIntentId: result.data.paymentIntentId,
  };
}

export async function getTenantPayments(userId: string) {
  const ref = collection(db, "payments");

  const q = query(
    ref,

    where("userId", "==", userId),
  );

  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => ({
    id: doc.id,

    ...doc.data(),
  }));
}
