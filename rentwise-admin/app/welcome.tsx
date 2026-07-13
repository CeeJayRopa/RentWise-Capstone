import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  ActivityIndicator,
  Image,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { ShieldCheck } from "lucide-react-native";

import { auth } from "../shared/services/auth";
import { getUserById } from "../shared/services/userServices";
import { colors, fontFamily, fontSize, spacing } from "../shared/theme";

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [displayName, setDisplayName] = useState("Admin");
  const [photoURL, setPhotoURL] = useState<string | null>(null);

  const pulseScale = useRef(new Animated.Value(1.0)).current;
  const pulseOpacity = useRef(new Animated.Value(0.4)).current;

  const avatarAnim = useRef(new Animated.Value(0)).current;
  const welcomeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/");
        return;
      }
      setPhotoURL(user.photoURL ?? null);
      try {
        const data = await getUserById(user.uid);
        setDisplayName(data?.firstName ?? "Admin");
      } catch {
        setDisplayName("Admin");
      }
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
      entrance(welcomeAnim),
    ]).start();

    // Auto-advances instead of waiting for a tap — this screen is just a
    // brief greeting, not a step that needs confirmation.
    const timer = setTimeout(() => router.replace("/dashboard"), 2000);
    return () => clearTimeout(timer);
  }, [checking]);

  const slideIn = (anim: Animated.Value) => ({
    opacity: anim,
    transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
  });

  if (checking) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.emeraldSoft} size="large" />
      </View>
    );
  }

  return (
    <LinearGradient
      colors={[colors.emerald, colors.ink]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
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
            <ShieldCheck size={32} color={colors.emerald} />
          </View>
        )}
      </Animated.View>

      {/* Welcome text */}
      <Animated.Text style={[styles.welcomeText, slideIn(welcomeAnim)]}>
        Welcome, {displayName}!
      </Animated.Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.emerald,
  },

  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.xxl,
  },

  avatarWrapper: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xxl,
  },

  pulseRing: {
    position: "absolute",
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.emeraldBright,
  },

  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.parchment,
    alignItems: "center",
    justifyContent: "center",
  },

  welcomeText: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.bold,
    color: colors.white,
    textAlign: "center",
    marginBottom: spacing.xxxl + 16,
  },
});
