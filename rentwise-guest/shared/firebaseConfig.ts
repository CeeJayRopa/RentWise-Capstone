import { initializeApp } from "firebase/app";
import {  getAuth } from "firebase/auth";
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

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);

const auth = getAuth(firebaseApp);

const db = getFirestore(firebaseApp);

const storage = getStorage(firebaseApp);


// Export everything needed by your apps
export {
  firebaseApp,
  auth,
  db,
  storage
};