import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../shared/firebaseConfig";
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
  const ref = collection(db, "payments");
  const payload = { ...data, date: serverTimestamp() };

  const docRef = await addDoc(ref, payload);

  return docRef.id;
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
