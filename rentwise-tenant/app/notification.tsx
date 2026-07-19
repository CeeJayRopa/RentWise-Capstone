import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  ArrowLeft,
  Bell,
  BellOff,
  Check,
  Trash2,
  AlarmClock,
  Wallet,
  CheckCircle2,
  HelpCircle,
} from "lucide-react-native";

import { auth } from "../shared/firebaseConfig";
import { db } from "../shared/services/firestore";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../shared/theme";
import HelpTour, { HelpStep } from "./components/HelpTour";
import { hasSeenPageTour, markPageTourSeen } from "../shared/services/onboardingTour";

type Notification = {
  id: string;
  userId: string;
  message: string;
  read: boolean;
  createdAt: any;
};

// The backend only ever writes a single `message` sentence — there's no
// category field to key off of. Sniffing keywords out of that sentence is
// the only way to give each notification a distinct title/icon/color
// without touching every Cloud Function that creates one.
function categorize(message: string) {
  const m = message.toLowerCase();
  if (m.includes("rent") && (m.includes("due") || m.includes("overdue"))) {
    return { title: "Rent Due", icon: AlarmClock, iconColor: colors.error, iconBg: colors.errorSoft };
  }
  if (m.includes("payment") && (m.includes("received") || m.includes("posted") || m.includes("approved") || m.includes("rejected"))) {
    return { title: "Payment Update", icon: Wallet, iconColor: colors.emerald, iconBg: colors.emeraldSoft };
  }
  if (m.includes("acknowledge") || m.includes("update")) {
    return { title: "Update", icon: CheckCircle2, iconColor: colors.emerald, iconBg: colors.emeraldSoft };
  }
  return { title: "Notification", icon: Bell, iconColor: colors.emerald, iconBg: colors.emeraldSoft };
}

function relativeTime(ts: any): string {
  if (!ts) return "";
  const d: Date = ts.toDate ? ts.toDate() : new Date(ts);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "JUST NOW";
  if (diffMin < 60) return `${diffMin}M AGO`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}H AGO`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "YESTERDAY";
  if (diffDay < 7) return `${diffDay}D AGO`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
}

export default function Notification() {
  const insets = useSafeAreaInsets();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const [clearing, setClearing] = useState(false);

  const unsubRef = useRef<(() => void) | null>(null);

  const [tourVisible, setTourVisible] = useState(false);
  const helpRef = useRef<View>(null);
  const markAllRef = useRef<View>(null);
  const clearAllRef = useRef<View>(null);
  const listRef = useRef<View>(null);
  const firstCardRef = useRef<View>(null);

  const tourSteps: HelpStep[] = [
    { key: "help", ref: helpRef, title: "Help", description: "Come back here anytime for a guided tour of this page.", edgeInset: "top", round: true },
    { key: "markAllRead", ref: markAllRef, title: "Mark all read", description: "Marks every notification in your list as read, in one tap.", edgeInset: "top" },
    { key: "clearAll", ref: clearAllRef, title: "Clear all", description: "Removes every notification from your list. This can't be undone.", edgeInset: "top" },
    { key: "list", ref: listRef, endRef: firstCardRef, title: "Notifications", description: "Rent reminders, payment updates, and other alerts. Tap one to mark it read.", edgeInset: "top" },
  ];

  // Auto-opens the guided tour the first time the tenant ever lands on this
  // page — never again after that, since it flips a persisted per-device
  // flag. Can still be replayed anytime via the Help button.
  useEffect(() => {
    if (loading) return;
    (async () => {
      const seen = await hasSeenPageTour("tenant-notifications");
      if (!seen) {
        setTourVisible(true);
        await markPageTourSeen("tenant-notifications");
      }
    })();
  }, [loading]);

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

  const clearAll = async () => {
    if (notifications.length === 0) return;
    setClearing(true);
    try {
      const batch = writeBatch(db);
      notifications.forEach((n) => {
        batch.delete(doc(db, "notifications", n.id));
      });
      await batch.commit();
    } catch (err) {
      console.log(err);
    } finally {
      setClearing(false);
    }
  };

  const handleClearAll = () => {
    if (notifications.length === 0) return;
    Alert.alert(
      "Clear Notifications",
      "Remove all notifications from your list?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Clear All", style: "destructive", onPress: clearAll },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.emerald} />
      </View>
    );
  }

  const unreadCount = notifications.filter((n) => !n.read).length;
  const hasUnread = unreadCount > 0;

  return (
    <View style={styles.root}>
      {/* Header */}
      <LinearGradient
        colors={[colors.emerald, colors.ink]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={[styles.headerRow, { paddingTop: insets.top + 14 }]}>
          <TouchableOpacity style={styles.headerIconBtn} onPress={() => router.back()} hitSlop={8}>
            <ArrowLeft size={20} color={colors.white} />
          </TouchableOpacity>
          <Text style={styles.headerRowTitle}>Notifications</Text>
          <View ref={helpRef} collapsable={false}>
            <TouchableOpacity style={styles.headerIconBtn} onPress={() => setTourVisible(true)} hitSlop={8}>
              <HelpCircle size={20} color={colors.white} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.titleBlock}>
          <Text style={styles.pageSubtitle}>
            {unreadCount} unread update{unreadCount !== 1 ? "s" : ""}
          </Text>
        </View>
      </LinearGradient>

      <View style={styles.actionsRow}>
        <TouchableOpacity
          ref={markAllRef}
          style={[styles.actionPill, (!hasUnread || markingAll) && styles.actionPillDisabled]}
          onPress={markAllRead}
          disabled={!hasUnread || markingAll}
        >
          <Check size={14} color={colors.emerald} />
          <Text style={styles.actionPillTextGreen}>{markingAll ? "Marking…" : "Mark all read"}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          ref={clearAllRef}
          style={[styles.actionPill, (notifications.length === 0 || clearing) && styles.actionPillDisabled]}
          onPress={handleClearAll}
          disabled={notifications.length === 0 || clearing}
        >
          <Trash2 size={14} color={colors.error} />
          <Text style={styles.actionPillTextRed}>{clearing ? "Clearing…" : "Clear all"}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={[styles.bodyContent, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View ref={listRef} collapsable={false}>
          {notifications.length === 0 ? (
            <View style={styles.empty}>
              <BellOff size={44} color={colors.emeraldSoft} style={{ marginBottom: 16 }} />
              <Text style={styles.emptyText}>No notifications yet.</Text>
            </View>
          ) : (
            notifications.map((item, index) => {
              const cat = categorize(item.message);
              const Icon = cat.icon;
              return (
                <TouchableOpacity
                  key={item.id}
                  ref={index === 0 ? firstCardRef : undefined}
                  style={styles.card}
                  onPress={() => markRead(item)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.iconCircle, { backgroundColor: cat.iconBg }]}>
                    <Icon size={18} color={cat.iconColor} />
                  </View>
                  <View style={styles.textGroup}>
                    <Text style={styles.cardTitle}>{cat.title}</Text>
                    <Text style={styles.message}>{item.message}</Text>
                    <Text style={styles.timestamp}>{relativeTime(item.createdAt)}</Text>
                  </View>
                  {!item.read && <View style={styles.unreadDot} />}
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>

      <HelpTour
        visible={tourVisible}
        steps={tourSteps}
        onClose={() => setTourVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.parchment,
  },

  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.parchment,
  },

  // ── Header ──────────────────────────────────────
  headerGradient: {
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: "hidden",
    paddingBottom: spacing.xl,
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },

  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },

  headerRowTitle: {
    flex: 1,
    textAlign: "center",
    color: colors.white,
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
  },

  titleBlock: {
    paddingHorizontal: spacing.xl,
  },

  pageSubtitle: {
    color: colors.emeraldSoft,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    marginTop: 2,
    textAlign: "right",
  },

  // ── Floating action pills ─────────────────────────
  actionsRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },

  actionPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    ...shadow.card,
  },

  actionPillDisabled: {
    opacity: 0.45,
  },

  actionPillTextGreen: {
    color: colors.emerald,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
  },

  actionPillTextRed: {
    color: colors.error,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
  },

  // ── Body ────────────────────────────────────────
  body: {
    flex: 1,
  },

  bodyContent: {
    paddingHorizontal: spacing.lg,
  },

  // ── Notification card ─────────────────────────────
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadow.card,
  },

  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },

  textGroup: {
    flex: 1,
  },

  cardTitle: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  message: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    lineHeight: 19,
    marginTop: 2,
  },

  timestamp: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.textMuted,
    letterSpacing: 0.3,
    marginTop: spacing.sm,
  },

  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.emeraldBright,
    marginTop: 4,
  },

  // ── Empty state ──────────────────────────────────
  empty: {
    alignItems: "center",
    marginTop: 80,
  },

  emptyText: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    textAlign: "center",
  },
});
