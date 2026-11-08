import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

// Triggers whenever a new document is added to the notifications collection.
// Looks up the target user's Expo push token and sends a push notification
// via the Expo Push API. This runs in addition to the existing in-app
// notification record — it does not replace or modify it.
export const sendPushOnNotification = onDocumentCreated(
  "notifications/{notifId}",
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const userId: string = data.userId;
    const message: string = data.message ?? data.body ?? "";

    if (!userId || !message) return;

    let expoPushToken: string | undefined;

    try {
      const userDoc = await getFirestore().collection("users").doc(userId).get();
      if (!userDoc.exists) return;
      expoPushToken = userDoc.data()?.expoPushToken;
    } catch (err) {
      console.error("[PUSH FAILED] Could not fetch user doc:", err);
      return;
    }

    if (!expoPushToken) {
      console.log(`[PUSH SKIP] No push token found for user ${userId}`);
      return;
    }

    try {
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: expoPushToken,
          title: "RentWise",
          body: message,
          sound: "default",
          priority: "high",
          channelId: "default",
        }),
      });

      if (!response.ok) throw new Error(`Expo Push API returned HTTP ${response.status}.`);
      const result = (await response.json()) as {
        data?: {status?: string; message?: string; details?: {error?: string}};
      };
      const ticket = result.data;
      if (ticket?.status !== "ok") {
        const errorCode = ticket?.details?.error ?? "UnknownPushError";
        console.error(`[PUSH REJECTED] for user ${userId}`, {errorCode, message: ticket?.message});
        if (errorCode === "DeviceNotRegistered") {
          const userRef = getFirestore().collection("users").doc(userId);
          await getFirestore().runTransaction(async (tx) => {
            const fresh = await tx.get(userRef);
            if (fresh.data()?.expoPushToken === expoPushToken) {
              tx.update(userRef, {expoPushToken: FieldValue.delete()});
            }
          });
        }
        return;
      }
      console.log(`[PUSH ACCEPTED] for user ${userId}`);
    } catch (err) {
      console.error(`[PUSH FAILED] for user ${userId}:`, err);
    }
  },
);
