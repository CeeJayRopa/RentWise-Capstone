import { useEffect, useRef, useCallback } from "react";
import { Image, Animated, Easing, StyleSheet, StatusBar } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import * as SplashScreen from "expo-splash-screen";
import { auth } from "../shared/firebaseConfig";
import { getRememberMe } from "../shared/services/rememberMe";
import { colors } from "../shared/theme";

export default function EntranceScreen() {
  const pulseScale = useRef(new Animated.Value(0.92)).current;
  const pulseOpacity = useRef(new Animated.Value(0.6)).current;
  const logoAnim = useRef(new Animated.Value(0)).current;

  // Only once this screen's own green background has actually been laid out
  // and painted do we dismiss the native splash — so the swap from native
  // splash to JS screen is green-to-green, with no white gap in between.
  const onRootLayout = useCallback(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulseScale, {
            toValue: 1.08,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseOpacity, {
            toValue: 0.15,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(pulseScale, {
            toValue: 0.92,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseOpacity, {
            toValue: 0.6,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ]),
    ).start();

    Animated.timing(logoAnim, {
      toValue: 1,
      duration: 560,
      easing: Easing.out(Easing.back(1.4)),
      useNativeDriver: true,
    }).start();

    // Firebase persists the last signed-in session across app restarts, but
    // resolves it asynchronously — capture whatever it resolves to (or
    // hasn't, yet) by the time the entrance animation finishes, then route:
    // an existing session goes to the quick password-only unlock screen
    // instead of the full username+password login.
    let hasSession = false;
    const unsub = onAuthStateChanged(auth, (user) => {
      hasSession = !!user;
    });

    const timer = setTimeout(async () => {
      unsub();
      if (!hasSession) {
        router.replace("/login");
        return;
      }
      // "Remember me" (opt-in at login) skips even the password-only
      // quick-unlock screen — straight to the dashboard on this device.
      const remembered = await getRememberMe();
      router.replace(remembered ? "/dashboard" : "/quick-unlock");
    }, 1900);

    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, []);

  return (
    <LinearGradient
      colors={[colors.emerald, colors.ink]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.root}
      onLayout={onRootLayout}
    >
      <StatusBar barStyle="light-content" backgroundColor={colors.emerald} />

      <Animated.View
        style={[
          styles.logoGroup,
          {
            opacity: logoAnim,
            transform: [
              {
                scale: logoAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.5, 1],
                }),
              },
            ],
          },
        ]}
      >
        <Animated.View
          style={[
            styles.pulseRing,
            { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
          ]}
        />
        <LinearGradient
          colors={[colors.emerald, colors.ink]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.logoCircle}
        >
          <Image
            source={require("../assets/rentwise-icon.png")}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </LinearGradient>
      </Animated.View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.emerald,
    alignItems: "center",
    justifyContent: "center",
  },
  logoGroup: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  pulseRing: {
    position: "absolute",
    width: 116,
    height: 116,
    borderRadius: 999,
    backgroundColor: colors.emeraldBright,
  },
  logoCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  logoImage: {
    width: 88,
    height: 88,
  },
});
