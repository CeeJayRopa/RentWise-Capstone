import { createUserWithEmailAndPassword, signInWithCustomToken, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { auth, firebaseApp } from "../firebaseConfig";

export { auth };

export const registerUser = async (
  email: string,
  password: string
) => {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  return result.user;
};

export const loginUser = async (
  email: string,
  password: string
) => {
  const result = await signInWithEmailAndPassword(auth, email, password);
  return result.user;
};

export const loginUserWithAccountLockout = async (
  identifier: string,
  password: string,
  role: "tenant" | "admin" | "owner",
) => {
  const login = httpsCallable(getFunctions(firebaseApp), "loginWithAccountLockout");
  const response = await login({identifier, password, role});
  const customToken = (response.data as {customToken?: string})?.customToken;
  if (!customToken) throw new Error("The login service returned an invalid response.");
  const result = await signInWithCustomToken(auth, customToken);
  return result.user;
};

export const logoutUser = async () => {
  await signOut(auth);
};
