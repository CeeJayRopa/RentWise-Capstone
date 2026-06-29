import { getFirestore } from "firebase/firestore";
import { firebaseApp } from "../firebaseConfig";

export const db = getFirestore(firebaseApp);
