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
import { router } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, getDoc, getDocs, onSnapshot } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Timestamp } from "firebase/firestore";

import { House, HelpCircle, Archive as ArchiveIcon, ArchiveRestore, Search, Store, RefreshCw } from "lucide-react-native";

import { auth } from "../../shared/services/auth";
import { db } from "../../shared/services/firestore";
import { restoreTenant } from "../../shared/services/accountServices";

import HelpTour, { HelpStep } from "../components/HelpTour";
import HelpSupportModal from "../components/HelpSupportModal";
import OwnerBellIcon from "../components/OwnerBellIcon";
import { hasSeenPageTour, markPageTourSeen } from "../../shared/services/onboardingTour";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";
import { readLocalCache, saveLocalCache } from "../../shared/services/localCache";
import { requireOnlineAction } from "../../shared/services/networkStatus";

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

  const [tourVisible, setTourVisible] = useState(false);
  const [helpSupportVisible, setHelpSupportVisible] = useState(false);
  const homeRef = useRef<View>(null);
  const bellRef = useRef<View>(null);
  const countRef = useRef<View>(null);
  const searchRef = useRef<View>(null);
  const cardRef = useRef<View>(null);
  const restoreBtnRef = useRef<View>(null);

  const tourSteps: HelpStep[] = [
    { key: "home", ref: homeRef, title: "Home", description: "Takes you back to the dashboard.", edgeInset: "top", round: true },
    { key: "bell", ref: bellRef, title: "Notifications", description: "Shows admin updates waiting for your review, like payments and building changes.", edgeInset: "top", round: true },
    { key: "count", ref: countRef, title: "Archived count", description: "Total number of tenant accounts currently archived.", edgeInset: "top" },
    { key: "search", ref: searchRef, title: "Search", description: "Find an archived tenant fast by typing their name.", edgeInset: "top" },
    { key: "card", ref: cardRef, title: "Archived tenant", description: "Shows who was archived, when, and their building/space.", edgeInset: "top" },
    { key: "restore", ref: restoreBtnRef, title: "Restore", description: "Brings the tenant's account back to active. If their old stall is occupied, you'll be asked to relocate them first.", edgeInset: "top" },
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
      await saveLocalCache("owner:archives", entries);
    } catch (err) {
      console.error("OWNER ARCHIVES ERROR:", err);
      const cached = await readLocalCache<ArchiveEntry[]>("owner:archives");
      if (cached) setArchives(cached);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) { router.replace("/login"); return; }
      setChecking(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (checking || !auth.currentUser) return;

    const unsubscribe = onSnapshot(
      collection(db, "archives"),
      (snapshot) => {
        const entries: ArchiveEntry[] = snapshot.docs.map((archiveDoc) => {
          const data = archiveDoc.data();
          return {
            uid: archiveDoc.id,
            firstName: data.firstName ?? "",
            lastName: data.lastName ?? "",
            email: data.email || (data.username ? `${data.username}@rentwise.app` : "") || data.userName || "",
            contactNo: data.contactNo ?? "",
            buildingNumber: data.buildingNumber ?? "",
            spaceId: data.spaceId ?? "",
            stallId: data.stallId ?? "",
            archivedAt: data.archivedAt ?? null,
          };
        });
        entries.sort((a, b) => {
          if (!a.archivedAt) return 1;
          if (!b.archivedAt) return -1;
          return b.archivedAt.seconds - a.archivedAt.seconds;
        });
        setArchives(entries);
        setLoading(false);
      },
      (error) => {
        console.error("OWNER ARCHIVES LISTENER ERROR:", error);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [checking]);

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
    if (!(await requireOnlineAction("Restoring a tenant"))) return;
    setRestoring(true);
    setRestoreError("");
    try {
      await restoreTenant(confirmTarget.uid);
      setConfirmTarget(null);
      fetchData();
    } catch (err: any) {
      if (["functions/already-exists", "functions/failed-precondition", "functions/not-found"].includes(err?.code)) {
        setConfirmTarget(null);
        router.push({
          pathname: "/tenant-relocation",
          params: {
            uid: confirmTarget.uid,
            firstName: confirmTarget.firstName,
            lastName: confirmTarget.lastName,
            email: confirmTarget.email,
            buildingNumber: confirmTarget.buildingNumber,
            spaceId: confirmTarget.spaceId,
            stallId: confirmTarget.stallId,
          },
        } as any);
      } else {
        setRestoreError("Failed to restore. Please try again.");
      }
    } finally {
      setRestoring(false);
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
            <TouchableOpacity onPress={() => setHelpSupportVisible(true)} activeOpacity={0.7} style={styles.headerIconBtn}>
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
        <Search size={20} color={colors.textSecondary} />
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
          <TouchableOpacity style={styles.emptyReloadButton} onPress={onRefresh} disabled={refreshing}>
            {refreshing ? <ActivityIndicator size="small" color={colors.emerald} /> : <RefreshCw size={14} color={colors.emerald} />}
            <Text style={styles.emptyReloadText}>{refreshing ? "Syncing…" : "Tap to re-sync"}</Text>
          </TouchableOpacity>
        </View>
      ) : filteredArchives.length === 0 ? (
        <View style={styles.emptyBox}>
          <Search size={40} color={colors.emeraldSoft} style={{ marginBottom: 10 }} />
          <Text style={styles.emptyText}>No tenants match your search.</Text>
          <TouchableOpacity style={styles.emptyReloadButton} onPress={onRefresh} disabled={refreshing}>
            {refreshing ? <ActivityIndicator size="small" color={colors.emerald} /> : <RefreshCw size={14} color={colors.emerald} />}
            <Text style={styles.emptyReloadText}>{refreshing ? "Syncing…" : "Reload archives"}</Text>
          </TouchableOpacity>
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
              <View style={styles.cardMain}>
                <View style={styles.vaultedRow}><View style={styles.vaultedDot} /><Text style={styles.vaultedText}>Vaulted Record</Text></View>
                <Text style={styles.cardName} numberOfLines={2} ellipsizeMode="tail">
                  {item.firstName} {item.lastName}
                </Text>
                <View style={styles.locationRow}>
                  <Store size={15} color={colors.emerald} />
                  <Text style={styles.locationText}>Building {item.buildingNumber} · Space {item.spaceId}</Text>
                </View>
              </View>
              <View style={styles.cardSide}>
                <View style={styles.archivedInfo}>
                  <Text style={styles.archivedCaption}>Deactivated</Text>
                  <Text style={styles.archivedDate}>{formatDate(item.archivedAt)}</Text>
                </View>
                <View ref={index === 0 ? restoreBtnRef : undefined} collapsable={false}>
                  <Pressable
                    style={({ pressed }) => [styles.restoreBtn, pressed && styles.restoreBtnPressed]}
                    onPress={() => handleRestorePress(item)}
                    disabled={checkingStallId === item.uid}
                  >
                    {({ pressed }) =>
                      checkingStallId === item.uid ? (
                        <ActivityIndicator color={colors.emerald} size="small" />
                      ) : (
                        <>
                          <ArchiveRestore size={16} color={pressed ? colors.white : colors.emerald} style={styles.btnIcon} />
                          <Text style={[styles.restoreBtnText, pressed && styles.restoreBtnTextPressed]}>Restore</Text>
                        </>
                      )
                    }
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
                  <Pressable
                    style={({ pressed }) => [styles.modalBtn, styles.modalBtnOutline, pressed && styles.modalBtnOutlinePressed]}
                    onPress={() => setConfirmTarget(null)}
                    disabled={restoring}
                  >
                    {({ pressed }) => (
                      <Text style={[styles.modalBtnOutlineText, pressed && styles.modalBtnOutlineTextPressed]}>Cancel</Text>
                    )}
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.modalBtn,
                      styles.modalBtnPrimary,
                      restoring && styles.modalBtnDisabled,
                      pressed && !restoring && styles.modalBtnPrimaryPressed,
                    ]}
                    onPress={handleRestore}
                    disabled={restoring}
                  >
                    {({ pressed }) =>
                      restoring ? (
                        <ActivityIndicator color={colors.white} size="small" />
                      ) : (
                        <Text style={[styles.modalBtnPrimaryText, pressed && styles.modalBtnPrimaryTextPressed]}>Restore</Text>
                      )
                    }
                  </Pressable>
                </View>
              </View>
            </View>
          )}
        </View>
      </Modal>

      <HelpTour visible={tourVisible} steps={tourSteps} onClose={() => setTourVisible(false)} />
      <HelpSupportModal visible={helpSupportVisible} steps={tourSteps} onClose={() => setHelpSupportVisible(false)} onReplayTour={() => setTourVisible(true)} />
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

  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: 12 },

  emptyBox: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  emptyText: { fontSize: fontSize.base, color: colors.textSecondary, fontFamily: fontFamily.regular, textAlign: "center" },
  emptyReloadButton: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 14, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.mist },
  emptyReloadText: { fontSize: fontSize.xs, color: colors.emerald, fontFamily: fontFamily.semibold },

  // ── Search bar ──────────────────────────────────────────────────────────────

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: fontFamily.regular,
    color: colors.ink,
    padding: 0,
  },

  // ── Archive card ────────────────────────────────────────────────────────────

  card: {
    backgroundColor: colors.white,
    borderRadius: 18,
    flexDirection: "row",
    overflow: "hidden",
    minHeight: 122,
    ...shadow.card,
  },

  cardMain: { flex: 1, paddingHorizontal: 15, paddingVertical: 13, justifyContent: "space-between" },
  cardSide: { width: 116, padding: 9, backgroundColor: "#FAFAF9", justifyContent: "space-between", alignItems: "center" },
  vaultedRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  vaultedDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#77817D" },
  vaultedText: { fontSize: 10, fontFamily: fontFamily.semibold, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.3 },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 9 },
  locationText: { fontSize: 11, fontFamily: fontFamily.regular, color: colors.ink },

  cardTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  cardName: { fontSize: 17, lineHeight: 21, fontFamily: fontFamily.semibold, color: colors.ink, marginTop: 4 },

  archivedInfo: { alignItems: "flex-start", width: "100%", paddingHorizontal: 5, paddingTop: 4 },
  archivedCaption: {
    fontSize: 10,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  archivedDate: {
    fontSize: 12,
    fontFamily: fontFamily.semibold,
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

  btnIcon: {
    marginRight: 6,
  },

  restoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: 96,
    minHeight: 44,
    paddingVertical: 9,
    borderRadius: 11,
    backgroundColor: "#9EF2D4",
  },
  restoreBtnPressed: {
    backgroundColor: colors.emerald,
  },
  restoreBtnText: {
    color: colors.emerald,
    fontSize: 12,
    fontFamily: fontFamily.medium,
    textAlign: "center",
  },
  restoreBtnTextPressed: {
    color: colors.white,
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
  modalBtnOutlinePressed: {
    backgroundColor: colors.emerald,
  },

  modalBtnOutlineText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },
  modalBtnOutlineTextPressed: {
    color: colors.white,
  },

  modalBtnPrimary: {
    backgroundColor: colors.emerald,
  },
  modalBtnPrimaryPressed: {
    backgroundColor: colors.white,
  },

  modalBtnPrimaryText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    color: colors.white,
  },
  modalBtnPrimaryTextPressed: {
    color: colors.emerald,
  },

  modalBtnDanger: {
    backgroundColor: colors.error,
  },
  modalBtnDangerPressed: {
    backgroundColor: colors.white,
  },

  modalBtnDangerText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    color: colors.white,
  },
  modalBtnDangerTextPressed: {
    color: colors.error,
  },

  modalBtnDisabled: {
    opacity: 0.5,
  },
});
