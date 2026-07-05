import { useEffect } from "react";
import { Stack, router } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { Alert } from "react-native";
import * as SplashScreen from "expo-splash-screen";

import { auth, db } from "../shared/firebaseConfig";
import {
  configurePushNotifications,
  registerForPushNotificationsAsync,
} from "../shared/services/pushNotifications";

configurePushNotifications();

// Keeps the native (green) splash on screen until the JS entrance screen has
// actually painted its own content — without this, the native splash hides
// itself as soon as the root view mounts, exposing a brief flash of the
// app's default white background before the entrance screen's green
// background and logo render underneath it.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        registerForPushNotificationsAsync(user.uid);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    // Disabling the tenant's Firebase Auth account only blocks NEW sign-ins
    // — a session already open on this device keeps working until its
    // token naturally expires. Watching the tenant's own doc for real time
    // lets us force a sign-out the moment an admin/owner archives them,
    // instead of leaving the archived account usable for up to an hour.
    let unsubDoc: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      unsubDoc?.();
      unsubDoc = null;
      if (!user) return;

      unsubDoc = onSnapshot(doc(db, "users", user.uid), (snap) => {
        const status = snap.data()?.status;
        if (snap.exists() && status && status !== "active") {
          signOut(auth)
            .catch(() => {})
            .finally(() => {
              Alert.alert(
                "Account Archived",
                "This account has been archived. Please contact the admin if this is unexpected.",
              );
              router.replace("/login");
            });
        }
      });
    });

    return () => {
      unsubAuth();
      unsubDoc?.();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false, animation: "fade", animationDuration: 200 }} />
    </SafeAreaProvider>
  );
}
