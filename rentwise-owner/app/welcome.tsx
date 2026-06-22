import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { router } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";

import { auth } from "../shared/services/auth";
import { Colors } from "../shared/constants/color";

export default function Welcome() {
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace("/");
        return;
      }
      setChecking(false);
    });
    return unsub;
  }, []);

  if (checking) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.avatar}>
          <View style={styles.avatarHead} />
          <View style={styles.avatarBody} />
        </View>
        <Text style={styles.title}>RentWise</Text>
        <Text style={styles.welcome}>Welcome, Owner</Text>
        <Text style={styles.description}>Manage your market operations</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.replace("/dashboard")}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: Colors.background },
  container: { flex: 1, backgroundColor: Colors.background, justifyContent: "center", alignItems: "center", padding: 24 },
  card: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "flex-end",
    overflow: "hidden",
    marginBottom: 24,
  },
  avatarHead: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.surface,
    position: "absolute",
    top: 12,
  },
  avatarBody: {
    width: 56,
    height: 40,
    borderRadius: 28,
    backgroundColor: Colors.surface,
    marginBottom: -10,
  },
  title: { fontSize: 26, fontWeight: "700", color: Colors.textPrimary, marginBottom: 8 },
  welcome: { fontSize: 18, fontWeight: "600", color: Colors.textPrimary, marginBottom: 6 },
  description: { fontSize: 14, color: Colors.textSecondary, textAlign: "center", marginBottom: 32 },
  button: {
    width: "100%",
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
});
