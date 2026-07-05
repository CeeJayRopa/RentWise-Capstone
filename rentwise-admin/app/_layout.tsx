import { useEffect } from "react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { onAuthStateChanged } from "firebase/auth";

import { auth } from "../shared/services/auth";
import {
  configurePushNotifications,
  registerForPushNotificationsAsync,
} from "../shared/services/pushNotifications";

configurePushNotifications();

// Keeps the native (navy) splash on screen until the JS entrance screen has
// actually painted its own content — without this, the native splash hides
// itself as soon as the root view mounts, exposing a brief flash of the
// app's default white background before the entrance screen's navy
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

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "fade",
        animationDuration: 200,
      }}
    />
  );
}
