import { useEffect, useRef, useCallback } from "react";
import { View, Text, Animated, Easing, StyleSheet, StatusBar } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { onAuthStateChanged } from "firebase/auth";
import * as SplashScreen from "expo-splash-screen";

import { auth } from "../shared/services/auth";

export default function EntranceScreen() {
  const pulseScale = useRef(new Animated.Value(0.92)).current;
  const pulseOpacity = useRef(new Animated.Value(0.6)).current;
  const logoAnim = useRef(new Animated.Value(0)).current;
  const textAnim = useRef(new Animated.Value(0)).current;

  // Only once this screen's own navy background has actually been laid out
  // and painted do we dismiss the native splash — so the swap from native
  // splash to JS screen is navy-to-navy, with no white gap in between.
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

    Animated.sequence([
      Animated.timing(logoAnim, {
        toValue: 1,
        duration: 560,
        easing: Easing.out(Easing.back(1.4)),
        useNativeDriver: true,
      }),
      Animated.timing(textAnim, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    // Firebase persists the last signed-in session across app restarts, but
    // resolves it asynchronously — capture whatever it resolves to (or
    // hasn't, yet) by the time the entrance animation finishes, then route:
    // an existing session goes to the quick password-only unlock screen
    // instead of the full username+password login.
    let hasSession = false;
    const unsub = onAuthStateChanged(auth, (user) => {
      hasSession = !!user;
    });

    const timer = setTimeout(() => {
      unsub();
      router.replace(hasSession ? "/quick-unlock" : "/login");
    }, 1900);

    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, []);

  return (
    <View style={styles.root} onLayout={onRootLayout}>
      <StatusBar barStyle="light-content" backgroundColor="#0C2D6B" />

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
        <View style={styles.logoCircle}>
          <Ionicons name="business-outline" size={40} color="#0C2D6B" />
        </View>
      </Animated.View>

      <Animated.View
        style={{
          opacity: textAnim,
          transform: [
            {
              translateY: textAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [12, 0],
              }),
            },
          ],
        }}
      >
        <Text style={styles.appName}>RentWise</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0C2D6B",
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
    backgroundColor: "#7AAEF0",
  },
  logoCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "#E6F1FB",
    alignItems: "center",
    justifyContent: "center",
  },
  appName: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "500",
    textAlign: "center",
  },
});
