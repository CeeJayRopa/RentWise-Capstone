import { useEffect } from "react";
import { Stack } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";

import { auth } from "../shared/services/auth";
import {
  configurePushNotifications,
  registerForPushNotificationsAsync,
} from "../shared/services/pushNotifications";

configurePushNotifications();

export default function RootLayout() {
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        registerForPushNotificationsAsync(user.uid);
      }
    });
    return unsub;
  }, []);

  return <Stack screenOptions={{ headerShown: false, animation: "fade", animationDuration: 200 }} />;
}
