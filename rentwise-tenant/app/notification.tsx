import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";

import { auth } from "../shared/firebaseConfig";
import { db } from "../shared/services/firestore";

type Notification = {
  id: string;
  userId: string;
  message: string;
  read: boolean;
  createdAt: any;
};

export default function Notification() {
  const insets = useSafeAreaInsets();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);

  const unsubRef = useRef<(() => void) | null>(null);

  const subscribe = useCallback(() => {
    const user = auth.currentUser;
    if (!user) return;

    const q = query(
      collection(db, "notifications"),
      where("userId", "==", user.uid),
      orderBy("createdAt", "desc"),
    );

    const unsub = onSnapshot(q, (snap) => {
      setNotifications(
        snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Notification, "id">),
        })),
      );
      setLoading(false);
    });

    unsubRef.current = unsub;
  }, []);

  useFocusEffect(
    useCallback(() => {
      subscribe();
      return () => {
        unsubRef.current?.();
        unsubRef.current = null;
      };
    }, [subscribe]),
  );

  const markRead = async (item: Notification) => {
    if (item.read) return;
    try {
      await updateDoc(doc(db, "notifications", item.id), { read: true });
    } catch (err) {
      console.log(err);
    }
  };

  const markAllRead = async () => {
    const unread = notifications.filter((n) => !n.read);
    if (unread.length === 0) return;
    setMarkingAll(true);
    try {
      const batch = writeBatch(db);
      unread.forEach((n) => {
        batch.update(doc(db, "notifications", n.id), { read: true });
      });
      await batch.commit();
    } catch (err) {
      console.log(err);
    } finally {
      setMarkingAll(false);
    }
  };

  const formatDate = (ts: any): string => {
    if (!ts) return "";
    const d: Date = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString("en-PH", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#0F6E56" />
      </View>
    );
  }

  const hasUnread = notifications.some((n) => !n.read);

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#E1F5EE" />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>RentWise</Text>

        <TouchableOpacity onPress={markAllRead} disabled={!hasUnread || markingAll}>
          <Text style={[styles.markAllText, !hasUnread && styles.markAllDisabled]}>
            {markingAll ? "..." : "Mark all"}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={[styles.bodyContent, { paddingBottom: insets.bottom + 20 }]}
      >
        <Text style={styles.pageTitle}>Notifications</Text>

        {notifications.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={48} color="#9FE1CB" style={{ marginBottom: 16 }} />
            <Text style={styles.emptyText}>No notifications yet.</Text>
          </View>
        ) : (
          notifications.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[styles.card, item.read ? styles.cardRead : styles.cardUnread]}
              onPress={() => markRead(item)}
              activeOpacity={0.8}
            >
              {!item.read && <View style={styles.accentBar} />}
              <View style={styles.cardBody}>
                <View style={styles.iconCircle}>
                  <Ionicons name="notifications-outline" size={18} color="#0F6E56" />
                </View>
                <View style={styles.textGroup}>
                  <Text style={styles.message}>{item.message}</Text>
                  <Text style={styles.timestamp}>{formatDate(item.createdAt)}</Text>
                </View>
                {!item.read && <View style={styles.unreadDot} />}
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0F6E56",
  },

  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F1EFE8",
  },

  // ── Header ──────────────────────────────────────
  header: {
    backgroundColor: "#0F6E56",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
  },

  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: "#fff",
    fontSize: 18,
    fontWeight: "500",
  },

  markAllText: {
    color: "#9FE1CB",
    fontSize: 13,
    fontWeight: "500",
  },

  markAllDisabled: {
    opacity: 0.4,
  },

  // ── Body ────────────────────────────────────────
  body: {
    flex: 1,
    backgroundColor: "#F1EFE8",
  },

  bodyContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },

  pageTitle: {
    fontSize: 20,
    fontWeight: "500",
    color: "#085041",
    marginBottom: 16,
  },

  // ── Notification card ─────────────────────────────
  card: {
    borderRadius: 16,
    borderWidth: 0.5,
    marginBottom: 12,
    flexDirection: "row",
    overflow: "hidden",
  },

  cardRead: {
    backgroundColor: "#fff",
    borderColor: "#E1F5EE",
  },

  cardUnread: {
    backgroundColor: "#f7fdf9",
    borderColor: "#9FE1CB",
  },

  accentBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: "#1D9E75",
    alignSelf: "stretch",
    marginRight: 4,
  },

  cardBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 16,
  },

  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#E1F5EE",
    alignItems: "center",
    justifyContent: "center",
  },

  textGroup: {
    flex: 1,
  },

  message: {
    fontSize: 14,
    color: "#444441",
    lineHeight: 20,
  },

  timestamp: {
    fontSize: 12,
    color: "#B4B2A9",
    marginTop: 6,
  },

  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#1D9E75",
    marginTop: 4,
  },

  // ── Empty state ──────────────────────────────────
  empty: {
    alignItems: "center",
    marginTop: 80,
  },

  emptyText: {
    fontSize: 15,
    color: "#888780",
    textAlign: "center",
  },
});
