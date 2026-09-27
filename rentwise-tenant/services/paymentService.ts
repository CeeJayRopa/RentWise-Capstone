import {
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

import { db, firebaseApp } from "../shared/firebaseConfig";
import { createPaymongoPaymentIntent, PaymentMethodType } from "./paymongo";

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
  customer?: { name: string; email: string },
): Promise<{ redirectUrl: string; paymentIntentId: string }> {
  return createPaymongoPaymentIntent(amount, paymentMethod, customer);
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
