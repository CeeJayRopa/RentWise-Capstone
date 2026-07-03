import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// Triggers whenever a new payment document is created, for ANY payment
// path (the in-app WebView handler or the payment-success.tsx fallback
// screen) — runs server-side via the Admin SDK, so it can't be silently
// blocked by Firestore security rules the way a tenant-authored client
// write (creating a notification doc for a different user, the admin)
// could be. Notifies every admin the moment a tenant submits an online
// payment awaiting confirmation.
export const notifyAdminsOnPayment = onDocumentCreated(
  "payments/{paymentId}",
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    if (data.method !== "online" || data.status !== "pending") return;

    const db = getFirestore();
    const adminsSnap = await db
      .collection("users")
      .where("role", "==", "admin")
      .get();
    if (adminsSnap.empty) return;

    const tenantName: string = data.tenantName || "A tenant";
    const amount: number = Number(data.amount || 0);
    const spaceId: string = data.spaceId || "—";
    const message = `${tenantName} submitted an online payment of ₱${amount.toLocaleString()} for Space ${spaceId} — awaiting confirmation.`;

    const batch = db.batch();
    for (const adminDoc of adminsSnap.docs) {
      batch.set(db.collection("notifications").doc(), {
        userId: adminDoc.id,
        message,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  },
);
