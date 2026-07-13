import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useEffect, useState } from "react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { router } from "expo-router";
import { Bell } from "lucide-react-native";

import { auth } from "../../shared/services/auth";
import { db } from "../../shared/services/firestore";
import { colors, fontFamily, radius } from "../../shared/theme";

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
      style={styles.wrap}
      onPress={() => router.push("/notifications" as any)}
      activeOpacity={0.7}
    >
      <View style={styles.btn}>
        <Bell size={24} color={colors.emeraldSoft} />
      </View>
      {totalCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{totalCount > 9 ? "9+" : totalCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 40,
    height: 40,
  },
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 17,
    height: 17,
    borderRadius: radius.pill,
    backgroundColor: colors.error,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: colors.ink,
  },
  badgeText: {
    color: colors.white,
    fontSize: 9,
    fontFamily: fontFamily.bold,
  },
});
