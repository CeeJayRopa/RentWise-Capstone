import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useState } from "react";
import { router } from "expo-router";
import { loginUser } from "../services/authService";

export default function Login() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleLogin() {
    try {
      const user = await loginUser(email, password);
      console.log(user.uid);
      router.push({ pathname: "/welcome" });
    } catch (error) {
      Alert.alert("Login Failed", "Incorrect email or password");
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.avatar} />

      <Text style={styles.title}>RentWise</Text>

      <View style={styles.form}>
        <Text style={styles.label}>Username:</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <Text style={styles.label}>Password:</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity style={styles.loginButton} onPress={handleLogin}>
          <Text style={styles.loginText}>Login</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#E8E8E8",
    alignItems: "center",
    justifyContent: "center",
    padding: 30,
  },

  avatar: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "#C8C8C8",
    marginBottom: 20,
  },

  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#1A1A1A",
    marginBottom: 30,
  },

  form: {
    width: "100%",
  },

  label: {
    fontSize: 15,
    color: "#1A1A1A",
    marginBottom: 6,
    marginTop: 12,
  },

  input: {
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: "#1A1A1A",
  },

  loginButton: {
    backgroundColor: "#7CB87A",
    borderRadius: 30,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 30,
    marginBottom: 18,
  },

  loginText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
});
