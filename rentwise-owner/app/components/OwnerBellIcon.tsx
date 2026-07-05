import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useEffect, useState } from "react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { auth } from "../../shared/services/auth";
import { db } from "../../shared/services/firestore";

export default function OwnerBellIcon() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingResetCount, setPendingResetCount] = useState(0);

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

    const resetQ = query(
      collection(db, "passwordResetRequests"),
      where("requestedRole", "==", "admin"),
      where("status", "==", "pending"),
    );

    const unsubResets = onSnapshot(resetQ, (snap) => {
      setPendingResetCount(snap.size);
    });

    return () => {
      unsub();
      unsubResets();
    };
  }, []);

  const totalCount = unreadCount + pendingResetCount;

  return (
    <TouchableOpacity
      style={styles.btn}
      onPress={() => router.push("/notifications" as any)}
      activeOpacity={0.7}
    >
      <Ionicons name="notifications-outline" size={24} color="#E6F1FB" />
      {totalCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{totalCount > 9 ? "9+" : totalCount}</Text>
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
  badge: {
    position: "absolute",
    top: -4,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#D64545",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 3,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700",
  },
});
