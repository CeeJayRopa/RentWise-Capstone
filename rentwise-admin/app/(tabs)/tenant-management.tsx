import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
  RefreshControl,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { House, HelpCircle, Users, Mail, Building2, Phone, Eye, EyeOff } from "lucide-react-native";
import { rentWiseUsernameBase } from "../../../shared/utils/username";

import { auth } from "../../shared/services/auth";
import { db } from "../../shared/services/firestore";
import HelpTour, { HelpStep } from "../components/HelpTour";
import HelpSupportModal from "../components/HelpSupportModal";
import { hasSeenPageTour, markPageTourSeen } from "../../shared/services/onboardingTour";
import { EmptyState } from "../../shared/components/ui";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";
import { readLocalCache, saveLocalCache } from "../../shared/services/localCache";

type Tenant = {
  uid: string;
  firstName: string;
  middleName: string;
  lastName: string;
  email: string;
  username: string;
  contactNo: string;
  stallId: string;
  buildingNumber: string;
  spaceId: string;
};

function displayContactNumber(contactNo: string, revealed: boolean): string {
  const digits = String(contactNo ?? "").replace(/\D/g, "");
  const localNumber = digits.startsWith("63")
    ? digits.slice(2)
    : digits.startsWith("0")
      ? digits.slice(1)
      : digits;

  if (!localNumber) return "—";
  if (revealed || localNumber.length <= 3) return `+63 ${localNumber}`;

  const hiddenDigits = "•".repeat(Math.max(1, localNumber.length - 3));
  return `+63 ${localNumber.slice(0, 1)}${hiddenDigits}${localNumber.slice(-2)}`;
}

export default function TenantManagement() {
  const insets = useSafeAreaInsets();

  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [revealedContacts, setRevealedContacts] = useState<Set<string>>(() => new Set());

  const [tourVisible, setTourVisible] = useState(false);
  const [helpSupportVisible, setHelpSupportVisible] = useState(false);

  const homeRef = useRef<View>(null);
  const helpRef = useRef<View>(null);
  const listRef = useRef<View>(null);

  useFocusEffect(
    useCallback(() => {
      setRevealedContacts(new Set());
    }, []),
  );

  const toggleContactVisibility = (tenantId: string) => {
    setRevealedContacts((current) => {
      const next = new Set(current);
      if (next.has(tenantId)) next.delete(tenantId);
      else next.add(tenantId);
      return next;
    });
  };

  const tourSteps: HelpStep[] = [
    { key: "home", ref: homeRef, title: "Home", description: "Takes you back to the dashboard.", edgeInset: "top", round: true },
    // Moved right after "home" (was last) -- see financials.tsx for why.
    { key: "list", ref: listRef, title: "Active tenants", description: "Every tenant currently renting a stall.", edgeInset: "top" },
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
          middleName: (data.middleName as string) ?? "",
          lastName: (data.lastName as string) ?? "",
          email:
            (data.personalEmail as string) ||
            (data.email as string) ||
            (data.username ? `${data.username}@rentwise.app` : "") ||
            "",
          username: rentWiseUsernameBase((data.firstName as string) ?? ""),
          contactNo: (data.contactNo as string) ?? "",
          stallId: (data.stallId as string) ?? "",
          buildingNumber: stall.buildingNumber,
          spaceId: stall.spaceId,
        };
      });

      list.sort((a, b) =>
        [a.firstName, a.middleName, a.lastName].filter(Boolean).join(" ").localeCompare(
          [b.firstName, b.middleName, b.lastName].filter(Boolean).join(" "),
        ),
      );

      setTenants(list);
      await saveLocalCache("admin:tenants", list);
    } catch (err) {
      console.error("TENANT MANAGEMENT FETCH ERROR:", err);
      const cached = await readLocalCache<Tenant[]>("admin:tenants");
      if (cached) setTenants(cached);
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
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (checking || !auth.currentUser) return;
    let userDocs: any[] | null = null;
    let stallDocs: any[] | null = null;

    const updateTenants = () => {
      if (!userDocs || !stallDocs) return;
      const stallMap = new Map<string, { buildingNumber: string; spaceId: string }>();
      stallDocs.forEach((d) => {
        const data = d.data();
        stallMap.set(d.id, {
          buildingNumber: String(data.buildingNumber ?? ""),
          spaceId: data.spaceId ?? "",
        });
      });
      const list: Tenant[] = userDocs.map((d) => {
        const data = d.data();
        const stall = stallMap.get(data.stallId as string) ?? { buildingNumber: "", spaceId: "" };
        return {
          uid: d.id,
          firstName: data.firstName ?? "",
          middleName: data.middleName ?? "",
          lastName: data.lastName ?? "",
          email: data.personalEmail || data.email || (data.username ? `${data.username}@rentwise.app` : ""),
          username: rentWiseUsernameBase(data.firstName ?? ""),
          contactNo: data.contactNo ?? "",
          stallId: data.stallId ?? "",
          buildingNumber: stall.buildingNumber,
          spaceId: stall.spaceId,
        };
      });
      list.sort((a, b) =>
        [a.firstName, a.middleName, a.lastName].filter(Boolean).join(" ").localeCompare(
          [b.firstName, b.middleName, b.lastName].filter(Boolean).join(" "),
        ),
      );
      setTenants(list);
      setLoading(false);
    };

    const unsubscribeUsers = onSnapshot(
      query(collection(db, "users"), where("role", "==", "tenant"), where("status", "==", "active")),
      (snapshot) => { userDocs = snapshot.docs; updateTenants(); },
      (error) => { console.error("TENANT LISTENER ERROR:", error); setLoading(false); },
    );
    const unsubscribeStalls = onSnapshot(
      collection(db, "stalls"),
      (snapshot) => { stallDocs = snapshot.docs; updateTenants(); },
      (error) => { console.error("TENANT STALLS LISTENER ERROR:", error); setLoading(false); },
    );

    return () => {
      unsubscribeUsers();
      unsubscribeStalls();
    };
  }, [checking]);

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
            <TouchableOpacity onPress={() => setHelpSupportVisible(true)} activeOpacity={0.7} style={styles.headerIconBtn}>
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
            contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + spacing.xl }]}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />
            }
          >
            {tenants.map((item, index) => (
              <Pressable
                key={item.uid}
                accessibilityRole="button"
                accessibilityLabel={`Manage ${[item.firstName, item.middleName, item.lastName].filter(Boolean).join(" ")}`}
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                onPress={() => router.push({
                  pathname: "/manage-tenant",
                  params: { tenantId: item.uid, stallId: item.stallId, mode: "manage" },
                } as any)}
              >
                {/* LEFT INFO */}
                <View style={styles.legacyCardInfo}>
                  <Text style={styles.cardName} numberOfLines={1} ellipsizeMode="tail">
                    {[item.firstName, item.middleName, item.lastName].filter(Boolean).join(" ")}
                  </Text>
                  <View style={styles.cardEmailRow}>
                    <Text style={styles.cardEmail} numberOfLines={1} ellipsizeMode="middle">
                      {item.email}
                    </Text>
                  </View>
                  {item.buildingNumber ? (
                    <Text style={styles.cardStall}>
                      Building {item.buildingNumber} {"·"} Space {item.spaceId}
                    </Text>
                  ) : null}
                  {item.contactNo ? (
                    <View style={[styles.contactValueRow, styles.legacyContactValueRow]}>
                      <Text style={styles.cardContact}>{displayContactNumber(item.contactNo, revealedContacts.has(item.uid))}</Text>
                      <Pressable
                        onPress={(event) => {
                          event.stopPropagation();
                          toggleContactVisibility(item.uid);
                        }}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={revealedContacts.has(item.uid) ? "Hide phone number" : "Show phone number"}
                        style={styles.contactVisibilityButton}
                      >
                        {revealedContacts.has(item.uid)
                          ? <EyeOff size={15} color={colors.textMuted} />
                          : <Eye size={15} color={colors.textMuted} />}
                      </Pressable>
                    </View>
                  ) : null}
                </View>

                <View style={styles.tenantCardHeader}>
                  <View style={styles.tenantAvatar}>
                    <Text style={styles.tenantAvatarText}>{`${item.firstName.charAt(0)}${item.lastName.charAt(0)}`.toUpperCase()}</Text>
                  </View>
                  <View style={styles.tenantHeaderText}>
                    <Text style={styles.cardName} numberOfLines={1}>{[item.firstName, item.middleName, item.lastName].filter(Boolean).join(" ")}</Text>
                  </View>
                </View>

                <View style={styles.tenantDetails}>
                  <View style={styles.tenantDetailRow}><Mail size={11} color={colors.ink} /><Text style={styles.tenantDetailLabel}>USERNAME</Text><Text style={styles.tenantDetailValue}>{item.username}</Text></View>
                  <View style={styles.tenantDetailRow}><Building2 size={11} color={colors.ink} /><Text style={styles.tenantDetailLabel}>LOCATION</Text><View style={styles.locationValue}><Text style={styles.tenantDetailValue}>Building {item.buildingNumber}</Text><Text style={styles.spaceBadge}>Space {item.spaceId}</Text></View></View>
                  <View style={styles.tenantDetailRow}>
                    <Phone size={11} color={colors.ink} />
                    <Text style={styles.tenantDetailLabel}>CONTACT</Text>
                    <View style={styles.contactValueRow}>
                      <Text style={styles.tenantDetailValue}>{displayContactNumber(item.contactNo, revealedContacts.has(item.uid))}</Text>
                      {item.contactNo ? (
                        <Pressable
                          onPress={(event) => {
                            event.stopPropagation();
                            toggleContactVisibility(item.uid);
                          }}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={revealedContacts.has(item.uid) ? "Hide phone number" : "Show phone number"}
                          style={styles.contactVisibilityButton}
                        >
                          {revealedContacts.has(item.uid)
                            ? <EyeOff size={15} color={colors.textMuted} />
                            : <Eye size={15} color={colors.textMuted} />}
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                </View>

              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>

      <HelpTour visible={tourVisible} steps={tourSteps} onClose={() => setTourVisible(false)} />
      <HelpSupportModal visible={helpSupportVisible} steps={tourSteps} onClose={() => setHelpSupportVisible(false)} onReplayTour={() => setTourVisible(true)} />
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
    gap: 10,
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
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#EEF0ED",
    overflow: "hidden",
  },
  cardPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.995 }],
  },

  legacyCardInfo: { display: "none" },
  legacyCardActions: { display: "none" },

  tenantCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 9,
  },
  tenantAvatar: {
    width: 34,
    height: 34,
    borderRadius: 6,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 9,
  },
  tenantAvatarText: { color: colors.white, fontSize: 12, fontFamily: fontFamily.bold },
  tenantHeaderText: { flex: 1, minWidth: 0 },
  tenantDetails: { paddingHorizontal: 14, paddingBottom: 9, gap: 9 },
  tenantDetailRow: { flexDirection: "row", alignItems: "center", minHeight: 15 },
  tenantDetailLabel: { width: 84, marginLeft: 7, fontSize: 8, fontFamily: fontFamily.medium, color: colors.ink },
  tenantDetailValue: { fontSize: 10, fontFamily: fontFamily.medium, color: colors.ink },
  contactValueRow: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: 4 },
  legacyContactValueRow: { marginTop: spacing.xs + 1 },
  contactVisibilityButton: { width: 24, height: 28, alignItems: "center", justifyContent: "center" },
  locationValue: { flexDirection: "row", alignItems: "center", gap: 5 },
  spaceBadge: {
    fontSize: 8,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
    backgroundColor: "#DDF8EE",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  registryFooter: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FAFAF8",
    borderTopWidth: 1,
    borderTopColor: "#F1F1EE",
    paddingHorizontal: 12,
  },
  registryFooterText: { fontSize: 8, fontFamily: fontFamily.medium, color: colors.textMuted },

  cardInfo: {
    flex: 1,
    minWidth: 0,
  },

  cardName: {
    minWidth: 0,
    fontSize: 13,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    lineHeight: 16,
  },

  cardEmailRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.xs + 1,
    minWidth: 0,
  },

  cardEmail: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    color: colors.emerald,
    flex: 1,
    minWidth: 0,
    lineHeight: 19,
  },

  cardStall: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
    marginTop: spacing.sm + 2,
    lineHeight: 19,
  },

  cardContact: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    color: colors.textMuted,
    lineHeight: 19,
  },

  cardActions: {
    gap: spacing.sm,
    alignItems: "stretch",
    width: 112,
    flexShrink: 0,
    position: "relative",
  },

  // ── Archive button ────────────────────────────────────────────────────────────

  archiveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: colors.errorSoft,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderWidth: 0,
    minHeight: 34,
  },

  archiveBtnPressed: {
    backgroundColor: colors.error,
    transform: [{ scale: 0.97 }],
  },

  archiveBtnText: {
    color: colors.error,
    fontSize: 9,
    fontFamily: fontFamily.semibold,
    textAlign: "center",
  },

  archiveBtnTextPressed: {
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
  modalBtnOutlinePressed: {
    backgroundColor: colors.emerald,
  },

  modalBtnOutlineText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },
  modalBtnOutlineTextPressed: {
    color: colors.white,
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
  modalBtnDangerPressed: {
    backgroundColor: colors.white,
  },

  modalBtnDangerText: {
    fontSize: fontSize.sm,
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
