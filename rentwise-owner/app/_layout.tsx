import { useEffect, useRef } from "react";
import { Alert, BackHandler, View, StyleSheet, Platform, ToastAndroid } from "react-native";
import { Stack, router, usePathname } from "expo-router";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import * as SplashScreen from "expo-splash-screen";
import * as NavigationBar from "expo-navigation-bar";
import {
  useFonts,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from "@expo-google-fonts/plus-jakarta-sans";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import {
  configurePushNotifications,
  registerForPushNotificationsAsync,
} from "../shared/services/pushNotifications";
import { useResponsive, MAX_CONTENT_WIDTH } from "../shared/hooks/useResponsive";
import { colors } from "../shared/theme";
import { clearLocalCache, initializeLocalCache } from "../shared/services/localCache";
import NetworkStatusBanner from "../shared/components/NetworkStatusBanner";
import { setRememberMe } from "../shared/services/rememberMe";

configurePushNotifications();

// Keeps the native (navy) splash on screen until the JS entrance screen has
// actually painted its own content — without this, the native splash hides
// itself as soon as the root view mounts, exposing a brief flash of the
// app's default white background before the entrance screen's navy
// background and logo render underneath it.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const pathname = usePathname();
  const lastDashboardBack = useRef(0);
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  useEffect(() => {
    initializeLocalCache().catch((error) => console.warn("LOCAL CACHE INIT WARNING:", error));
  }, []);

  const { isTablet } = useResponsive();

  useEffect(() => {
    // Dark icons/pill so the system nav bar stays visible against this
    // app's light backgrounds (matches the app.json config-plugin default,
    // but the config plugin only bakes into a fresh native build — this
    // runtime call is what actually applies it in Expo Go/dev builds).
    if (Platform.OS === "android") {
      try {
        NavigationBar.setStyle("dark");
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;

    lastDashboardBack.current = 0;
    const publicOrLockedRoute = ["/", "/login", "/welcome", "/quick-unlock", "/owner-forgot-password"].includes(pathname);
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!auth.currentUser || publicOrLockedRoute) return false;

      if (pathname !== "/dashboard") {
        router.replace("/(tabs)/dashboard");
        return true;
      }

      const now = Date.now();
      if (now - lastDashboardBack.current <= 2000) {
        BackHandler.exitApp();
        return true;
      }

      lastDashboardBack.current = now;
      ToastAndroid.show("Press back again to exit", ToastAndroid.SHORT);
      return true;
    });

    return () => subscription.remove();
  }, [pathname]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        await registerForPushNotificationsAsync(user.uid);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      unsubscribeProfile?.();
      unsubscribeProfile = undefined;
      if (!user) return;

      const token = await user.getIdTokenResult();
      const authenticatedAt = new Date(token.authTime).getTime();
      let endingSession = false;
      unsubscribeProfile = onSnapshot(
        doc(db, "users", user.uid),
        async (snapshot) => {
          if (endingSession) return;
          const data = snapshot.data();
          const invalidOwner = !snapshot.exists() || data?.role !== "owner" || (data?.status && data.status !== "active");
          const revokedAt = data?.sessionRevokedAt?.toMillis?.() ?? 0;
          if (!invalidOwner && revokedAt <= authenticatedAt) return;

          endingSession = true;
          await setRememberMe(false).catch(() => {});
          await clearLocalCache().catch(() => {});
          await signOut(auth).catch(() => {});
          Alert.alert(
            invalidOwner ? "Account Unavailable" : "Session Ended",
            invalidOwner
              ? "This account no longer has active owner access."
              : "Your password was changed. Please sign in again with your new password.",
          );
          router.replace("/login");
        },
        (error) => {
          if (!auth.currentUser) return;
          console.error("OWNER SESSION LISTENER ERROR:", error);
        },
      );
    });

    return () => {
      unsubscribeProfile?.();
      unsubscribeAuth();
    };
  }, []);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <View style={styles.outer}>
      <View style={[styles.inner, isTablet && styles.innerTablet]}>
        <Stack screenOptions={{ headerShown: false, animation: "fade", animationDuration: 200 }} />
        <NetworkStatusBanner />
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
