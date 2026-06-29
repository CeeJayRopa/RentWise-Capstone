import { useEffect } from "react";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { onAuthStateChanged } from "firebase/auth";

import { auth } from "../shared/firebaseConfig";
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

  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false, animation: "fade", animationDuration: 200 }} />
    </SafeAreaProvider>
  );
}
