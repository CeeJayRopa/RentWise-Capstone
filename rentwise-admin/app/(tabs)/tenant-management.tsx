import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  StyleSheet,
  Alert,
  RefreshControl,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { House, HelpCircle, Users, Archive, AlertCircle } from "lucide-react-native";

import { auth } from "../../shared/services/auth";
import { db } from "../../shared/services/firestore";
import { archiveTenant } from "../../shared/services/accountServices";
import UpdatesReportFAB, { FAB_CLEARANCE } from "../components/UpdatesReportFAB";
import HelpTour, { HelpStep } from "../components/HelpTour";
import { hasSeenPageTour, markPageTourSeen } from "../../shared/services/onboardingTour";
import { Badge, EmptyState } from "../../shared/components/ui";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";

type Tenant = {
  uid: string;
  firstName: string;
  lastName: string;
  email: string;
  emailVerified: boolean;
  contactNo: string;
  stallId: string;
  buildingNumber: string;
  spaceId: string;
};

export default function TenantManagement() {
  const insets = useSafeAreaInsets();

  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);

  // Archive modal state
  const [archiveTarget, setArchiveTarget] = useState<Tenant | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const [tourVisible, setTourVisible] = useState(false);

  const homeRef = useRef<View>(null);
  const helpRef = useRef<View>(null);
  const listRef = useRef<View>(null);
  const archiveBtnRef = useRef<View>(null);
  const fabRef = useRef<View>(null);

  const tourSteps: HelpStep[] = [
    { key: "home", ref: homeRef, title: "Home", description: "Takes you back to the dashboard.", edgeInset: "top", round: true },
    { key: "help", ref: helpRef, title: "Help", description: "Come back here anytime for a guided tour of this page.", edgeInset: "top", round: true },
    { key: "list", ref: listRef, title: "Active tenants", description: "Every tenant currently renting a stall.", edgeInset: "top" },
    { key: "archive", ref: archiveBtnRef, title: "Archive", description: "Archives this tenant, freeing up their stall. You'll be asked to confirm before it happens.", edgeInset: "top" },
    { key: "fab", ref: fabRef, title: "Updates report", description: "Shows recent changes awaiting your review, organized by building, financials, and accounts.", edgeInset: "bottom", round: true, nudgeY: 5 },
  ];

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [usersSnap, stallsSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, "users"),
            where("role", "==", "tenant"),
            where("status", "==", "active"),
          ),
        ),
        getDocs(collection(db, "stalls")),
      ]);

      const stallMap = new Map<string, { buildingNumber: string; spaceId: string }>();
      stallsSnap.docs.forEach((d) => {
        const sd = d.data();
        stallMap.set(d.id, {
          buildingNumber: String(sd.buildingNumber ?? ""),
          spaceId: (sd.spaceId as string) ?? "",
        });
      });

      const list: Tenant[] = usersSnap.docs.map((d) => {
        const data = d.data();
        const stall = stallMap.get(data.stallId as string) ?? {
          buildingNumber: "",
          spaceId: "",
        };
        return {
          uid: d.id,
          firstName: (data.firstName as string) ?? "",
          lastName: (data.lastName as string) ?? "",
          email:
            (data.personalEmail as string) ||
            (data.email as string) ||
            (data.username ? `${data.username}@rentwise.app` : "") ||
            "",
          emailVerified: data.emailVerified === true,
          contactNo: (data.contactNo as string) ?? "",
          stallId: (data.stallId as string) ?? "",
          buildingNumber: stall.buildingNumber,
          spaceId: stall.spaceId,
        };
      });

      list.sort((a, b) =>
        `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
      );

      setTenants(list);
    } catch (err) {
      console.error("TENANT MANAGEMENT FETCH ERROR:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) { router.replace("/"); return; }
      setChecking(false);
      fetchData();
    });
    return unsub;
  }, [fetchData]);

  // Auto-opens the guided tour the first time the admin ever lands on this
  // page — never again after that, since it flips a persisted per-device
  // flag. Can still be replayed anytime via the Help button.
  useEffect(() => {
    if (checking) return;
    (async () => {
      const seen = await hasSeenPageTour("tenant-management");
      if (!seen) {
        setTourVisible(true);
        await markPageTourSeen("tenant-management");
      }
    })();
  }, [checking]);

  const handleArchive = async () => {
    if (!archiveTarget) return;
    setArchiving(true);
    setArchiveError("");
    try {
      await archiveTenant(archiveTarget.uid);
      setArchiveTarget(null);
      fetchData();
    } catch {
      setArchiveError("Failed to archive tenant. Please try again.");
    } finally {
      setArchiving(false);
    }
  };

  if (checking) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator color={colors.emerald} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* HEADER */}
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
          <View ref={helpRef} collapsable={false}>
            <TouchableOpacity onPress={() => setTourVisible(true)} activeOpacity={0.7} style={styles.headerIconBtn}>
              <HelpCircle size={22} color={colors.emeraldSoft} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Sub-header */}
        <View style={styles.subHeader}>
          <Text style={styles.pageTitle}>Tenant Management</Text>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{tenants.length} Active</Text>
          </View>
        </View>
      </LinearGradient>

      {/* BODY */}
      <View style={styles.body} ref={listRef} collapsable={false}>
        {loading ? (
          <View style={styles.fullCenter}>
            <ActivityIndicator color={colors.emerald} size="large" />
          </View>
        ) : tenants.length === 0 ? (
          <View style={styles.emptyWrap}>
            <EmptyState
              icon={<Users size={28} color={colors.emerald} />}
              title="No tenants found"
              subtitle="Active tenant accounts will appear here."
            />
          </View>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + FAB_CLEARANCE }]}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />
            }
          >
            {tenants.map((item, index) => (
              <View key={item.uid} style={styles.card}>
                {/* LEFT INFO */}
                <View style={styles.cardInfo}>
                  <Text style={styles.cardName}>
                    {item.firstName} {item.lastName}
                  </Text>
                  <View style={styles.cardEmailRow}>
                    <Text style={styles.cardEmail}>{item.email}</Text>
                    <Badge
                      label={item.emailVerified ? "Verified" : "Unverified"}
                      tone={item.emailVerified ? "success" : "warning"}
                    />
                  </View>
                  {item.buildingNumber ? (
                    <Text style={styles.cardStall}>
                      Building {item.buildingNumber} {"·"} Space {item.spaceId}
                    </Text>
                  ) : null}
                  {item.contactNo ? (
                    <Text style={styles.cardContact}>+63 {item.contactNo}</Text>
                  ) : null}
                </View>

                {/* RIGHT ACTIONS */}
                <View style={styles.cardActions}>
                  <View ref={index === 0 ? archiveBtnRef : undefined} collapsable={false}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.archiveBtn,
                        pressed && styles.archiveBtnPressed,
                      ]}
                      onPress={() => {
                        setArchiveError("");
                        setArchiveTarget(item);
                      }}
                    >
                      <Archive size={14} color={colors.error} />
                      <Text style={styles.archiveBtnText}>Archive</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      <UpdatesReportFAB fabRef={fabRef} />

      {/* ARCHIVE CONFIRMATION MODAL */}
      <Modal
        visible={!!archiveTarget}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!archiving) setArchiveTarget(null); }}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => { if (!archiving) setArchiveTarget(null); }}
          />
          {archiveTarget && (
            <View style={styles.modalCard}>
              <View style={styles.modalTitleBar}>
                <Text style={styles.modalTitle}>Archive tenant?</Text>
              </View>
              <View style={styles.modalBody}>
                <Text style={styles.modalMessage}>
                  This will archive the tenant's account. They will no longer have access to the app.
                </Text>
                {archiveError ? (
                  <View style={styles.modalErrorBox}>
                    <AlertCircle size={14} color={colors.error} />
                    <Text style={styles.modalError}>{archiveError}</Text>
                  </View>
                ) : null}
                <View style={styles.modalBtns}>
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.modalBtnOutline]}
                    onPress={() => setArchiveTarget(null)}
                    activeOpacity={0.7}
                    disabled={archiving}
                  >
                    <Text style={styles.modalBtnOutlineText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.modalBtnDanger, archiving && styles.modalBtnDisabled]}
                    onPress={handleArchive}
                    activeOpacity={0.8}
                    disabled={archiving}
                  >
                    {archiving ? (
                      <ActivityIndicator color={colors.white} size="small" />
                    ) : (
                      <Text style={styles.modalBtnDangerText}>Archive</Text>
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
  screen: {
    flex: 1,
    backgroundColor: colors.parchment,
  },

  fullCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.parchment,
  },

  // ── Header ────────────────────────────────────────────────────────────────────

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

  headerTitle: {
    color: colors.white,
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
    flex: 1,
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
  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Banner ────────────────────────────────────────────────────────────────────


  // ── Body ─────────────────────────────────────────────────────────────────────

  body: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },

  listContent: {
    gap: spacing.md,
  },

  // ── Empty state ───────────────────────────────────────────────────────────────

  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Tenant card ───────────────────────────────────────────────────────────────

  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md + 2,
  },

  cardInfo: {
    flex: 1,
  },

  cardName: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
  },

  cardEmailRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.xs + 2,
    marginTop: 2,
  },

  cardEmail: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    color: colors.emeraldBright,
    flexShrink: 1,
  },

  cardStall: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    marginTop: 2,
  },

  cardContact: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },

  cardActions: {
    gap: spacing.sm,
    alignItems: "stretch",
  },

  // ── Archive button ────────────────────────────────────────────────────────────

  archiveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.errorSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm + 1,
    borderWidth: 1,
    borderColor: colors.error,
  },

  archiveBtnPressed: {
    backgroundColor: colors.error,
    transform: [{ scale: 0.97 }],
  },

  archiveBtnText: {
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
    borderWidth: 1,
    borderColor: colors.border,
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
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
    color: colors.emerald,
  },

  modalBody: {
    padding: spacing.xl,
  },

  modalMessage: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.xl,
  },

  modalErrorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.errorSoft,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },

  modalError: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    color: colors.error,
    flex: 1,
  },

  modalTargetUsername: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.regular,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.md,
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
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },

  modalBtnPrimary: {
    backgroundColor: colors.emerald,
    ...shadow.button,
  },

  modalBtnPrimaryText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.white,
  },

  modalBtnDanger: {
    backgroundColor: colors.error,
  },

  modalBtnDangerText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.white,
  },

  modalBtnDisabled: {
    opacity: 0.5,
  },
});
