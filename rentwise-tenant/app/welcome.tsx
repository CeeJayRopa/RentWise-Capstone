import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";

export default function Welcome() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Text style={styles.brand}>RentWise</Text>

      <View style={styles.avatarCircle}>
        <View style={styles.avatarHead} />
        <View style={styles.avatarBody} />
      </View>

      <Text style={styles.welcome}>Welcome, Tenant!</Text>

      <TouchableOpacity style={styles.button} onPress={() => router.push("/dashboard")}>
        <Text style={styles.buttonText}>Continue</Text>
      </TouchableOpacity>
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

  brand: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#1A1A1A",
    marginBottom: 40,
  },

  avatarCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#C8C8C8",
    alignItems: "center",
    justifyContent: "flex-end",
    overflow: "hidden",
    marginBottom: 30,
  },

  avatarHead: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#6B6B6B",
    position: "absolute",
    top: 22,
  },

  avatarBody: {
    width: 80,
    height: 55,
    borderRadius: 40,
    backgroundColor: "#6B6B6B",
    marginBottom: -10,
  },

  welcome: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#1A1A1A",
    marginBottom: 50,
  },

  button: {
    borderWidth: 1.5,
    borderColor: "#7CB87A",
    borderRadius: 30,
    paddingVertical: 12,
    paddingHorizontal: 50,
    backgroundColor: "#F0F7F0",
  },

  buttonText: {
    fontSize: 16,
    color: "#4A8A48",
    fontWeight: "500",
  },
});
