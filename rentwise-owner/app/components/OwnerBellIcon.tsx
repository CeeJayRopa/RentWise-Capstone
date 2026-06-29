import { View, TouchableOpacity, StyleSheet } from "react-native";
import { useEffect, useState } from "react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { auth } from "../../shared/services/auth";
import { db } from "../../shared/services/firestore";

export default function OwnerBellIcon() {
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
      onPress={() => router.push("/notifications" as any)}
      activeOpacity={0.7}
    >
      <Ionicons name="notifications-outline" size={24} color="#E6F1FB" />
      {unreadCount > 0 && <View style={styles.dot} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 36,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  dot: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#EF9F27",
  },
});
