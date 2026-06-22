import { signInWithEmailAndPassword, signOut } from "firebase/auth";

import { auth } from "../shared/firebaseConfig";

export async function loginUser(email: string, password: string) {
  const result = await signInWithEmailAndPassword(auth, email, password);

  return result.user;
}

export async function logoutUser() {
  await signOut(auth);
}
