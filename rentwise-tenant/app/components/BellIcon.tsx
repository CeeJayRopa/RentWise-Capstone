import { View, TouchableOpacity, StyleSheet } from "react-native";
import { useEffect, useState } from "react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { router } from "expo-router";
import { Bell } from "lucide-react-native";

import { auth } from "../../shared/firebaseConfig";
import { db } from "../../shared/services/firestore";
import { colors } from "../../shared/theme";

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
      <Bell size={24} color={colors.white} />
      {unreadCount > 0 && <View style={styles.dot} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    position: "absolute",
    top: 9,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.gold,
  },
});
