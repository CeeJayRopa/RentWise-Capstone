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
import { useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  signOut,
} from "firebase/auth";

import { auth } from "../shared/firebaseConfig";
import { getTenantData } from "../services/tenantService";

const MAX_ATTEMPTS = 5;

export default function QuickUnlock() {
  const [tenantName, setTenantName] = useState("");
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
    getTenantData(user.uid)
      .then((data) => {
        setTenantName(data?.firstName ? `${data.firstName} ${data.lastName ?? ""}`.trim() : "Tenant");
      })
      .catch(() => setTenantName("Tenant"))
      .finally(() => setCheckingSession(false));
  }, []);

  async function forceFullLogout(message: string) {
    await signOut(auth).catch(() => {});
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
      // create a new one) — the tenant stays signed in the whole time,
      // this just gates local access to the app content.
      await reauthenticateWithCredential(
        user,
        EmailAuthProvider.credential(user.email, password),
      );
      attemptsRef.current = 0;
      router.replace("/dashboard");
    } catch (err: any) {
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
    router.replace("/login");
  }

  if (checkingSession) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0F6E56" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: "#0F6E56" }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.topSection}>
        <View style={styles.avatarCircle}>
          <Ionicons name="person" size={32} color="#0F6E56" />
        </View>
        <Text style={styles.welcomeBack}>Welcome back</Text>
        <Text style={styles.tenantName}>{tenantName}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>Enter your password to continue</Text>

        <Text style={styles.fieldLabel}>Password</Text>
        <View style={[styles.inputWrapper, !!error && styles.inputWrapperError]}>
          <Ionicons name="lock-closed-outline" size={17} color="#1D9E75" style={styles.leftIcon} />
          <TextInput
            style={styles.textInput}
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              setError("");
            }}
            secureTextEntry={!showPassword}
            placeholder="Enter your password"
            placeholderTextColor="#B4B2A9"
            editable={!unlocking}
            autoFocus
          />
          <Pressable style={styles.rightIcon} onPress={() => setShowPassword((v) => !v)}>
            <Ionicons name={showPassword ? "eye-outline" : "eye-off-outline"} size={17} color="#B4B2A9" />
          </Pressable>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Pressable
          style={({ pressed }) => [
            styles.unlockBtn,
            unlocking && styles.unlockBtnDisabled,
            pressed && !unlocking && { backgroundColor: "#085041" },
          ]}
          onPress={handleUnlock}
          disabled={unlocking}
        >
          {unlocking ? (
            <ActivityIndicator color="#fff" />
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
    backgroundColor: "#0F6E56",
  },
  topSection: {
    alignItems: "center",
    paddingTop: 80,
    paddingBottom: 32,
  },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#E1F5EE",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  welcomeBack: {
    color: "#9FE1CB",
    fontSize: 13,
  },
  tenantName: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "500",
    marginTop: 2,
  },
  card: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 28,
    paddingTop: 32,
  },
  heading: {
    fontSize: 16,
    fontWeight: "500",
    color: "#085041",
    marginBottom: 20,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: "#444441",
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#9FE1CB",
    borderRadius: 10,
    backgroundColor: "#f7fdf9",
    paddingHorizontal: 12,
  },
  inputWrapperError: {
    borderColor: "#E24B4A",
  },
  leftIcon: { marginRight: 8 },
  rightIcon: { padding: 4 },
  textInput: {
    flex: 1,
    paddingVertical: 13,
    fontSize: 15,
    color: "#085041",
  },
  errorText: {
    color: "#E24B4A",
    fontSize: 12,
    marginTop: 8,
  },
  unlockBtn: {
    backgroundColor: "#0F6E56",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
    minHeight: 50,
  },
  unlockBtnDisabled: {
    opacity: 0.6,
  },
  unlockBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  signOutLink: {
    alignItems: "center",
    marginTop: 18,
    paddingVertical: 8,
  },
  signOutLinkText: {
    color: "#888780",
    fontSize: 13,
    fontWeight: "500",
  },
});
