import { useEffect, useState } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { collection, doc, onSnapshot, query, updateDoc, where, writeBatch } from "firebase/firestore";
import { Bell } from "lucide-react-native";
import { router } from "expo-router";

import { db } from "../../shared/services/firestore";
import { auth } from "../../shared/services/auth";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";

type BellItem =
  | {
      id: string;
      kind: "passwordReset";
      resolved: boolean;
      tenantId?: string;
      tenantName?: string;
      email?: string;
      spaceId?: string;
      createdAt?: any;
    }
  | {
      id: string;
      kind: "message";
      resolved: boolean;
      message: string;
      fromOwner?: boolean;
      route?: string;
      tenantId?: string;
      paymentId?: string;
      updateId?: string;
      createdAt?: any;
    };

function formatDate(date: any) {
  if (!date) return "-";
  const d = date.toDate ? date.toDate() : new Date(date);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function formatTime(date: any) {
  if (!date) return "";
  const d = date.toDate ? date.toDate() : new Date(date);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

// Renders `**bold**` segments within a plain-text message (e.g. tenant name,
// payment amount) as bold spans, without pulling in a markdown library.
function renderMessage(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <Text key={i} style={styles.itemTitleBold}>
        {part.slice(2, -2)}
      </Text>
    ) : (
      <Text key={i}>{part}</Text>
    ),
  );
}

export default function NotificationBell({ color = colors.emeraldSoft }: { color?: string }) {
  const [visible, setVisible] = useState(false);
  const [passwordResetItems, setPasswordResetItems] = useState<BellItem[]>([]);
  const [messageItems, setMessageItems] = useState<BellItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  // Live listeners — keep the bell badge and list current even while the
  // modal is closed, instead of only refreshing at the moment it's opened.
  useEffect(() => {
    const unsubPasswordResets = onSnapshot(
      collection(db, "passwordResetRequests"),
      (snap) => {
        const items: BellItem[] = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as any)
          // Admin-targeted requests (admin forgot their own password) go to
          // the owner instead — see rentwise-owner/app/notifications.tsx.
          // Resolved requests stay visible (tagged, action-less) instead of
          // vanishing immediately, so "Clear All" has something to clear.
          .filter((r: any) => r.requestedRole !== "admin")
          .map((r: any) => ({
            id: r.id,
            kind: "passwordReset" as const,
            resolved: r.status !== "pending",
            tenantId: r.tenantId,
            tenantName: r.tenantName,
            email: r.email,
            spaceId: r.spaceId,
            createdAt: r.createdAt,
          }));
        setPasswordResetItems(items);
        setLoading(false);
      },
      (err) => {
        if (!auth.currentUser) return;
        console.error("NotificationBell passwordResets error:", err);
        setLoading(false);
      },
    );

    const uid = auth.currentUser?.uid;
    let unsubMessages = () => {};
    if (uid) {
      unsubMessages = onSnapshot(
        query(collection(db, "notifications"), where("userId", "==", uid)),
        (snap) => {
          const items: BellItem[] = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as any)
            .map((r: any) => ({
              id: r.id,
              kind: "message" as const,
              // Owner acknowledgements are informational only — nothing for
              // the admin to act on, so treat them as already resolved.
              resolved: r.read === true || r.fromOwner === true,
              message: r.message,
              fromOwner: r.fromOwner === true,
              route: r.route,
              tenantId: r.tenantId,
              paymentId: r.paymentId,
              updateId: r.updateId,
              createdAt: r.createdAt,
            }));
          setMessageItems(items);
        },
        (err) => {
          if (!auth.currentUser) return;
          console.error("NotificationBell messages error:", err);
        },
      );
    }

    return () => {
      unsubPasswordResets();
      unsubMessages();
    };
  }, []);

  const requests = [...passwordResetItems, ...messageItems].sort((a, b) => {
    // Unresolved items first (need attention), each group newest-first.
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
    const aTs = a.createdAt?.seconds ?? 0;
    const bTs = b.createdAt?.seconds ?? 0;
    return bTs - aTs;
  });
  const pendingCount = requests.filter((r) => !r.resolved).length;

  const openModal = () => setVisible(true);
  const closeModal = () => setVisible(false);

  const goToTenant = (item: BellItem) => {
    if (item.kind !== "passwordReset") return;
    closeModal();
    router.push({
      pathname: "/tenant-management",
      params: { tenantId: item.tenantId ?? "" },
    } as any);
  };

  const openNotificationDestination = async (item: BellItem) => {
    if (item.kind === "passwordReset") {
      goToTenant(item);
      return;
    }
    const allowedRoutes = new Set(["/financials", "/building", "/tenant-management", "/reports-history"]);
    const fallbackRoute = item.fromOwner ? "/reports-history" : "/financials";
    const destination = allowedRoutes.has(item.route ?? "") ? item.route! : fallbackRoute;
    closeModal();
    if (!item.resolved) {
      updateDoc(doc(db, "notifications", item.id), {read: true}).catch((error) =>
        console.error("mark notification read error:", error),
      );
    }
    router.push({
      pathname: destination as any,
      params: {
        ...(item.tenantId ? {tenantId: item.tenantId} : {}),
        ...(item.paymentId ? {paymentId: item.paymentId} : {}),
        ...(item.updateId ? {updateId: item.updateId} : {}),
        source: "notification",
      },
    } as any);
  };

  const resolveItem = async (item: BellItem) => {
    setResolvingId(item.id);
    try {
      if (item.kind === "passwordReset") {
        await updateDoc(doc(db, "passwordResetRequests", item.id), {
          status: "resolved",
        });
      } else {
        await updateDoc(doc(db, "notifications", item.id), {
          read: true,
        });
      }
      // Live listeners above will pick up the change automatically.
    } catch (err) {
      console.error("resolveItem error:", err);
      Alert.alert("Error", "Failed to update notification.");
    } finally {
      setResolvingId(null);
    }
  };

  const handleClearAll = () => {
    if (requests.length === 0 || pendingCount > 0) return;
    Alert.alert(
      "Clear Notifications",
      "Remove all resolved notifications from this list?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Clear All", style: "destructive", onPress: doClearAll },
      ],
    );
  };

  const doClearAll = async () => {
    setClearing(true);
    try {
      const batch = writeBatch(db);
      for (const item of requests) {
        batch.delete(
          doc(db, item.kind === "passwordReset" ? "passwordResetRequests" : "notifications", item.id),
        );
      }
      await batch.commit();
    } catch (err) {
      console.error("clearAll error:", err);
      Alert.alert("Error", "Failed to clear notifications.");
    } finally {
      setClearing(false);
    }
  };

  return (
    <>
      <TouchableOpacity
        style={styles.bellWrap}
        onPress={openModal}
        activeOpacity={0.7}
      >
        <View style={styles.bellBtn}>
          <Bell size={24} color={color} />
        </View>
        {pendingCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {pendingCount > 9 ? "9+" : pendingCount}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
      >
        <View style={styles.overlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={closeModal}
          />

          <View style={styles.card}>
            <View style={styles.titleBar}>
              <View style={styles.titleRow}>
                <Text style={styles.title}>Notifications</Text>
                {pendingCount > 0 && (
                  <View style={styles.titleBadge}>
                    <Text style={styles.titleBadgeText}>{pendingCount}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.subtitle}>Ka Domeng Talipapa • Admin Activity</Text>
            </View>

            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={colors.emerald} size="large" />
              </View>
            ) : requests.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyBoxText}>No new notifications.</Text>
              </View>
            ) : (
              <ScrollView
                style={styles.scrollArea}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
              >
                {requests.map((r) => (
                  <View key={r.id} style={styles.item}>
                    <View style={[styles.itemAccentBar, r.resolved && styles.itemAccentBarResolved]} />
                    <View style={[styles.itemBody, r.resolved && styles.itemResolved]}>
                      <View>
                        <View style={styles.activityHeader}>
                          <Text style={[styles.activityType, r.resolved && styles.activityTypeResolved]}>
                            {r.kind === "passwordReset" ? "ACCOUNT SECURITY" : r.fromOwner ? "OWNER ACTIVITY" : "PAYMENT ACTIVITY"}
                          </Text>
                          <Text style={styles.activityDate}>{formatDate(r.createdAt)}</Text>
                        </View>
                        {r.kind === "passwordReset" ? (
                          <>
                            <Text style={styles.itemTitle}>Password Reset Request</Text>
                            <Text style={styles.itemName}>{r.tenantName || "Unknown tenant"}</Text>
                            <Text style={styles.itemSub}>{r.email}</Text>
                            {!!r.spaceId && <Text style={styles.spaceChip}>Space {r.spaceId}</Text>}
                          </>
                        ) : (
                          <Text style={styles.itemTitle}>{renderMessage(r.message)}</Text>
                        )}
                      </View>
                      {!r.resolved && (
                        <View style={styles.pendingRow}>
                          <View style={styles.pendingDot} />
                          <Text style={styles.pendingText}>Awaiting confirmation</Text>
                          {!!formatTime(r.createdAt) && <Text style={styles.activityTime}>{formatTime(r.createdAt)}</Text>}
                        </View>
                      )}
                      <View style={styles.itemFooter}>
                        {r.kind === "message" && (
                          <Pressable
                            style={({ pressed }) => [styles.goToTenantBtn, pressed && styles.goToTenantBtnPressed]}
                            onPress={() => openNotificationDestination(r)}
                          >
                            {({ pressed }) => (
                              <Text style={[styles.goToTenantBtnText, pressed && styles.goToTenantBtnTextPressed]}>View</Text>
                            )}
                          </Pressable>
                        )}
                        {r.kind === "message" && r.fromOwner ? null : r.resolved ? (
                          <View style={styles.resolvedTag}>
                            <Text style={styles.resolvedTagText}>Resolved</Text>
                          </View>
                        ) : (
                        <View style={styles.itemActions}>
                          {r.kind === "passwordReset" && (
                            <Pressable
                              style={({ pressed }) => [styles.goToTenantBtn, pressed && styles.goToTenantBtnPressed]}
                              onPress={() => openNotificationDestination(r)}
                            >
                              {({ pressed }) => (
                                <Text style={[styles.goToTenantBtnText, pressed && styles.goToTenantBtnTextPressed]}>
                                  Open tenant
                                </Text>
                              )}
                            </Pressable>
                          )}
                          <Pressable
                            style={({ pressed }) => [
                              styles.resolveBtn,
                              resolvingId === r.id && styles.btnDisabled,
                              pressed && resolvingId !== r.id && styles.resolveBtnPressed,
                            ]}
                            onPress={() => resolveItem(r)}
                            disabled={resolvingId === r.id}
                          >
                            {({ pressed }) =>
                              resolvingId === r.id ? (
                                <ActivityIndicator color={colors.emerald} size="small" />
                              ) : (
                                <Text style={[styles.resolveBtnText, pressed && styles.resolveBtnTextPressed]}>
                                  ✓  Mark resolved
                                </Text>
                              )
                            }
                          </Pressable>
                        </View>
                        )}
                      </View>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}

            <View style={styles.btnRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnOutline,
                  (pendingCount > 0 || requests.length === 0 || clearing) && styles.btnDisabledOutline,
                  pressed && pendingCount === 0 && requests.length > 0 && !clearing && styles.btnOutlinePressed,
                ]}
                onPress={handleClearAll}
                disabled={pendingCount > 0 || requests.length === 0 || clearing}
              >
                {({ pressed }) =>
                  clearing ? (
                    <ActivityIndicator color={colors.emerald} size="small" />
                  ) : (
                    <Text style={[styles.btnOutlineText, pressed && styles.btnOutlineTextPressed]}>Clear All</Text>
                  )
                }
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnPrimary,
                  pressed && styles.btnPrimaryPressed,
                ]}
                onPress={closeModal}
              >
                {({ pressed }) => (
                  <Text style={[styles.btnPrimaryText, pressed && styles.btnPrimaryTextPressed]}>Close</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bellWrap: {
    width: 40,
    height: 40,
  },
  bellBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.16)",
    justifyContent: "center",
    alignItems: "center",
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

  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xl,
  },

  card: {
    backgroundColor: colors.white,
    borderRadius: radius.xl + 8,
    borderWidth: 1.5,
    borderColor: colors.ink,
    width: "100%",
    maxWidth: 390,
    maxHeight: "92%",
    overflow: "hidden",
    ...shadow.raised,
  },

  titleBar: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  title: {
    fontSize: 24,
    fontFamily: fontFamily.extrabold,
    color: colors.ink,
  },
  titleBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: colors.emerald,
    alignItems: "center",
    justifyContent: "center",
  },
  titleBadgeText: {
    color: colors.white,
    fontSize: 10,
    fontFamily: fontFamily.bold,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 10,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
  },

  loadingBox: { paddingVertical: 48, alignItems: "center" },
  emptyBox: { paddingVertical: 48, alignItems: "center" },
  emptyBoxText: { fontSize: fontSize.base, fontFamily: fontFamily.regular, color: colors.textSecondary },

  scrollArea: { flexGrow: 0, maxHeight: 500 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xl, gap: spacing.md },

  item: {
    flexDirection: "row",
    borderRadius: radius.lg,
    overflow: "hidden",
    ...shadow.subtle,
  },
  itemAccentBar: {
    width: 5,
    backgroundColor: colors.emerald,
  },
  itemAccentBarResolved: {
    backgroundColor: colors.border,
  },
  itemBody: {
    flex: 1,
    gap: spacing.sm + 2,
    backgroundColor: "#EEFBF5",
    padding: spacing.lg,
  },
  activityHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  activityType: {
    fontSize: 10,
    fontFamily: fontFamily.bold,
    color: colors.emerald,
    letterSpacing: 0.25,
  },
  activityTypeResolved: { color: colors.textSecondary },
  activityDate: {
    fontSize: 10,
    fontFamily: fontFamily.medium,
    color: colors.textPrimary,
  },
  activityTime: {
    marginLeft: "auto",
    fontSize: 10,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
  },
  pendingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pendingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#FF9800",
  },
  pendingText: {
    fontSize: 10,
    fontFamily: fontFamily.semibold,
    color: "#9A5200",
  },
  itemResolved: {
    opacity: 0.72,
    backgroundColor: colors.white,
  },
  itemFooter: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
  },
  itemActions: {
    flexDirection: "row",
    gap: spacing.sm,
    width: "100%",
  },
  resolvedTag: {
    backgroundColor: colors.mist,
    borderRadius: radius.sm - 2,
    paddingVertical: 4,
    paddingHorizontal: spacing.md - 2,
  },
  resolvedTagText: { fontSize: fontSize.xs, fontFamily: fontFamily.semibold, color: colors.textSecondary },
  goToTenantBtn: {
    backgroundColor: colors.emerald,
    borderRadius: radius.pill,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md + 2,
  },
  goToTenantBtnPressed: {
    backgroundColor: colors.white,
  },
  goToTenantBtnText: { fontSize: fontSize.xs + 1, fontFamily: fontFamily.semibold, color: colors.white },
  goToTenantBtnTextPressed: { color: colors.emerald },
  itemTitle: { fontSize: fontSize.sm, fontFamily: fontFamily.bold, color: colors.ink, lineHeight: 19 },
  itemTitleBold: { fontFamily: fontFamily.bold, color: colors.ink },
  itemName: { fontSize: fontSize.sm, fontFamily: fontFamily.bold, color: colors.ink, marginTop: 2 },
  itemSub: { fontSize: fontSize.xs + 1, fontFamily: fontFamily.regular, color: colors.textSecondary, marginTop: 2 },
  spaceChip: {
    alignSelf: "flex-start",
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: colors.white,
    fontSize: 10,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
  },
  itemDate: { fontSize: fontSize.xs, fontFamily: fontFamily.medium, color: colors.textMuted },
  resolveBtn: {
    borderWidth: 0,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minWidth: 150,
    flex: 1,
    alignItems: "center",
  },
  resolveBtnPressed: {
    backgroundColor: colors.emerald,
  },
  resolveBtnText: { fontSize: fontSize.xs + 1, fontFamily: fontFamily.semibold, color: colors.white },
  resolveBtnTextPressed: { color: colors.white },

  btnRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.sm + 2,
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  btn: {
    flex: 1,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 46,
  },
  btnOutline: { borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.white },
  btnOutlinePressed: {
    backgroundColor: colors.emerald,
    transform: [{ scale: 0.96 }],
  },
  btnOutlineText: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.ink },
  btnOutlineTextPressed: { color: colors.white },
  btnDisabledOutline: { opacity: 0.4 },
  btnPrimary: { backgroundColor: colors.ink, ...shadow.button },
  btnPrimaryPressed: { backgroundColor: colors.white, transform: [{ scale: 0.96 }] },
  btnPrimaryText: { fontSize: fontSize.sm, fontFamily: fontFamily.bold, color: colors.white },
  btnPrimaryTextPressed: { color: colors.ink },
  btnDisabled: { opacity: 0.5 },
});
