import { collection, query, where, orderBy, getDocs } from "firebase/firestore";

import { db } from "../shared/firebaseConfig";

export async function getTenantNotifications(userId: string) {
  const q = query(
    collection(db, "notifications"),

    where("userId", "==", userId),

    orderBy("createdAt", "desc"),
  );

  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => ({
    id: doc.id,

    ...doc.data(),
  }));
}
