import { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import { Stack } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import * as SplashScreen from "expo-splash-screen";
import {
  useFonts,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from "@expo-google-fonts/plus-jakarta-sans";

import { auth } from "../shared/services/auth";
import {
  configurePushNotifications,
  registerForPushNotificationsAsync,
} from "../shared/services/pushNotifications";
import { useResponsive, MAX_CONTENT_WIDTH } from "../shared/hooks/useResponsive";
import { colors } from "../shared/theme";

configurePushNotifications();

// Keeps the native (navy) splash on screen until the JS entrance screen has
// actually painted its own content — without this, the native splash hides
// itself as soon as the root view mounts, exposing a brief flash of the
// app's default white background before the entrance screen's navy
// background and logo render underneath it.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  const { isTablet } = useResponsive();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        registerForPushNotificationsAsync(user.uid);
      }
    });
    return unsub;
  }, []);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <View style={styles.outer}>
      <View style={[styles.inner, isTablet && styles.innerTablet]}>
        <Stack screenOptions={{ headerShown: false, animation: "fade", animationDuration: 200 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // On tablets/large screens, the whole navigator is letterboxed to a
  // phone-reading-width column instead of every screen's rows and cards
  // stretching edge-to-edge, with no per-screen changes needed. Native
  // <Modal> content renders outside this tree (its own window) and isn't
  // affected — it still spans the full device width.
  outer: {
    flex: 1,
    backgroundColor: colors.ink,
  },
  inner: {
    flex: 1,
    width: "100%",
    alignSelf: "center",
  },
  innerTablet: {
    maxWidth: MAX_CONTENT_WIDTH,
  },
});
