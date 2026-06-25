import { initializeApp } from "firebase/app";
import { initializeAuth, getReactNativePersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import AsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: "AIzaSyCo_sM0NvjXReuQsTep28s7onguf0IJvE8",
  authDomain: "rentwise-capstone-project.firebaseapp.com",
  projectId: "rentwise-capstone-project",
  storageBucket: "rentwise-capstone-project.firebasestorage.app",
  messagingSenderId: "223742757751",
  appId: "1:223742757751:web:177dcdac35dd655b49af72"
};

const firebaseApp = initializeApp(firebaseConfig);

const auth = initializeAuth(firebaseApp, {
  persistence: getReactNativePersistence(AsyncStorage),
});

const db = getFirestore(firebaseApp);

const storage = getStorage(firebaseApp);

export {
  firebaseApp,
  auth,
  db,
  storage
};