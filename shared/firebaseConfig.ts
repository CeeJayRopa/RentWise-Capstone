import { initializeApp } from "firebase/app";
import { initializeAuth, inMemoryPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCo_sM0NvjXReuQsTep28s7onguf0IJvE8",
  authDomain: "rentwise-capstone-project.firebaseapp.com",
  projectId: "rentwise-capstone-project",
  storageBucket: "rentwise-capstone-project.firebasestorage.app",
  messagingSenderId: "223742757751",
  appId: "1:223742757751:web:177dcdac35dd655b49af72"
};

const firebaseApp = initializeApp(firebaseConfig);

let persistence: any = inMemoryPersistence;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require("@react-native-async-storage/async-storage").default;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getReactNativePersistence } = require("firebase/auth");
  if (AsyncStorage && getReactNativePersistence) {
    persistence = getReactNativePersistence(AsyncStorage);
  }
} catch {
  // falls back to inMemoryPersistence (Expo Go / web)
}

const auth = initializeAuth(firebaseApp, { persistence });

const db = getFirestore(firebaseApp);

const storage = getStorage(firebaseApp);

export {
  firebaseApp,
  auth,
  db,
  storage
};
