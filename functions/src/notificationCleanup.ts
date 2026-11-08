import {onSchedule} from "firebase-functions/v2/scheduler";
import {getFirestore} from "firebase-admin/firestore";

const BATCH_SIZE = 400;

export const cleanupExpiredNotifications = onSchedule(
  {schedule: "15 3 * * *", timeZone: "Asia/Manila", maxInstances: 1},
  async () => {
    const db = getFirestore();
    let deleted = 0;

    // A bounded loop prevents a large historical backlog from monopolizing
    // one invocation. Later daily runs continue where this one stopped.
    for (let pass = 0; pass < 10; pass++) {
      const snapshot = await db.collection("notifications")
        .where("expiresAt", "<=", Date.now())
        .limit(BATCH_SIZE)
        .get();
      if (snapshot.empty) break;

      const batch = db.batch();
      snapshot.docs.forEach((item) => batch.delete(item.ref));
      await batch.commit();
      deleted += snapshot.size;
      if (snapshot.size < BATCH_SIZE) break;
    }

    console.log(`[NOTIFICATION CLEANUP] Deleted ${deleted} expired notification(s).`);
  },
);
