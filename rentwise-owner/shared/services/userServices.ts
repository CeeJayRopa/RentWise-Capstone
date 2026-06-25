import { doc, getDoc, collection, query, where, getDocs, updateDoc } from "firebase/firestore";
import { db } from "./firestore";

export const getUserRole = async (uid: string) => {
  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);
  if (userSnap.exists()) {
    return userSnap.data().role;
  }
  return null;
};

export const getUserById = async (uid: string) => {
  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) return null;
  return userSnap.data();
};

export const getUserByUsername = async (
  username: string,
  role: string = "owner",
): Promise<{ uid: string; email: string; [key: string]: any } | null> => {
  // Try lowercase "username" field first (Cloud Function convention)
  const q1 = query(
    collection(db, "users"),
    where("username", "==", username),
    where("role", "==", role),
  );
  const snap1 = await getDocs(q1);
  if (!snap1.empty) {
    const d = snap1.docs[0];
    return { uid: d.id, ...d.data() } as { uid: string; email: string; [key: string]: any };
  }

  // Try camelCase "userName" field (admin app convention)
  const q2 = query(
    collection(db, "users"),
    where("userName", "==", username),
    where("role", "==", role),
  );
  const snap2 = await getDocs(q2);
  if (!snap2.empty) {
    const d = snap2.docs[0];
    return { uid: d.id, ...d.data() } as { uid: string; email: string; [key: string]: any };
  }

  return null;
};

export const updateUserProfile = async (
  uid: string,
  data: { firstName?: string; lastName?: string; contactNo?: string; username?: string },
) => {
  await updateDoc(doc(db, "users", uid), data);
};
