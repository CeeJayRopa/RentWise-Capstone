import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRef, useEffect } from "react";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { auth } from "../shared/firebaseConfig";

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const displayName = auth.currentUser?.displayName ?? "Tenant";

  const pulseScale = useRef(new Animated.Value(1.0)).current;
  const pulseOpacity = useRef(new Animated.Value(0.4)).current;

  const appNameAnim = useRef(new Animated.Value(0)).current;
  const avatarAnim = useRef(new Animated.Value(0)).current;
  const welcomeAnim = useRef(new Animated.Value(0)).current;
  const subtextAnim = useRef(new Animated.Value(0)).current;
  const buttonAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.parallel([
        Animated.timing(pulseScale, {
          toValue: 1.14,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseOpacity, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    const entrance = (anim: Animated.Value) =>
      Animated.timing(anim, {
        toValue: 1,
        duration: 520,
        easing: Easing.out(Easing.back(1.2)),
        useNativeDriver: true,
      });

    Animated.stagger(140, [
      entrance(appNameAnim),
      entrance(avatarAnim),
      entrance(welcomeAnim),
      entrance(subtextAnim),
      entrance(buttonAnim),
    ]).start();
  }, []);

  const slideIn = (anim: Animated.Value) => ({
    opacity: anim,
    transform: [
      {
        translateY: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [20, 0],
        }),
      },
    ],
  });

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <Animated.Text style={[styles.brand, slideIn(appNameAnim)]}>
        RentWise
      </Animated.Text>

      <Animated.View style={[styles.avatarWrapper, slideIn(avatarAnim)]}>
        <Animated.View
          style={[
            styles.pulseRing,
            { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
          ]}
        />
        <View style={styles.outerRing}>
          <View style={styles.innerCircle}>
            <Ionicons name="person-outline" size={44} color="#0F6E56" />
          </View>
        </View>
      </Animated.View>

      <Animated.Text style={[styles.welcome, slideIn(welcomeAnim)]}>
        Welcome, {displayName}!
      </Animated.Text>

      <Animated.Text style={[styles.subtext, slideIn(subtextAnim)]}>
        Ka Domeng Talipapa
      </Animated.Text>

      <Animated.View style={[styles.buttonWrapper, slideIn(buttonAnim)]}>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            pressed && { backgroundColor: "#E1F5EE", transform: [{ scale: 0.97 }] },
          ]}
          onPress={() => router.push("/dashboard")}
        >
          <Text style={styles.buttonText}>Continue</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F6E56",
    alignItems: "center",
    justifyContent: "center",
  },
  brand: {
    color: "#E1F5EE",
    fontSize: 28,
    fontWeight: "500",
    letterSpacing: -0.5,
    marginBottom: 40,
  },
  avatarWrapper: {
    alignItems: "center",
    justifyContent: "center",
  },
  pulseRing: {
    position: "absolute",
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "#5DCAA5",
  },
  outerRing: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "#1D9E75",
    alignItems: "center",
    justifyContent: "center",
  },
  innerCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#E1F5EE",
    alignItems: "center",
    justifyContent: "center",
  },
  welcome: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "500",
    textAlign: "center",
    marginTop: 32,
  },
  subtext: {
    color: "#9FE1CB",
    fontSize: 14,
    marginTop: 4,
    textAlign: "center",
  },
  buttonWrapper: {
    marginTop: 40,
    width: "72%",
  },
  button: {
    borderRadius: 14,
    backgroundColor: "#fff",
    paddingVertical: 15,
    alignItems: "center",
    width: "100%",
  },
  buttonText: {
    color: "#0F6E56",
    fontSize: 16,
    fontWeight: "500",
    textAlign: "center",
  },
});
