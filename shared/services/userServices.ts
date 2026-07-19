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

export const updateUserProfile = async (
  uid: string,
  data: { firstName?: string; lastName?: string; contactNo?: string; username?: string },
) => {
  await updateDoc(doc(db, "users", uid), data);
};

export const isUsernameTaken = async (
  username: string,
  role: string,
  excludeUid: string,
): Promise<boolean> => {
  const q = query(
    collection(db, "users"),
    where("username", "==", username),
    where("role", "==", role),
  );
  const snap = await getDocs(q);
  return snap.docs.some((d: any) => d.id !== excludeUid);
};
