import { initializeApp } from "firebase/app";
import { initializeAuth, getAuth } from "firebase/auth";
import type { Auth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { initializeAppCheck, ReCaptchaV3Provider, CustomProvider } from "firebase/app-check";
import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const firebaseConfig = {
  apiKey: "AIzaSyCo_sM0NvjXReuQsTep28s7onguf0IJvE8",
  authDomain: "rentwise-capstone-project.firebaseapp.com",
  projectId: "rentwise-capstone-project",
  storageBucket: "rentwise-capstone-project.firebasestorage.app",
  messagingSenderId: "223742757751",
  appId: "1:223742757751:web:177dcdac35dd655b49af72"
};

const firebaseApp = initializeApp(firebaseConfig);

// ── App Check ──────────────────────────────────────────────────────────────
// Proves a request is coming from a real, unmodified copy of one of our own
// apps -- not a script hitting Firestore/Functions directly with the same
// public config every client already ships with (that config was never a
// secret; App Check is the thing that's actually supposed to gate access).
// One init here covers all 4 apps, since they all share this file.
//
// Web (guest) uses Google's reCAPTCHA v3, the standard browser attestation.
// Native (admin/owner/tenant) has no browser to run reCAPTCHA in, so it
// bridges through @react-native-firebase/app-check instead, which talks to
// Play Integrity (Android) / App Attest (iOS) -- real OS-level attestation,
// not something a script can fake. That package only matters on native and
// requires its own native build to exist, so it's require()'d inside a
// try/catch (same trick as getReactNativePersistence below): a native app
// that hasn't been rebuilt with it yet, or Expo Go (which can't load custom
// native modules at all), just runs without App Check instead of crashing.
//
// IMPORTANT -- before this actually protects anything:
// 1. Replace RECAPTCHA_V3_SITE_KEY below with the real one from Firebase
//    Console -> App Check -> Apps -> (web app) -> reCAPTCHA v3.
// 2. Register each native app in Firebase Console -> App Check and link
//    Play Integrity (Android Play Console) / App Attest (Apple Developer).
// 3. Only flip "Enforce" per product (Firestore/Functions/Storage) in
//    Firebase Console once real traffic is confirmed to be sending valid
//    tokens -- enforcing before that locks out every real user too.
const RECAPTCHA_V3_SITE_KEY = "REPLACE_WITH_RECAPTCHA_V3_SITE_KEY";

try {
  if (Platform.OS === "web") {
    initializeAppCheck(firebaseApp, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_V3_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } else {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getApp } = require("@react-native-firebase/app");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {
      initializeAppCheck: initializeRnfbAppCheck,
      ReactNativeFirebaseAppCheckProvider,
    } = require("@react-native-firebase/app-check");

    const rnfbProvider = new ReactNativeFirebaseAppCheckProvider();
    rnfbProvider.configure({
      android: { provider: __DEV__ ? "debug" : "playIntegrity" },
      apple: { provider: __DEV__ ? "debug" : "appAttestWithDeviceCheckFallback" },
      isTokenAutoRefreshEnabled: true,
    });
    // Activates the native attestation session. Fire-and-forget at module
    // load, but every token request below awaits it first so nothing asks
    // for a token before it's actually ready.
    const rnfbReady = initializeRnfbAppCheck(getApp(), {
      provider: rnfbProvider,
      isTokenAutoRefreshEnabled: true,
    });

    initializeAppCheck(firebaseApp, {
      provider: new CustomProvider({
        getToken: async () => {
          await rnfbReady;
          // Same provider instance the native side already activated --
          // its getToken() returns the real {token, expireTimeMillis} pair,
          // re-attested by Play Integrity/App Attest each time it's called.
          return rnfbProvider.getToken();
        },
      }),
      isTokenAutoRefreshEnabled: true,
    });
  }
} catch (err) {
  // Non-fatal by design -- see the comment block above.
  console.warn("[AppCheck] not initialized:", err);
}

// getReactNativePersistence lives in the RN-specific firebase/auth build.
// TypeScript resolves the browser types which don't include it, so we require()
// it at runtime to bypass the type check while still getting AsyncStorage persistence.
let auth: Auth;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getReactNativePersistence } = require("firebase/auth") as { getReactNativePersistence: (storage: typeof ReactNativeAsyncStorage) => import("firebase/auth").Persistence };
  auth = initializeAuth(firebaseApp, {
    persistence: getReactNativePersistence(ReactNativeAsyncStorage),
  });
} catch {
  auth = getAuth(firebaseApp);
}

const db = getFirestore(firebaseApp);

const storage = getStorage(firebaseApp);

export {
  firebaseApp,
  auth,
  db,
  storage
};
