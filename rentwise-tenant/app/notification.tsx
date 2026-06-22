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
        <ActivityIndicator size="large" color="#1A1A1A" />
      </View>
    );
  }

  const hasUnread = notifications.some((n) => !n.read);

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerSide}>
          <Text style={styles.backArrow}>◄</Text>
        </TouchableOpacity>

        <Text style={styles.headerTitle}>RentWise</Text>

        <TouchableOpacity
          style={styles.headerSide}
          onPress={markAllRead}
          disabled={!hasUnread || markingAll}
        >
          <Text style={[styles.markAllText, !hasUnread && styles.markAllDisabled]}>
            {markingAll ? "..." : "Mark all"}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
      >
        <Text style={styles.pageTitle}>Notifications</Text>

        {notifications.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No notifications yet.</Text>
          </View>
        ) : (
          notifications.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[styles.card, !item.read && styles.unread]}
              onPress={() => markRead(item)}
              activeOpacity={0.8}
            >
              <Text style={styles.message}>{item.message}</Text>

              <Text style={styles.date}>{formatDate(item.createdAt)}</Text>

              {!item.read && <View style={styles.dot} />}
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
    backgroundColor: "#1A1A1A",
  },

  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#E8E8E8",
  },

  header: {
    backgroundColor: "#1A1A1A",
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 16,
  },

  headerSide: {
    width: 60,
  },

  backArrow: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "bold",
  },

  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "bold",
  },

  markAllText: {
    color: "#4CAF50",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "right",
  },

  markAllDisabled: {
    color: "#555555",
  },

  body: {
    flex: 1,
    backgroundColor: "#E8E8E8",
  },

  pageTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#1A1A1A",
    padding: 16,
  },

  card: {
    backgroundColor: "#FFFFFF",
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 10,
    position: "relative",
  },

  unread: {
    borderLeftWidth: 5,
    borderLeftColor: "#F5C518",
    backgroundColor: "#FFFDE7",
  },

  message: {
    fontSize: 14,
    color: "#1A1A1A",
    lineHeight: 20,
    paddingRight: 16,
  },

  date: {
    marginTop: 10,
    fontSize: 12,
    color: "#888",
  },

  dot: {
    position: "absolute",
    top: 14,
    right: 14,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#F5C518",
  },

  empty: {
    alignItems: "center",
    paddingTop: 60,
  },

  emptyText: {
    fontSize: 15,
    color: "#888",
  },
});
