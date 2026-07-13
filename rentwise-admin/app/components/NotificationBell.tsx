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
      createdAt?: any;
    };

function formatDate(date: any) {
  if (!date) return "-";
  const d = date.toDate ? date.toDate() : new Date(date);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
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
              createdAt: r.createdAt,
            }));
          setMessageItems(items);
        },
        (err) => console.error("NotificationBell messages error:", err),
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
              <Text style={styles.title}>Notifications</Text>
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
                        {r.kind === "passwordReset" ? (
                          <>
                            <Text style={styles.itemTitle}>
                              Password reset — {r.tenantName || "Unknown tenant"}
                            </Text>
                            <Text style={styles.itemSub}>{r.email}</Text>
                            <Text style={styles.itemSub}>
                              Space: {r.spaceId || "—"}
                            </Text>
                          </>
                        ) : (
                          <Text style={styles.itemTitle}>{renderMessage(r.message)}</Text>
                        )}
                      </View>
                      <View style={styles.itemFooter}>
                        <Text style={styles.itemDate}>
                          {formatDate(r.createdAt)}
                        </Text>
                        {r.kind === "message" && r.fromOwner ? null : r.resolved ? (
                          <View style={styles.resolvedTag}>
                            <Text style={styles.resolvedTagText}>Resolved</Text>
                          </View>
                        ) : (
                        <View style={styles.itemActions}>
                          {r.kind === "passwordReset" && (
                            <TouchableOpacity
                              style={styles.goToTenantBtn}
                              onPress={() => goToTenant(r)}
                            >
                              <Text style={styles.goToTenantBtnText}>
                                Reset
                              </Text>
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity
                            style={[
                              styles.resolveBtn,
                              resolvingId === r.id && styles.btnDisabled,
                            ]}
                            onPress={() => resolveItem(r)}
                            disabled={resolvingId === r.id}
                          >
                            {resolvingId === r.id ? (
                              <ActivityIndicator color={colors.emerald} size="small" />
                            ) : (
                              <Text style={styles.resolveBtnText}>
                                Mark resolved
                              </Text>
                            )}
                          </TouchableOpacity>
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
                {clearing ? (
                  <ActivityIndicator color={colors.emerald} size="small" />
                ) : (
                  <Text style={styles.btnOutlineText}>Clear All</Text>
                )}
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnPrimary,
                  pressed && styles.btnPrimaryPressed,
                ]}
                onPress={closeModal}
              >
                <Text style={styles.btnPrimaryText}>Close</Text>
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
    padding: spacing.xl,
  },

  card: {
    backgroundColor: colors.parchment,
    borderRadius: radius.xl + 4,
    borderWidth: 2,
    borderColor: colors.emeraldSoft,
    width: "100%",
    maxHeight: "90%",
    overflow: "hidden",
    ...shadow.raised,
  },

  titleBar: {
    backgroundColor: colors.emeraldSoft,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  title: {
    fontSize: fontSize.xxl,
    fontFamily: fontFamily.extrabold,
    color: colors.ink,
  },

  loadingBox: { paddingVertical: 48, alignItems: "center" },
  emptyBox: { paddingVertical: 48, alignItems: "center" },
  emptyBoxText: { fontSize: fontSize.base, fontFamily: fontFamily.regular, color: colors.textSecondary },

  scrollArea: { flexGrow: 0, maxHeight: 420 },
  scrollContent: { padding: spacing.lg, gap: spacing.md },

  item: {
    flexDirection: "row",
    borderRadius: radius.md,
    overflow: "hidden",
    ...shadow.subtle,
  },
  itemAccentBar: {
    width: 4,
    backgroundColor: colors.emerald,
  },
  itemAccentBarResolved: {
    backgroundColor: colors.border,
  },
  itemBody: {
    flex: 1,
    gap: spacing.sm + 2,
    backgroundColor: colors.white,
    padding: spacing.md + 2,
  },
  itemResolved: {
    opacity: 0.6,
  },
  itemFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  itemActions: {
    flexDirection: "row",
    gap: spacing.sm,
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
  goToTenantBtnText: { fontSize: fontSize.xs + 1, fontFamily: fontFamily.semibold, color: colors.white },
  itemTitle: { fontSize: fontSize.sm, fontFamily: fontFamily.regular, color: colors.ink, lineHeight: 19 },
  itemTitleBold: { fontFamily: fontFamily.bold, color: colors.ink },
  itemSub: { fontSize: fontSize.xs + 1, fontFamily: fontFamily.regular, color: colors.textSecondary, marginTop: 2 },
  itemDate: { fontSize: fontSize.xs, fontFamily: fontFamily.medium, color: colors.textMuted },
  resolveBtn: {
    borderWidth: 1.5,
    borderColor: colors.emerald,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md + 2,
  },
  resolveBtnText: { fontSize: fontSize.xs + 1, fontFamily: fontFamily.semibold, color: colors.emerald },

  btnRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.sm + 2,
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  btn: {
    flex: 1,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  btnOutline: { borderWidth: 1.5, borderColor: colors.emerald, backgroundColor: colors.white },
  btnOutlinePressed: {
    backgroundColor: colors.emeraldSoft,
    transform: [{ scale: 0.96 }],
  },
  btnOutlineText: { fontSize: fontSize.base, fontFamily: fontFamily.semibold, color: colors.emerald },
  btnDisabledOutline: { opacity: 0.4 },
  btnPrimary: { backgroundColor: colors.ink, ...shadow.button },
  btnPrimaryPressed: { backgroundColor: colors.emerald, transform: [{ scale: 0.96 }] },
  btnPrimaryText: { fontSize: fontSize.base, fontFamily: fontFamily.bold, color: colors.white },
  btnDisabled: { opacity: 0.5 },
});
