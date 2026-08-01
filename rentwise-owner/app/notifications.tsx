import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { ArrowLeft, HelpCircle, KeyRound, Bell } from "lucide-react-native";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import HelpTour, { HelpStep } from "./components/HelpTour";
import { hasSeenPageTour, markPageTourSeen } from "../shared/services/onboardingTour";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../shared/theme";

type OwnerNotification = {
  id: string;
  userId: string;
  message: string;
  status?: string;
  read: boolean;
  createdAt?: any;
  updateId?: string;
};

type AdminPasswordReset = {
  id: string;
  tenantName?: string; // admin's name — field reused from the shared passwordResetRequests schema
  email?: string;
  createdAt?: any;
};

function relativeTime(ts: any): string {
  if (!ts) return "";
  const d: Date = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

function categoryLabel(cat: string): string {
  if (cat === "building") return "Building Management Update";
  if (cat === "finance") return "Finance Update";
  return "Account Archive Update";
}

// Notifications created before the "Approve" → "Acknowledge" wording change
// still have the old status string in Firestore — treat both as pending.
function isPendingStatus(status?: string): boolean {
  return status === "To be Acknowledged" || status === "To be Approved";
}

// Displays legacy "Approved" / "To be Approved" statuses under the new wording
// without needing to rewrite the old Firestore records.
function displayStatus(status?: string): string {
  if (status === "To be Approved") return "To be Acknowledged";
  if (status === "Approved") return "Acknowledged";
  return status ?? "";
}

export default function Notifications() {
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState<OwnerNotification[]>([]);
  const [adminResets, setAdminResets] = useState<AdminPasswordReset[]>([]);
  const [resolvingResetId, setResolvingResetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);
  const [tourVisible, setTourVisible] = useState(false);
  const actionRowRef = useRef<View>(null);
  const cardRef = useRef<View>(null);
  const checkReportRef = useRef<View>(null);

  const firstPendingIndex = notifications.findIndex((n) => isPendingStatus(n.status) && n.updateId);

  const tourSteps: HelpStep[] = [
    { key: "actions", ref: actionRowRef, title: "Acknowledge All / Clear All", description: "Acknowledge All approves every pending update at once. Clear All removes already-acknowledged notifications from this list.", edgeInset: "top" },
    { key: "card", ref: cardRef, title: "Notification", description: "Shows who made the update, when, and its current status.", edgeInset: "top" },
    ...(firstPendingIndex !== -1
      ? [{ key: "checkreport", ref: checkReportRef, title: "Check Report", description: "Opens the full details of a pending update so you can review it before acknowledging.", edgeInset: "top" as const }]
      : []),
  ];

  const fetchAdminResets = useCallback(async () => {
    try {
      const snap = await getDocs(
        query(
          collection(db, "passwordResetRequests"),
          where("requestedRole", "==", "admin"),
          where("status", "==", "pending"),
        ),
      );
      setAdminResets(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
      );
    } catch (err) {
      console.log("ADMIN RESET FETCH ERROR:", err);
    }
  }, []);

  const resolveAdminReset = async (item: AdminPasswordReset) => {
    setResolvingResetId(item.id);
    try {
      await updateDoc(doc(db, "passwordResetRequests", item.id), {
        status: "resolved",
      });
      setAdminResets((prev) => prev.filter((r) => r.id !== item.id));
    } catch (err) {
      console.log("ADMIN RESET RESOLVE ERROR:", err);
      Alert.alert("Error", "Failed to update request.");
    } finally {
      setResolvingResetId(null);
    }
  };

  const goResetAdminPassword = () => {
    router.push("/manage-admin");
  };

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
          ...(d.data() as Omit<OwnerNotification, "id">),
        })),
      );
      setLoading(false);
    });

    unsubRef.current = unsub;
  }, []);

  useFocusEffect(
    useCallback(() => {
      subscribe();
      fetchAdminResets();
      return () => {
        unsubRef.current?.();
        unsubRef.current = null;
      };
    }, [subscribe, fetchAdminResets]),
  );

  // Auto-opens the guided tour the first time the owner ever lands on this
  // page — never again after that, since it flips a persisted per-device
  // flag. Can still be replayed anytime via the Help button.
  useEffect(() => {
    if (loading) return;
    (async () => {
      const seen = await hasSeenPageTour("owner-notifications");
      if (!seen) {
        setTourVisible(true);
        await markPageTourSeen("owner-notifications");
      }
    })();
  }, [loading]);

  const markRead = async (item: OwnerNotification) => {
    if (item.read) return;
    try {
      await updateDoc(doc(db, "notifications", item.id), { read: true });
    } catch (err) {
      console.log(err);
    }
  };

  const handleCheckReport = async (item: OwnerNotification) => {
    await markRead(item);
    router.push({
      pathname: "/update-confirmation",
      params: { id: item.updateId },
    } as any);
  };

  const doApproveAll = async (pending: OwnerNotification[]) => {
    setApproving(true);
    try {
      const batch = writeBatch(db);
      for (const item of pending) {
        batch.update(doc(db, "notifications", item.id), {
          status: "Acknowledged",
          read: true,
        });
        if (item.updateId) {
          batch.update(doc(db, "updates", item.updateId), {
            approvalStatus: "approved",
          });
        }
      }
      await batch.commit();

      for (const item of pending) {
        if (!item.updateId) continue;
        try {
          const snap = await getDoc(doc(db, "updates", item.updateId));
          const data = snap.exists() ? snap.data() : {};
          if (data.changedBy) {
            const label = data.module ?? categoryLabel(data.category ?? "archive");
            await addDoc(collection(db, "notifications"), {
              userId: data.changedBy,
              message: `Your "${label}" update was acknowledged by the owner.`,
              read: false,
              fromOwner: true,
              createdAt: serverTimestamp(),
            });
          }
          await addDoc(collection(db, "dailyReports"), {
            type: data.module ?? categoryLabel(data.category ?? "archive"),
            updateId: item.updateId,
            spaceNo: data.spaceNo ?? null,
            tenantName: data.tenantName ?? null,
            approvedBy: "Owner",
            date: serverTimestamp(),
            createdAt: serverTimestamp(),
          });
        } catch {
          // skip individual dailyReport failure silently
        }
      }
    } catch (err) {
      console.error("approveAll error:", err);
      Alert.alert("Error", "Failed to acknowledge all. Please try again.");
    } finally {
      setApproving(false);
    }
  };

  const doClearAll = async (items: OwnerNotification[]) => {
    setClearing(true);
    try {
      const batch = writeBatch(db);
      for (const item of items) {
        batch.delete(doc(db, "notifications", item.id));
      }
      await batch.commit();
    } catch (err) {
      console.error("clearAll error:", err);
      Alert.alert("Error", "Failed to clear notifications. Please try again.");
    } finally {
      setClearing(false);
    }
  };

  const handleApproveAll = () => {
    const pending = notifications.filter((n) => isPendingStatus(n.status));
    if (pending.length === 0) {
      Alert.alert("Nothing Pending", "There are no pending notifications to acknowledge.");
      return;
    }
    Alert.alert(
      "Acknowledge All",
      `Acknowledge all ${pending.length} pending update(s)?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Acknowledge All", onPress: () => doApproveAll(pending) },
      ],
    );
  };

  const handleClearAll = () => {
    if (notifications.length === 0) return;
    if (pendingCount > 0) return;
    Alert.alert(
      "Clear Notifications",
      "Remove all notifications from your list?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: () => doClearAll(notifications),
        },
      ],
    );
  };

  const pendingCount = notifications.filter((n) =>
    isPendingStatus(n.status),
  ).length;
  const busy = approving || clearing;

  if (loading) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator size="large" color={colors.emerald} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Header */}
      <LinearGradient
        colors={[colors.emerald, colors.ink]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            activeOpacity={0.7}
          >
            <ArrowLeft size={22} color={colors.emeraldSoft} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>RentWise</Text>
          <TouchableOpacity onPress={() => setTourVisible(true)} style={styles.backBtn} activeOpacity={0.7}>
            <HelpCircle size={22} color={colors.emeraldSoft} />
          </TouchableOpacity>
        </View>

        {/* Sub-header */}
        <View style={styles.subHeader}>
          <Text style={styles.subHeaderText}>Notifications</Text>
        </View>
      </LinearGradient>

      <ScrollView
        style={styles.body}
        contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: insets.bottom + 24 }}
      >
        {/* Admin password reset requests */}
        {adminResets.length > 0 && (
          <View style={{ marginBottom: spacing.md + 2 }}>
            <Text style={styles.sectionTitle}>Admin Password Resets</Text>
            {adminResets.map((item) => (
              <View key={item.id} style={styles.card}>
                <View style={styles.cardRow}>
                  <View style={styles.bellCircle}>
                    <KeyRound size={20} color={colors.emerald} />
                  </View>
                  <View style={styles.cardContent}>
                    <Text style={styles.senderName}>
                      {item.tenantName || "Admin"}
                    </Text>
                    <Text style={styles.messageText}>{item.email}</Text>
                    <Text style={styles.timeText}>
                      {relativeTime(item.createdAt)}
                    </Text>
                    <View style={styles.resetActionsRow}>
                      <Pressable
                        style={({ pressed }) => [styles.checkReportBtn, pressed && styles.checkReportBtnPressed]}
                        onPress={goResetAdminPassword}
                      >
                        {({ pressed }) => (
                          <Text style={[styles.checkReportText, pressed && styles.checkReportTextPressed]}>
                            Reset in Manage Admin
                          </Text>
                        )}
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [
                          styles.resolveResetBtn,
                          resolvingResetId === item.id && styles.btnDisabled,
                          pressed && resolvingResetId !== item.id && styles.resolveResetBtnPressed,
                        ]}
                        onPress={() => resolveAdminReset(item)}
                        disabled={resolvingResetId === item.id}
                      >
                        {({ pressed }) =>
                          resolvingResetId === item.id ? (
                            <ActivityIndicator color={colors.emerald} size="small" />
                          ) : (
                            <Text style={[styles.resolveResetBtnText, pressed && styles.resolveResetBtnTextPressed]}>
                              Mark resolved
                            </Text>
                          )
                        }
                      </Pressable>
                    </View>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Action buttons */}
        {notifications.length > 0 && (
          <View style={styles.actionRow} ref={actionRowRef} collapsable={false}>
            {pendingCount > 0 && (
              <Pressable
                style={({ pressed }) => [styles.approveAllBtn, busy && styles.btnDisabled, pressed && !busy && styles.approveAllBtnPressed]}
                onPress={handleApproveAll}
                disabled={busy}
              >
                {({ pressed }) =>
                  approving ? (
                    <ActivityIndicator color={colors.white} size="small" />
                  ) : (
                    <Text style={[styles.approveAllText, pressed && styles.approveAllTextPressed]}>
                      Acknowledge All ({pendingCount})
                    </Text>
                  )
                }
              </Pressable>
            )}

            <Pressable
              style={({ pressed }) => [
                styles.clearBtn,
                (busy || pendingCount > 0) && styles.btnDisabled,
                pressed && !(busy || pendingCount > 0) && styles.clearBtnPressed,
              ]}
              onPress={handleClearAll}
              disabled={busy || pendingCount > 0}
            >
              {({ pressed }) =>
                clearing ? (
                  <ActivityIndicator color={colors.error} size="small" />
                ) : (
                  <Text style={[styles.clearText, pressed && styles.clearTextPressed]}>Clear All</Text>
                )
              }
            </Pressable>
          </View>
        )}

        {notifications.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No notifications yet.</Text>
          </View>
        ) : (
          notifications.map((item, index) => {
            const isPending = isPendingStatus(item.status);
            const isRejected = item.status === "Rejected";
            return (
              <View
                key={item.id}
                ref={index === 0 ? cardRef : undefined}
                collapsable={false}
                style={[styles.card, !item.read && styles.cardUnread]}
              >
                <View style={styles.cardRow}>
                  <View style={styles.bellCircle}>
                    <Bell size={20} color={colors.emerald} />
                  </View>

                  <View style={styles.cardContent}>
                    <View style={styles.topRow}>
                      <Text style={styles.senderName}>Admin</Text>
                      <Text style={styles.timeText}>
                        {relativeTime(item.createdAt)}
                      </Text>
                    </View>

                    <Text style={styles.messageText}>{item.message}</Text>

                    {item.status ? (
                      <Text style={styles.statusLine}>
                        <Text style={styles.statusLabel}>Status:  </Text>
                        <Text
                          style={[
                            styles.statusValue,
                            isPending
                              ? styles.statusPending
                              : isRejected
                                ? styles.statusRejected
                                : styles.statusApproved,
                          ]}
                        >
                          {displayStatus(item.status)}
                        </Text>
                      </Text>
                    ) : null}

                  </View>
                </View>

                {isPending && item.updateId ? (
                  <Pressable
                    ref={index === firstPendingIndex ? checkReportRef : undefined}
                    style={({ pressed }) => [
                      styles.checkReportBtn,
                      styles.checkReportBtnCentered,
                      pressed && styles.checkReportBtnPressed,
                    ]}
                    onPress={() => handleCheckReport(item)}
                  >
                    {({ pressed }) => (
                      <Text style={[styles.checkReportText, pressed && styles.checkReportTextPressed]}>Check Report</Text>
                    )}
                  </Pressable>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>
      <HelpTour visible={tourVisible} steps={tourSteps} onClose={() => setTourVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.parchment },

  loadingBox: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.parchment,
  },

  headerGradient: {
    borderBottomLeftRadius: radius.xl + 4,
    borderBottomRightRadius: radius.xl + 4,
    overflow: "hidden",
  },

  header: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md + 2,
    flexDirection: "row",
    alignItems: "center",
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: colors.white,
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
  },

  subHeader: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md + 2,
  },
  subHeaderText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontFamily: fontFamily.semibold,
    textAlign: "center",
  },

  body: { flex: 1 },

  actionRow: {
    flexDirection: "row",
    gap: spacing.sm + 2,
    marginBottom: spacing.lg,
  },
  approveAllBtn: {
    flex: 1,
    backgroundColor: colors.emerald,
    borderRadius: radius.sm,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 42,
    ...shadow.button,
  },
  approveAllBtnPressed: {
    backgroundColor: colors.white,
  },
  approveAllText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.white,
  },
  approveAllTextPressed: {
    color: colors.emerald,
  },
  clearBtn: {
    flex: 1,
    borderRadius: radius.sm,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.error,
    backgroundColor: colors.white,
    minHeight: 42,
  },
  clearBtnPressed: {
    backgroundColor: colors.error,
  },
  clearText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.error,
  },
  clearTextPressed: {
    color: colors.white,
  },
  btnDisabled: { opacity: 0.5 },

  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md + 2,
    marginBottom: spacing.sm + 2,
    ...shadow.card,
  },
  cardUnread: {
    borderLeftWidth: 3,
    borderLeftColor: colors.emeraldBright,
  },

  cardRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },

  bellCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.emeraldSoft,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  cardContent: { flex: 1 },

  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  senderName: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.ink },
  timeText: { fontSize: fontSize.xs + 1, color: colors.textSecondary, fontFamily: fontFamily.regular },

  messageText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontFamily: fontFamily.regular,
    lineHeight: 18,
    marginBottom: 6,
  },

  statusLine: { fontSize: fontSize.sm, marginBottom: spacing.sm },
  statusLabel: { fontFamily: fontFamily.semibold, color: colors.ink },
  statusValue: { fontFamily: fontFamily.semibold },
  statusPending: { color: colors.warning },
  statusApproved: { color: colors.emerald },
  statusRejected: { color: colors.error },

  checkReportBtn: {
    alignSelf: "flex-start",
    backgroundColor: colors.emerald,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "transparent",
  },
  checkReportBtnCentered: {
    alignSelf: "center",
    marginTop: spacing.sm + 2,
  },
  checkReportBtnPressed: {
    backgroundColor: colors.white,
    borderColor: colors.emerald,
  },
  checkReportText: { fontSize: fontSize.xs + 1, fontFamily: fontFamily.semibold, color: colors.white },
  checkReportTextPressed: { color: colors.emerald },

  sectionTitle: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  resetActionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: 6,
  },
  resolveResetBtn: {
    alignSelf: "flex-start",
    backgroundColor: colors.mist,
    borderWidth: 1,
    borderColor: colors.emeraldSoft,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  resolveResetBtnPressed: {
    backgroundColor: colors.emerald,
    borderColor: colors.emerald,
  },
  resolveResetBtnText: { fontSize: fontSize.xs + 1, fontFamily: fontFamily.semibold, color: colors.emerald },
  resolveResetBtnTextPressed: { color: colors.white },

  empty: { alignItems: "center", paddingTop: 80 },
  emptyText: { fontSize: fontSize.base, color: colors.textSecondary, fontFamily: fontFamily.regular },
});
