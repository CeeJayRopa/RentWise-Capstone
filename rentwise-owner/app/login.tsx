import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { useState } from "react";
import { router } from "expo-router";

import { loginUser } from "../shared/services/auth";
import { getUserByUsername } from "../shared/services/userServices";
import { Colors } from "../shared/constants/color";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    setError("");
    if (!username.trim() || !password.trim()) {
      setError("Please enter your username and password.");
      return;
    }
    setLoading(true);
    try {
      // Resolve email: try username lookup first, then treat input as direct email
      let email = username.trim();
      const userDoc = await getUserByUsername(username.trim(), "owner");
      if (userDoc) {
        email = userDoc.email;
      }
      // loginUser will throw if credentials are wrong
      const result = await loginUser(email, password);
      // Verify the signed-in account is actually an owner
      const { getUserRole } = await import("../shared/services/userServices");
      const role = await getUserRole(result.uid);
      if (role !== "owner") {
        const { logoutUser } = await import("../shared/services/auth");
        await logoutUser();
        setError("Access denied. Owner account required.");
        return;
      }
      router.replace("/welcome");
    } catch {
      setError("Invalid username or password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.title}>RentWise Owner</Text>
          <Text style={styles.subtitle}>Sign in to your account</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Username</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your username"
              placeholderTextColor={Colors.textMuted}
              value={username}
              onChangeText={(t) => { setUsername(t); setError(""); }}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your password"
              placeholderTextColor={Colors.textMuted}
              value={password}
              onChangeText={(t) => { setPassword(t); setError(""); }}
              secureTextEntry
              editable={!loading}
            />
          </View>

          {!!error && <Text style={styles.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.buttonText}>Log In</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flexGrow: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  card: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 32,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  title: { fontSize: 26, fontWeight: "700", color: Colors.textPrimary, textAlign: "center", marginBottom: 6 },
  subtitle: { fontSize: 14, color: Colors.textSecondary, textAlign: "center", marginBottom: 32 },
  field: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: "600", color: Colors.textSecondary, marginBottom: 6 },
  input: {
    backgroundColor: Colors.inputBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  errorText: { fontSize: 13, color: Colors.error, textAlign: "center", marginBottom: 12 },
  button: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: { backgroundColor: Colors.disabled },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
});
