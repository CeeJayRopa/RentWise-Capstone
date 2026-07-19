import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
  TextInput,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Timestamp } from "firebase/firestore";

import { House, HelpCircle, Archive as ArchiveIcon, RotateCcw, Trash2, Search, Building2, DoorOpen } from "lucide-react-native";

import { auth } from "../../shared/services/auth";
import { db } from "../../shared/services/firestore";
import {
  restoreTenant,
  deleteArchivedTenant,
} from "../../shared/services/accountServices";

import HelpTour, { HelpStep } from "../components/HelpTour";
import OwnerBellIcon from "../components/OwnerBellIcon";
import { hasSeenPageTour, markPageTourSeen } from "../../shared/services/onboardingTour";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";

type ArchiveEntry = {
  uid: string;
  firstName: string;
  lastName: string;
  email: string;
  contactNo: string;
  buildingNumber: string;
  spaceId: string;
  stallId: string;
  archivedAt: Timestamp | null;
};

function formatDate(ts: Timestamp | null): string {
  if (!ts) return '—';
  const d = ts.toDate();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export default function Archives() {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [archives, setArchives] = useState<ArchiveEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const [confirmTarget, setConfirmTarget] = useState<ArchiveEntry | null>(null);
  const [checkingStallId, setCheckingStallId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<ArchiveEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [tourVisible, setTourVisible] = useState(false);
  const homeRef = useRef<View>(null);
  const bellRef = useRef<View>(null);
  const countRef = useRef<View>(null);
  const searchRef = useRef<View>(null);
  const cardRef = useRef<View>(null);
  const restoreBtnRef = useRef<View>(null);
  const deleteBtnRef = useRef<View>(null);

  const tourSteps: HelpStep[] = [
    { key: "home", ref: homeRef, title: "Home", description: "Takes you back to the dashboard.", edgeInset: "top", round: true },
    { key: "bell", ref: bellRef, title: "Notifications", description: "Shows admin updates waiting for your review, like payments and building changes.", edgeInset: "top", round: true },
    { key: "count", ref: countRef, title: "Archived count", description: "Total number of tenant accounts currently archived.", edgeInset: "top" },
    { key: "search", ref: searchRef, title: "Search", description: "Find an archived tenant fast by typing their name.", edgeInset: "top" },
    { key: "card", ref: cardRef, title: "Archived tenant", description: "Shows who was archived, when, and their building/space.", edgeInset: "top" },
    { key: "restore", ref: restoreBtnRef, title: "Restore", description: "Brings the tenant's account back to active. If their old stall is occupied, you'll be asked to relocate them first.", edgeInset: "top" },
    { key: "delete", ref: deleteBtnRef, title: "Delete", description: "Permanently removes the account and its data — this can't be undone.", edgeInset: "top" },
  ];

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, "archives"));
      const entries: ArchiveEntry[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          uid: d.id,
          firstName: (data.firstName as string) ?? "",
          lastName: (data.lastName as string) ?? "",
          email:
            (data.email as string) ||
            (data.username ? `${data.username}@rentwise.app` : "") ||
            (data.userName as string) ||
            "",
          contactNo: (data.contactNo as string) ?? "",
          buildingNumber: (data.buildingNumber as string) ?? "",
          spaceId: (data.spaceId as string) ?? "",
          stallId: (data.stallId as string) ?? "",
          archivedAt: (data.archivedAt as Timestamp) ?? null,
        };
      });
      entries.sort((a, b) => {
        if (!a.archivedAt) return 1;
        if (!b.archivedAt) return -1;
        return b.archivedAt.seconds - a.archivedAt.seconds;
      });
      setArchives(entries);
    } catch (err) {
      console.error("OWNER ARCHIVES ERROR:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) { router.replace("/login"); return; }
      setChecking(false);
      fetchData();
    });
    return unsub;
  }, [fetchData]);

  // Auto-opens the guided tour the first time the owner ever lands on this
  // page — never again after that, since it flips a persisted per-device
  // flag. Can still be replayed anytime via the Help button.
  useEffect(() => {
    if (checking) return;
    (async () => {
      const seen = await hasSeenPageTour("owner-archives");
      if (!seen) {
        setTourVisible(true);
        await markPageTourSeen("owner-archives");
      }
    })();
  }, [checking]);

  useFocusEffect(useCallback(() => { if (!checking) fetchData(); }, [checking, fetchData]));

  const handleRestorePress = async (item: ArchiveEntry) => {
    setRestoreError("");
    if (item.stallId) {
      setCheckingStallId(item.uid);
      try {
        const stallSnap = await getDoc(doc(db, "stalls", item.stallId));
        if (stallSnap.exists() && stallSnap.data().status === "occupied") {
          router.push({
            pathname: "/tenant-relocation",
            params: {
              uid: item.uid,
              firstName: item.firstName,
              lastName: item.lastName,
              email: item.email,
              buildingNumber: item.buildingNumber,
              spaceId: item.spaceId,
              stallId: item.stallId,
            },
          } as any);
          return;
        }
      } catch {
        setRestoreError("Could not check stall availability. Try again.");
        return;
      } finally {
        setCheckingStallId(null);
      }
    }
    setConfirmTarget(item);
  };

  const handleRestore = async () => {
    if (!confirmTarget) return;
    setRestoring(true);
    setRestoreError("");
    try {
      await restoreTenant(confirmTarget.uid);
      setConfirmTarget(null);
      fetchData();
    } catch {
      setRestoreError("Failed to restore. Please try again.");
    } finally {
      setRestoring(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteArchivedTenant(deleteTarget.uid);
      setDeleteTarget(null);
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      setDeleteError(msg);
    } finally {
      setDeleting(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const filteredArchives = archives.filter((item) =>
    `${item.firstName} ${item.lastName}`.toLowerCase().includes(searchQuery.trim().toLowerCase()),
  );

  if (checking) {
    return <View style={styles.fullCenter}><ActivityIndicator color={colors.emerald} size="large" /></View>;
  }

  return (
    <View style={styles.screen}>
      {/* Header */}
      <LinearGradient
        colors={[colors.emerald, colors.ink]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
          <View ref={homeRef} collapsable={false}>
            <TouchableOpacity onPress={() => router.push("/dashboard")} activeOpacity={0.7} style={styles.headerIconBtn}>
              <House size={24} color={colors.emeraldSoft} />
            </TouchableOpacity>
          </View>
          <Text style={styles.headerTitle}>RentWise</Text>
          <View style={styles.headerRight}>
            <View ref={bellRef} collapsable={false}>
              <OwnerBellIcon />
            </View>
            <TouchableOpacity onPress={() => setTourVisible(true)} activeOpacity={0.7} style={styles.headerIconBtn}>
              <HelpCircle size={24} color={colors.emeraldSoft} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Sub-header */}
        <View style={styles.subHeader}>
          <Text style={styles.pageTitle}>Account Archives</Text>
          <View style={styles.countPill} ref={countRef} collapsable={false}>
            <Text style={styles.countPillText}>{archives.length} Archived</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.searchWrap} ref={searchRef} collapsable={false}>
        <View style={styles.searchIconCircle}>
          <Search size={16} color={colors.emerald} />
        </View>
        <TextInput
          style={styles.searchInput}
          placeholder="Search archived tenants"
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.emerald} size="large" style={styles.loader} />
      ) : archives.length === 0 ? (
        <View style={styles.emptyBox}>
          <ArchiveIcon size={40} color={colors.emeraldSoft} style={{ marginBottom: 10 }} />
          <Text style={styles.emptyText}>No archived accounts.</Text>
        </View>
      ) : filteredArchives.length === 0 ? (
        <View style={styles.emptyBox}>
          <Search size={40} color={colors.emeraldSoft} style={{ marginBottom: 10 }} />
          <Text style={styles.emptyText}>No tenants match your search.</Text>
        </View>
      ) : (
        <FlatList
          data={filteredArchives}
          keyExtractor={(item) => item.uid}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />
          }
          renderItem={({ item, index }) => (
            <View style={styles.card} ref={index === 0 ? cardRef : undefined} collapsable={false}>
              <View style={styles.cardTopRow}>
                <Text style={styles.cardName} numberOfLines={1} ellipsizeMode="tail">
                  {item.firstName} {item.lastName}
                </Text>
                <View style={styles.archivedInfo}>
                  <Text style={styles.archivedCaption}>Archived</Text>
                  <Text style={styles.archivedDate}>{formatDate(item.archivedAt)}</Text>
                </View>
              </View>

              <View style={styles.tagsRow}>
                <View style={styles.tagPill}>
                  <Building2 size={12} color={colors.emerald} />
                  <Text style={styles.tagPillText}>Building {item.buildingNumber}</Text>
                </View>
                <View style={styles.tagPill}>
                  <DoorOpen size={12} color={colors.emerald} />
                  <Text style={styles.tagPillText}>Space {item.spaceId}</Text>
                </View>
              </View>

              <View style={styles.cardDivider} />

              <View style={styles.cardActions}>
                <View ref={index === 0 ? restoreBtnRef : undefined} collapsable={false} style={{ flex: 1 }}>
                  <Pressable
                    style={styles.restoreBtn}
                    onPress={() => handleRestorePress(item)}
                    disabled={checkingStallId === item.uid}
                  >
                    {checkingStallId === item.uid ? (
                      <ActivityIndicator color={colors.emerald} size="small" />
                    ) : (
                      <>
                        <RotateCcw size={15} color={colors.emerald} style={styles.btnIcon} />
                        <Text style={styles.restoreBtnText}>Restore</Text>
                      </>
                    )}
                  </Pressable>
                </View>

                <View style={styles.actionsVDivider} />

                <View ref={index === 0 ? deleteBtnRef : undefined} collapsable={false} style={{ flex: 1 }}>
                  <Pressable
                    style={styles.deleteBtn}
                    onPress={() => { setDeleteError(""); setDeleteTarget(item); }}
                  >
                    <Trash2 size={15} color={colors.error} style={styles.btnIcon} />
                    <Text style={styles.deleteBtnText}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}
        />
      )}

      {/* RESTORE CONFIRMATION MODAL */}
      <Modal
        visible={!!confirmTarget}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!restoring) setConfirmTarget(null); }}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => { if (!restoring) setConfirmTarget(null); }}
          />
          {confirmTarget && (
            <View style={styles.modalCard}>
              <View style={styles.modalTitleBar}>
                <Text style={styles.modalTitle}>Restore account?</Text>
              </View>
              <View style={styles.modalBody}>
                <Text style={styles.modalMessage}>
                  This will restore the tenant's account and they will regain access to the app.
                </Text>
                {restoreError ? (
                  <Text style={styles.modalError}>{restoreError}</Text>
                ) : null}
                <View style={styles.modalBtns}>
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.modalBtnOutline]}
                    onPress={() => setConfirmTarget(null)}
                    activeOpacity={0.7}
                    disabled={restoring}
                  >
                    <Text style={styles.modalBtnOutlineText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.modalBtn,
                      styles.modalBtnPrimary,
                      restoring && styles.modalBtnDisabled,
                    ]}
                    onPress={handleRestore}
                    activeOpacity={0.8}
                    disabled={restoring}
                  >
                    {restoring ? (
                      <ActivityIndicator color={colors.white} size="small" />
                    ) : (
                      <Text style={styles.modalBtnPrimaryText}>Restore</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* DELETE CONFIRMATION MODAL */}
      <Modal
        visible={!!deleteTarget}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!deleting) setDeleteTarget(null); }}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => { if (!deleting) setDeleteTarget(null); }}
          />
          {deleteTarget && (
            <View style={styles.modalCard}>
              <View style={styles.modalTitleBar}>
                <Text style={styles.modalTitle}>Permanently delete?</Text>
              </View>
              <View style={styles.modalBody}>
                <Text style={styles.modalMessage}>
                  This action cannot be undone. The tenant's account and all data will be permanently removed.
                </Text>
                {deleteError ? (
                  <Text style={styles.modalError}>{deleteError}</Text>
                ) : null}
                <View style={styles.modalBtns}>
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.modalBtnOutline]}
                    onPress={() => setDeleteTarget(null)}
                    activeOpacity={0.7}
                    disabled={deleting}
                  >
                    <Text style={styles.modalBtnOutlineText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.modalBtn,
                      styles.modalBtnDanger,
                      deleting && styles.modalBtnDisabled,
                    ]}
                    onPress={handleDelete}
                    activeOpacity={0.8}
                    disabled={deleting}
                  >
                    {deleting ? (
                      <ActivityIndicator color={colors.white} size="small" />
                    ) : (
                      <Text style={styles.modalBtnDangerText}>Delete</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </View>
      </Modal>
      <HelpTour visible={tourVisible} steps={tourSteps} onClose={() => setTourVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.parchment },
  fullCenter: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.parchment },

  headerGradient: {
    borderBottomLeftRadius: radius.xl + 4,
    borderBottomRightRadius: radius.xl + 4,
    overflow: "hidden",
  },

  header: {
    paddingBottom: spacing.md + 2,
    paddingHorizontal: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerRight: { flexDirection: "row", alignItems: "center", gap: spacing.md + 2 },
  headerIconBtn: {
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
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
    color: colors.white,
    textAlign: "center",
  },

  subHeader: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pageTitle: { fontSize: fontSize.md, fontFamily: fontFamily.semibold, color: colors.white },
  countPill: {
    backgroundColor: "rgba(255,255,255,0.16)",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  countPillText: { fontSize: fontSize.xs + 1, fontFamily: fontFamily.semibold, color: colors.emeraldSoft },

  loader: { marginTop: 60 },

  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm + 2 },

  emptyBox: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  emptyText: { fontSize: fontSize.base, color: colors.textSecondary, fontFamily: fontFamily.regular, textAlign: "center" },

  // ── Search bar ──────────────────────────────────────────────────────────────

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
  },
  searchIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.emeraldSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    color: colors.ink,
    padding: 0,
  },

  // ── Archive card ────────────────────────────────────────────────────────────

  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },

  cardTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  cardName: { fontSize: fontSize.base, fontFamily: fontFamily.bold, color: colors.ink, flex: 1 },

  archivedInfo: { alignItems: "flex-end" },
  archivedCaption: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.bold,
    color: colors.emerald,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  archivedDate: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginTop: 2,
  },

  tagsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  tagPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.emeraldSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
  },
  tagPillText: {
    fontSize: fontSize.xs + 1,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },

  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },

  cardActions: {
    flexDirection: "row",
    alignItems: "center",
  },

  actionsVDivider: {
    width: StyleSheet.hairlineWidth,
    height: 18,
    backgroundColor: colors.border,
  },

  btnIcon: {
    marginRight: 6,
  },

  restoreBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
  },
  restoreBtnText: {
    color: colors.emerald,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    textAlign: "center",
  },

  deleteBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
  },
  deleteBtnText: {
    color: colors.error,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    textAlign: "center",
  },

  // ── Confirmation modals ───────────────────────────────────────────────────────

  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xxl,
  },

  modalCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    width: "100%",
    overflow: "hidden",
    ...shadow.raised,
  },

  modalTitleBar: {
    backgroundColor: colors.emeraldSoft,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },

  modalTitle: {
    fontSize: fontSize.lg - 1,
    fontFamily: fontFamily.bold,
    color: colors.emerald,
  },

  modalBody: {
    padding: spacing.xl,
  },

  modalMessage: {
    fontSize: fontSize.base,
    color: colors.textSecondary,
    fontFamily: fontFamily.regular,
    lineHeight: 22,
    marginBottom: spacing.xl,
  },

  modalError: {
    fontSize: fontSize.sm,
    color: colors.error,
    fontFamily: fontFamily.medium,
    marginBottom: spacing.md,
    textAlign: "center",
  },

  modalBtns: {
    flexDirection: "row",
    gap: spacing.sm + 2,
  },

  modalBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },

  modalBtnOutline: {
    borderWidth: 1.5,
    borderColor: colors.emerald,
  },

  modalBtnOutlineText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },

  modalBtnPrimary: {
    backgroundColor: colors.emerald,
  },

  modalBtnPrimaryText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    color: colors.white,
  },

  modalBtnDanger: {
    backgroundColor: colors.error,
  },

  modalBtnDangerText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    color: colors.white,
  },

  modalBtnDisabled: {
    opacity: 0.5,
  },
});
