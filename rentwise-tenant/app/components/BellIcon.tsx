import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useEffect, useState } from "react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { router } from "expo-router";

import { auth } from "../../shared/firebaseConfig";
import { db } from "../../shared/services/firestore";

export default function BellIcon() {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    const q = query(
      collection(db, "notifications"),
      where("userId", "==", user.uid),
      where("read", "==", false),
    );

    const unsub = onSnapshot(q, (snap) => {
      setUnreadCount(snap.size);
    });

    return () => unsub();
  }, []);

  return (
    <TouchableOpacity
      style={styles.btn}
      onPress={() => router.push("/notification")}
      activeOpacity={0.7}
    >
      <Text style={styles.icon}>🔔</Text>

      {unreadCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {unreadCount > 99 ? "99+" : String(unreadCount)}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 36,
    alignItems: "flex-end",
    justifyContent: "center",
  },

  icon: {
    fontSize: 18,
  },

  badge: {
    position: "absolute",
    top: -6,
    right: -4,
    backgroundColor: "#E53935",
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },

  badgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "bold",
  },
});
