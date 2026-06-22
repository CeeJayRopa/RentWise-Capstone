import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { firebaseApp } from "../firebaseConfig";

export const auth = getAuth(firebaseApp);

export const registerUser = async (
  email: string,
  password: string
) => {

  const result =
    await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );

  return result.user;

};


export const loginUser = async (
  email: string,
  password: string
) => {

  const result =
    await signInWithEmailAndPassword(
      auth,
      email,
      password
    );

  return result.user;

};


export const logoutUser = async () => {

  await signOut(auth);

};