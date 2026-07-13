import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import { Building2, Lock, Eye, EyeOff } from "lucide-react-native";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  signOut,
} from "firebase/auth";

import { auth } from "../shared/services/auth";
import { getUserById } from "../shared/services/userServices";
import { setRememberMe } from "../shared/services/rememberMe";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../shared/theme";

const MAX_ATTEMPTS = 5;

export default function QuickUnlock() {
  const [ownerName, setOwnerName] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const attemptsRef = useRef(0);

  useEffect(() => {
    const user = auth.currentUser;
    // No active session (e.g. someone deep-linked here directly) — this
    // screen has nothing to unlock, fall back to the real login.
    if (!user) {
      router.replace("/login");
      return;
    }
    getUserById(user.uid)
      .then((data) => {
        setOwnerName(data?.firstName ? `${data.firstName} ${data.lastName ?? ""}`.trim() : "Owner");
      })
      .catch(() => setOwnerName("Owner"))
      .finally(() => setCheckingSession(false));
  }, []);

  async function forceFullLogout(message: string) {
    await signOut(auth).catch(() => {});
    await setRememberMe(false);
    Alert.alert("Signed out", message, [
      { text: "OK", onPress: () => router.replace("/login") },
    ]);
  }

  async function handleUnlock() {
    const user = auth.currentUser;
    if (!user || !user.email) {
      router.replace("/login");
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }
    setUnlocking(true);
    setError("");
    try {
      // Re-verifies the password against the CURRENT session (doesn't
      // create a new one) — the owner stays signed in the whole time,
      // this just gates local access to the app content.
      await reauthenticateWithCredential(
        user,
        EmailAuthProvider.credential(user.email, password),
      );
      attemptsRef.current = 0;
      router.replace("/welcome");
    } catch {
      attemptsRef.current += 1;
      if (attemptsRef.current >= MAX_ATTEMPTS) {
        await forceFullLogout(
          "Too many incorrect attempts. Please sign in again with your username and password.",
        );
        return;
      }
      const remaining = MAX_ATTEMPTS - attemptsRef.current;
      setError(`Incorrect password. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`);
      setPassword("");
    } finally {
      setUnlocking(false);
    }
  }

  async function handleSignOut() {
    await signOut(auth).catch(() => {});
    await setRememberMe(false);
    router.replace("/login");
  }

  if (checkingSession) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.emerald} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.emerald }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <LinearGradient
        colors={[colors.emerald, colors.ink]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.topSection}
      >
        <View style={styles.avatarCircle}>
          <Building2 size={30} color={colors.emerald} />
        </View>
        <Text style={styles.welcomeBack}>Welcome back</Text>
        <Text style={styles.ownerName}>{ownerName}</Text>
      </LinearGradient>

      <View style={styles.card}>
        <Text style={styles.heading}>Enter your password to continue</Text>

        <Text style={styles.fieldLabel}>Password</Text>
        <View style={[styles.inputWrapper, !!error && styles.inputWrapperError]}>
          <Lock size={17} color={colors.emeraldBright} style={styles.leftIcon} />
          <TextInput
            style={styles.textInput}
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              setError("");
            }}
            secureTextEntry={!showPassword}
            placeholder="Enter your password"
            placeholderTextColor={colors.textMuted}
            editable={!unlocking}
            autoFocus
          />
          <Pressable style={styles.rightIcon} onPress={() => setShowPassword((v) => !v)}>
            {showPassword ? (
              <Eye size={17} color={colors.textMuted} />
            ) : (
              <EyeOff size={17} color={colors.textMuted} />
            )}
          </Pressable>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Pressable
          style={({ pressed }) => [
            styles.unlockBtn,
            unlocking && styles.unlockBtnDisabled,
            pressed && !unlocking && { backgroundColor: colors.ink },
          ]}
          onPress={handleUnlock}
          disabled={unlocking}
        >
          {unlocking ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.unlockBtnText}>Unlock</Text>
          )}
        </Pressable>

        <Pressable style={styles.signOutLink} onPress={handleSignOut}>
          <Text style={styles.signOutLinkText}>Not you? Sign out</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.emerald,
  },
  topSection: {
    alignItems: "center",
    paddingTop: 80,
    paddingBottom: spacing.xxxl,
  },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.parchment,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  welcomeBack: {
    color: colors.emeraldSoft,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
  },
  ownerName: {
    color: colors.white,
    fontSize: fontSize.xxl,
    fontFamily: fontFamily.bold,
    marginTop: 2,
  },
  card: {
    flex: 1,
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -24,
    paddingHorizontal: spacing.xxl + 4,
    paddingTop: spacing.xxxl,
  },
  heading: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
    marginBottom: spacing.xl,
  },
  fieldLabel: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: colors.emeraldSoft,
    borderRadius: radius.sm,
    backgroundColor: colors.mist,
    paddingHorizontal: spacing.md,
  },
  inputWrapperError: {
    borderColor: colors.error,
  },
  leftIcon: { marginRight: spacing.sm },
  rightIcon: { padding: 4 },
  textInput: {
    flex: 1,
    paddingVertical: 13,
    fontSize: fontSize.base,
    fontFamily: fontFamily.medium,
    color: colors.ink,
  },
  errorText: {
    color: colors.error,
    fontSize: fontSize.xs + 1,
    fontFamily: fontFamily.medium,
    marginTop: spacing.sm,
  },
  unlockBtn: {
    backgroundColor: colors.emerald,
    borderRadius: radius.sm,
    paddingVertical: spacing.md + 2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xxl,
    minHeight: 50,
    ...shadow.button,
  },
  unlockBtnDisabled: {
    opacity: 0.6,
  },
  unlockBtnText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
  },
  signOutLink: {
    alignItems: "center",
    marginTop: spacing.lg + 2,
    paddingVertical: spacing.sm,
  },
  signOutLinkText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
  },
});
