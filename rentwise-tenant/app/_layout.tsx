import { useEffect } from "react";
import { Stack, router } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, onSnapshot, updateDoc } from "firebase/firestore";
import { Alert, View, StyleSheet, Platform } from "react-native";
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

import { auth, db } from "../shared/firebaseConfig";
import {
  configurePushNotifications,
  registerForPushNotificationsAsync,
} from "../shared/services/pushNotifications";
import { useResponsive, MAX_CONTENT_WIDTH } from "../shared/hooks/useResponsive";
import { colors } from "../shared/theme";

configurePushNotifications();

// Keeps the native (green) splash on screen until the JS entrance screen has
// actually painted its own content — without this, the native splash hides
// itself as soon as the root view mounts, exposing a brief flash of the
// app's default white background before the entrance screen's green
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

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        registerForPushNotificationsAsync(user.uid);
      }
    });
    return unsub;
  }, []);

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

  useEffect(() => {
    // Firebase Auth's own emailVerified flag doesn't push itself into
    // Firestore -- this notices it flipped (after the tenant clicks the
    // verification link sent at account creation) and syncs it, so the
    // admin app can show a Verified/Unverified badge without needing an
    // Admin SDK call. reload() refetches the latest Auth state; without
    // it, `user.emailVerified` would still reflect whatever it was at the
    // start of this session, even if the tenant verified moments ago.
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      try {
        await user.reload();
        if (!user.emailVerified) return;
        const userRef = doc(db, "users", user.uid);
        const snap = await getDoc(userRef);
        if (snap.exists() && snap.data()?.emailVerified !== true) {
          await updateDoc(userRef, { emailVerified: true });
        }
      } catch {
        // Non-fatal -- the badge just stays "Unverified" a bit longer,
        // corrected on the next app open/auth-state change.
      }
    });
    return unsub;
  }, []);

  const { isTablet } = useResponsive();

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <View style={styles.outer}>
        <View style={[styles.inner, isTablet && styles.innerTablet]}>
          <Stack screenOptions={{ headerShown: false, animation: "fade", animationDuration: 200 }} />
        </View>
      </View>
    </SafeAreaProvider>
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
