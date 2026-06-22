import { getStorage } from "firebase/storage";
import { firebaseApp } from "../firebaseConfig";

export const storage = getStorage(firebaseApp);