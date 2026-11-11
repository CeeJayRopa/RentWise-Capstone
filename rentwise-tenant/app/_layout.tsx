import { useEffect, useRef, useState } from "react";
import { Stack, router, usePathname } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { Alert, BackHandler, Modal, Platform, Pressable, StyleSheet, Text, ToastAndroid, View } from "react-native";
import { KeyRound, UserRoundX } from "lucide-react-native";
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
import { colors, fontFamily, fontSize, radius, shadow, spacing } from "../shared/theme";
import { clearLocalCache, initializeLocalCache } from "../shared/services/localCache";
import NetworkStatusBanner from "../shared/components/NetworkStatusBanner";
import { setRememberMe } from "../shared/services/rememberMe";

configurePushNotifications();

// Keeps the native (green) splash on screen until the JS entrance screen has
// actually painted its own content — without this, the native splash hides
// itself as soon as the root view mounts, exposing a brief flash of the
// app's default white background before the entrance screen's green
// background and logo render underneath it.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const lastDashboardBack = useRef(0);
  const [accountUnavailableVisible, setAccountUnavailableVisible] = useState(false);
  const [sessionEndedVisible, setSessionEndedVisible] = useState(false);
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

  useEffect(() => {
    pathnameRef.current = pathname;
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
    let authGeneration = 0;
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      const generation = ++authGeneration;
      unsubscribeProfile?.();
      unsubscribeProfile = undefined;
      if (!user) return;

      const watchedUid = user.uid;
      const token = await user.getIdTokenResult().catch((error) => {
        console.error("TENANT SESSION TOKEN ERROR:", error);
        return null;
      });
      // A newer auth event may have fired while the token request was
      // pending. Never attach a profile listener for that stale user.
      if (!token || generation !== authGeneration || auth.currentUser?.uid !== watchedUid) return;

      const authenticatedAt = new Date(token.authTime).getTime();
      let endingSession = false;
      const isCurrentSession = () =>
        generation === authGeneration && auth.currentUser?.uid === watchedUid;
      const profileUnsubscribe = onSnapshot(doc(db, "users", watchedUid), async (snapshot) => {
        if (endingSession || !isCurrentSession()) return;

        if (!snapshot.exists()) {
          // On a cold start Firestore can emit an empty cache snapshot before
          // it has checked the server. That is not proof that the account was
          // deleted, so wait for the server-backed snapshot.
          if (snapshot.metadata.fromCache) return;

          endingSession = true;
          const publicOrLockedRoute = [
            "/",
            "/login",
            "/welcome",
            "/quick-unlock",
            "/reset-sending",
            "/reset-otp",
            "/reset-password",
          ].includes(pathnameRef.current);
          await setRememberMe(false).catch(() => {});
          if (!isCurrentSession()) return;
          await clearLocalCache().catch(() => {});
          if (!isCurrentSession()) return;
          await signOut(auth).catch(() => {});
          // A stale persisted Firebase session discovered during startup is
          // cleaned up silently. Only interrupt a tenant who was already in
          // the authenticated area when their account disappeared.
          if (!publicOrLockedRoute) {
            setAccountUnavailableVisible(true);
          }
          router.replace("/login");
          return;
        }

        const profile = snapshot.data();
        if (profile.mustChangePassword === true && pathnameRef.current !== "/reset-password") {
          router.replace({pathname: "/reset-password", params: {temporaryRecovery: "1"}});
          return;
        }
        const status = profile.status;
        if (status && status !== "active") {
          endingSession = true;
          await setRememberMe(false).catch(() => {});
          if (!isCurrentSession()) return;
          await clearLocalCache().catch(() => {});
          if (!isCurrentSession()) return;
          await signOut(auth).catch(() => {});
          Alert.alert(
            "Account Archived",
            "This account has been archived. Please contact the admin if this is unexpected.",
          );
          router.replace("/login");
          return;
        }

        const revokedAt = snapshot.data()?.sessionRevokedAt?.toMillis?.() ?? 0;
        if (revokedAt > authenticatedAt) {
          // Temporary recovery deliberately revokes all old sessions while
          // this route exchanges the temporary login for a fresh custom-token
          // session. Let that screen finish the exchange without presenting
          // the normal stale-session alert or racing it back to login.
          if (pathnameRef.current === "/reset-password") return;
          endingSession = true;
          await setRememberMe(false).catch(() => {});
          if (!isCurrentSession()) return;
          await clearLocalCache().catch(() => {});
          if (!isCurrentSession()) return;
          await signOut(auth).catch(() => {});
          setSessionEndedVisible(true);
          router.replace("/login");
        }
      }, (error) => {
        if (!isCurrentSession()) return;
        console.error("TENANT SESSION LISTENER ERROR:", error);
      });
      // onSnapshot can begin synchronously. Re-check before publishing its
      // unsubscribe handle in case auth changed during listener creation.
      if (!isCurrentSession()) {
        profileUnsubscribe();
        return;
      }
      unsubscribeProfile = profileUnsubscribe;
    });

    return () => {
      authGeneration += 1;
      unsubscribeProfile?.();
      unsubscribeAuth();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;

    lastDashboardBack.current = 0;
    const publicOrLockedRoute = [
      "/",
      "/login",
      "/welcome",
      "/quick-unlock",
      "/reset-sending",
      "/reset-otp",
      "/reset-password",
    ].includes(pathname);
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

  const { isTablet } = useResponsive();

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <View style={styles.outer}>
        <View style={[styles.inner, isTablet && styles.innerTablet]}>
          <Stack screenOptions={{ headerShown: false, animation: "fade", animationDuration: 200 }} />
          <NetworkStatusBanner />
        </View>
      </View>
      <Modal
        visible={accountUnavailableVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setAccountUnavailableVisible(false)}
      >
        <View style={styles.accountModalBackdrop}>
          <View
            style={styles.accountModalCard}
            accessibilityViewIsModal
            accessibilityRole="alert"
          >
            <View style={styles.accountModalIconWrap}>
              <UserRoundX size={30} strokeWidth={2} color={colors.error} />
            </View>
            <Text style={styles.accountModalEyebrow}>ACCOUNT ACCESS</Text>
            <Text style={styles.accountModalTitle}>We couldn't verify your account</Text>
            <Text style={styles.accountModalMessage}>
              Your session has ended, but your rental records were not changed. Sign in again to refresh your account.
            </Text>
            <View style={styles.accountModalNotice}>
              <Text style={styles.accountModalNoticeText}>
                If this continues, ask your market administrator to check your tenant account.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Return to sign in"
              onPress={() => setAccountUnavailableVisible(false)}
              style={({ pressed }) => [
                styles.accountModalButton,
                pressed && styles.accountModalButtonPressed,
              ]}
            >
              <Text style={styles.accountModalButtonText}>Return to sign in</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        visible={sessionEndedVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setSessionEndedVisible(false)}
      >
        <View style={styles.accountModalBackdrop}>
          <View style={styles.accountModalCard} accessibilityViewIsModal accessibilityRole="alert">
            <View style={styles.sessionModalIconWrap}>
              <KeyRound size={30} strokeWidth={2} color={colors.emerald} />
            </View>
            <Text style={styles.sessionModalEyebrow}>ACCOUNT SECURITY</Text>
            <Text style={styles.accountModalTitle}>Your session has ended</Text>
            <Text style={styles.accountModalMessage}>
              Your password was changed, so we signed out this device to keep your account secure.
            </Text>
            <View style={styles.accountModalNotice}>
              <Text style={styles.accountModalNoticeText}>
                Sign in again using your username and new password.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Continue to sign in"
              onPress={() => setSessionEndedVisible(false)}
              style={({pressed}) => [styles.accountModalButton, pressed && styles.accountModalButtonPressed]}
            >
              <Text style={styles.accountModalButtonText}>Continue to sign in</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  accountModalBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    backgroundColor: "rgba(4, 25, 21, 0.66)",
  },
  accountModalCard: {
    width: "100%",
    maxWidth: 390,
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: colors.white,
    ...shadow.raised,
  },
  accountModalIconWrap: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 32,
    backgroundColor: colors.errorSoft,
  },
  sessionModalIconWrap: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 32,
    backgroundColor: colors.emeraldSoft,
  },
  sessionModalEyebrow: {
    marginTop: spacing.lg,
    fontSize: fontSize.xs,
    letterSpacing: 1.2,
    fontFamily: fontFamily.bold,
    color: colors.emerald,
  },
  accountModalEyebrow: {
    marginTop: spacing.lg,
    fontSize: fontSize.xs,
    letterSpacing: 1.2,
    fontFamily: fontFamily.bold,
    color: colors.error,
  },
  accountModalTitle: {
    marginTop: spacing.sm,
    textAlign: "center",
    fontSize: fontSize.xl,
    lineHeight: 28,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },
  accountModalMessage: {
    marginTop: spacing.sm,
    textAlign: "center",
    fontSize: fontSize.sm,
    lineHeight: 20,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
  },
  accountModalNotice: {
    width: "100%",
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.mist,
  },
  accountModalNoticeText: {
    textAlign: "center",
    fontSize: fontSize.xs,
    lineHeight: 17,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
  },
  accountModalButton: {
    width: "100%",
    minHeight: 50,
    marginTop: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.emerald,
  },
  accountModalButtonPressed: {
    opacity: 0.86,
  },
  accountModalButtonText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.white,
  },
});
