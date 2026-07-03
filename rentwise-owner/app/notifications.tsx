import { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
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
import { Colors } from "../shared/constants/color";

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

export default function Notifications() {
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState<OwnerNotification[]>([]);
  const [adminResets, setAdminResets] = useState<AdminPasswordReset[]>([]);
  const [resolvingResetId, setResolvingResetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);

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
          status: "Approved",
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
              message: `Your "${label}" update was approved by the owner.`,
              read: false,
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
      Alert.alert("Error", "Failed to approve all. Please try again.");
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
    const pending = notifications.filter((n) => n.status === "To be Approved");
    if (pending.length === 0) {
      Alert.alert("Nothing Pending", "There are no pending notifications to approve.");
      return;
    }
    Alert.alert(
      "Approve All",
      `Approve all ${pending.length} pending update(s)?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Approve All", onPress: () => doApproveAll(pending) },
      ],
    );
  };

  const handleClearAll = () => {
    if (notifications.length === 0) return;
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

  const pendingCount = notifications.filter(
    (n) => n.status === "To be Approved",
  ).length;
  const busy = approving || clearing;

  if (loading) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Text style={styles.backArrow}>◄</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>RentWise</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 24 }}
      >
        <Text style={styles.pageTitle}>Notifications</Text>

        {/* Admin password reset requests */}
        {adminResets.length > 0 && (
          <View style={{ marginBottom: 14 }}>
            <Text style={styles.sectionTitle}>Admin Password Resets</Text>
            {adminResets.map((item) => (
              <View key={item.id} style={styles.card}>
                <View style={styles.cardRow}>
                  <View style={styles.bellCircle}>
                    <Text style={styles.bellEmoji}>🔑</Text>
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
                      <TouchableOpacity
                        style={styles.checkReportBtn}
                        onPress={goResetAdminPassword}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.checkReportText}>
                          Reset in Manage Admin
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.resolveResetBtn,
                          resolvingResetId === item.id && styles.btnDisabled,
                        ]}
                        onPress={() => resolveAdminReset(item)}
                        disabled={resolvingResetId === item.id}
                        activeOpacity={0.8}
                      >
                        {resolvingResetId === item.id ? (
                          <ActivityIndicator color="#1A1A1A" size="small" />
                        ) : (
                          <Text style={styles.resolveResetBtnText}>
                            Mark resolved
                          </Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Action buttons */}
        {notifications.length > 0 && (
          <View style={styles.actionRow}>
            {pendingCount > 0 && (
              <TouchableOpacity
                style={[styles.approveAllBtn, busy && styles.btnDisabled]}
                onPress={handleApproveAll}
                disabled={busy}
                activeOpacity={0.8}
              >
                {approving ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.approveAllText}>
                    Approve All ({pendingCount})
                  </Text>
                )}
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.clearBtn, busy && styles.btnDisabled]}
              onPress={handleClearAll}
              disabled={busy}
              activeOpacity={0.8}
            >
              {clearing ? (
                <ActivityIndicator color="#C0392B" size="small" />
              ) : (
                <Text style={styles.clearText}>Clear All</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {notifications.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No notifications yet.</Text>
          </View>
        ) : (
          notifications.map((item) => {
            const isPending = item.status === "To be Approved";
            const isRejected = item.status === "Rejected";
            return (
              <View
                key={item.id}
                style={[styles.card, !item.read && styles.cardUnread]}
              >
                <View style={styles.cardRow}>
                  <View style={styles.bellCircle}>
                    <Text style={styles.bellEmoji}>🔔</Text>
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
                          {item.status}
                        </Text>
                      </Text>
                    ) : null}

                    {isPending && item.updateId ? (
                      <TouchableOpacity
                        style={styles.checkReportBtn}
                        onPress={() => handleCheckReport(item)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.checkReportText}>Check Report</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#EBEBEB" },

  loadingBox: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#EBEBEB",
  },

  header: {
    backgroundColor: "#1A1A1A",
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  backBtn: { width: 40 },
  backArrow: { color: "#FFFFFF", fontSize: 18, fontWeight: "bold" },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "bold",
  },

  body: { flex: 1 },

  pageTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#1A1A1A",
    marginBottom: 10,
  },

  actionRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  approveAllBtn: {
    flex: 1,
    backgroundColor: Colors.success,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
  },
  approveAllText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  clearBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#C0392B",
    backgroundColor: "#FFFFFF",
    minHeight: 40,
  },
  clearText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#C0392B",
  },
  btnDisabled: { opacity: 0.5 },

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardUnread: {
    borderLeftWidth: 3,
    borderLeftColor: "#F5C518",
  },

  cardRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },

  bellCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#F5C518",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  bellEmoji: { fontSize: 20 },

  cardContent: { flex: 1 },

  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  senderName: { fontSize: 14, fontWeight: "700", color: "#1A1A1A" },
  timeText: { fontSize: 12, color: "#888888" },

  messageText: {
    fontSize: 13,
    color: "#444444",
    lineHeight: 18,
    marginBottom: 6,
  },

  statusLine: { fontSize: 13, marginBottom: 8 },
  statusLabel: { fontWeight: "700", color: "#1A1A1A" },
  statusValue: { fontWeight: "600" },
  statusPending: { color: "#E67E22" },
  statusApproved: { color: "#27AE60" },
  statusRejected: { color: "#C0392B" },

  checkReportBtn: {
    alignSelf: "flex-start",
    backgroundColor: "#F5C518",
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
  },
  checkReportText: { fontSize: 12, fontWeight: "700", color: "#1A1A1A" },

  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1A1A1A",
    marginBottom: 8,
  },
  resetActionsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
  },
  resolveResetBtn: {
    alignSelf: "flex-start",
    backgroundColor: "#EBEBEB",
    borderWidth: 1,
    borderColor: "#B5B5B5",
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
  },
  resolveResetBtnText: { fontSize: 12, fontWeight: "700", color: "#1A1A1A" },

  empty: { alignItems: "center", paddingTop: 80 },
  emptyText: { fontSize: 15, color: "#888888" },
});
