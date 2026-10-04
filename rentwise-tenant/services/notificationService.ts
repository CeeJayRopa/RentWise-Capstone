import { collection, query, where, orderBy, getDocs } from "firebase/firestore";

import { db } from "../shared/firebaseConfig";
import { readLocalCache, saveLocalCache } from "../shared/services/localCache";

export async function getTenantNotifications(userId: string) {
  const cacheKey = `tenant:${userId}:notifications`;
  try {
    const q = query(
      collection(db, "notifications"),

    where("userId", "==", userId),

    orderBy("createdAt", "desc"),
  );

    const snapshot = await getDocs(q);

    const notifications = snapshot.docs.map((doc) => ({id: doc.id, ...doc.data()}));
    await saveLocalCache(cacheKey, notifications);
    return notifications;
  } catch (error) {
    const cached = await readLocalCache<Array<Record<string, unknown>>>(cacheKey);
    if (cached) return cached;
    throw error;
  }
}
