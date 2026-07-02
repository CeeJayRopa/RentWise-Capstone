import {
  collection,
  addDoc,
  doc,
  query,
  where,
  getDocs,
  serverTimestamp,
  writeBatch,
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

export async function notifyAdminsOfOnlinePayment(
  tenantName: string,
  amount: number,
  spaceId: string,
) {
  const adminsSnap = await getDocs(
    query(collection(db, "users"), where("role", "==", "admin")),
  );
  if (adminsSnap.empty) return;

  const message = `${tenantName || "A tenant"} submitted an online payment of ₱${amount.toLocaleString()} for Space ${spaceId || "—"} — awaiting confirmation.`;

  const batch = writeBatch(db);
  for (const adminDoc of adminsSnap.docs) {
    batch.set(doc(collection(db, "notifications")), {
      userId: adminDoc.id,
      message,
      read: false,
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit();
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
