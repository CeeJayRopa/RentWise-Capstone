import {
  View,
  Image,
  StyleSheet,
  Animated,
  Easing,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRef, useEffect, useState } from "react";
import { router } from "expo-router";
import { User } from "lucide-react-native";
import { auth } from "../shared/firebaseConfig";
import { getTenantData } from "../services/tenantService";
import { colors, fontFamily, fontSize, spacing } from "../shared/theme";

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const [displayName, setDisplayName] = useState("Tenant");
  const [photoURL, setPhotoURL] = useState<string | null>(null);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;
    setPhotoURL(user.photoURL ?? null);
    getTenantData(user.uid)
      .then((data) => {
        if (data?.firstName) setDisplayName(data.firstName);
      })
      .catch(() => {});
  }, []);

  const pulseScale = useRef(new Animated.Value(1.0)).current;
  const pulseOpacity = useRef(new Animated.Value(0.4)).current;

  const avatarAnim = useRef(new Animated.Value(0)).current;
  const welcomeAnim = useRef(new Animated.Value(0)).current;

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
      entrance(avatarAnim),
      entrance(welcomeAnim),
    ]).start();

    // Auto-advances instead of waiting for a tap — this screen is just a
    // brief greeting, not a step that needs confirmation.
    const timer = setTimeout(() => router.replace("/dashboard"), 4000);
    return () => clearTimeout(timer);
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
    <LinearGradient
      colors={[colors.emerald, colors.ink]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <Animated.View style={[styles.avatarWrapper, slideIn(avatarAnim)]}>
        <Animated.View
          style={[
            styles.pulseRing,
            { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
          ]}
        />
        {photoURL ? (
          <Image source={{ uri: photoURL }} style={styles.avatarCircle} resizeMode="cover" />
        ) : (
          <View style={styles.avatarCircle}>
            <User size={32} color={colors.emerald} />
          </View>
        )}
      </Animated.View>

      <Animated.Text style={[styles.welcome, slideIn(welcomeAnim)]}>
        Welcome, {displayName}!
      </Animated.Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
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
  welcome: {
    color: colors.white,
    fontSize: fontSize.xxl,
    fontFamily: fontFamily.bold,
    textAlign: "center",
  },
});
