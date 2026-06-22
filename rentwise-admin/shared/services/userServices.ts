import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { db } from "./firestore";
import { User } from "../types/user";

export const getUserById = async (uid: string): Promise<User | null> => {
  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) return null;
  return userSnap.data() as User;
};

export const getUserRole = async (uid: string) => {
  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);

  if (userSnap.exists()) {
    return userSnap.data().role;
  }

  return null;
};

export const getUserByUsername = async (
  username: string
): Promise<(User & { uid: string }) | null> => {
  const q = query(collection(db, "users"), where("userName", "==", username));
  const snapshot = await getDocs(q);

  if (snapshot.empty) return null;

  const docSnap = snapshot.docs[0];
  return { uid: docSnap.id, ...(docSnap.data() as User) };
};
