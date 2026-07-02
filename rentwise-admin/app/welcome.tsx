import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Pressable,
  ActivityIndicator,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { ShieldCheck } from "lucide-react-native";

import { auth } from "../shared/services/auth";

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [displayName, setDisplayName] = useState("Admin");
  const [photoURL, setPhotoURL] = useState<string | null>(null);

  const pulseScale = useRef(new Animated.Value(1.0)).current;
  const pulseOpacity = useRef(new Animated.Value(0.4)).current;

  const avatarAnim = useRef(new Animated.Value(0)).current;
  const appNameAnim = useRef(new Animated.Value(0)).current;
  const welcomeAnim = useRef(new Animated.Value(0)).current;
  const buttonAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace("/");
        return;
      }
      setDisplayName(user.displayName ?? "Admin");
      setPhotoURL(user.photoURL ?? null);
      setChecking(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (checking) return;

    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulseScale, { toValue: 1.14, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseOpacity, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(pulseScale, { toValue: 1.0, duration: 0, useNativeDriver: true }),
          Animated.timing(pulseOpacity, { toValue: 0.4, duration: 0, useNativeDriver: true }),
        ]),
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
      entrance(avatarAnim),
      entrance(appNameAnim),
      entrance(welcomeAnim),
      entrance(buttonAnim),
    ]).start();
  }, [checking]);

  const slideIn = (anim: Animated.Value) => ({
    opacity: anim,
    transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
  });

  if (checking) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#E6F1FB" size="large" />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 },
      ]}
    >
      {/* Avatar */}
      <Animated.View style={[styles.avatarWrapper, slideIn(avatarAnim)]}>
        <Animated.View
          style={[
            styles.pulseRing,
            { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
          ]}
        />
        {photoURL ? (
          <Image source={{ uri: photoURL }} style={styles.avatarCircle} />
        ) : (
          <View style={styles.avatarCircle}>
            <ShieldCheck size={36} color="#0C2D6B" />
          </View>
        )}
      </Animated.View>

      {/* App name */}
      <Animated.Text style={[styles.appName, slideIn(appNameAnim)]}>
        RentWise
      </Animated.Text>

      {/* Welcome text */}
      <Animated.Text style={[styles.welcomeText, slideIn(welcomeAnim)]}>
        Welcome, {displayName}!
      </Animated.Text>

      {/* Continue button */}
      <Animated.View style={[styles.buttonWrapper, slideIn(buttonAnim)]}>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            pressed && { backgroundColor: "#E6F1FB", transform: [{ scale: 0.97 }] },
          ]}
          onPress={() => router.replace("/dashboard")}
        >
          <Text style={styles.buttonText}>Continue</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0C2D6B",
  },

  container: {
    flex: 1,
    backgroundColor: "#0C2D6B",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },

  avatarWrapper: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },

  pulseRing: {
    position: "absolute",
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "#7AAEF0",
  },

  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#E6F1FB",
    alignItems: "center",
    justifyContent: "center",
  },

  appName: {
    fontSize: 26,
    fontWeight: "500",
    color: "#E6F1FB",
    textAlign: "center",
    marginBottom: 4,
  },

  welcomeText: {
    fontSize: 20,
    fontWeight: "500",
    color: "#fff",
    textAlign: "center",
    marginBottom: 48,
  },

  buttonWrapper: {
    width: "72%",
  },

  button: {
    width: "100%",
    borderRadius: 14,
    backgroundColor: "#fff",
    paddingVertical: 15,
    alignItems: "center",
  },

  buttonText: {
    color: "#0C2D6B",
    fontSize: 16,
    fontWeight: "500",
    textAlign: "center",
  },
});
