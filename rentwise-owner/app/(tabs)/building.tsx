import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { House, HelpCircle, ChevronDown, Building2 } from "lucide-react-native";

import { auth } from "../../shared/services/auth";
import { db } from "../../shared/services/firestore";
import HelpTour, { HelpStep } from "../components/HelpTour";
import { hasSeenPageTour, markPageTourSeen } from "../../shared/services/onboardingTour";
import { EmptyState } from "../../shared/components/ui";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";

type StallDoc = {
  id: string;
  buildingNumber: number;
  spaceId: string;
  name: string;
  price: number;
  paymentSchedule: string;
  status: "occupied" | "unoccupied" | "maintenance";
  tenantId: string | null;
};

type TenantInfo = {
  firstName: string;
  lastName: string;
};

export default function Building() {
  const insets = useSafeAreaInsets();

  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [allStalls, setAllStalls] = useState<StallDoc[]>([]);
  const [tenantMap, setTenantMap] = useState<Map<string, TenantInfo>>(new Map());

  const [selectedBuilding, setSelectedBuilding] = useState<number | null>(null);
  const [filter, setFilter] = useState<"All" | "Unoccupied" | "Occupied">("All");
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);
  const [sheetVisible, setSheetVisible] = useState(false);

  const [tourVisible, setTourVisible] = useState(false);
  const homeRef = useRef<View>(null);
  const buildingDropdownRef = useRef<View>(null);
  const statusDropdownRef = useRef<View>(null);
  const statsRef = useRef<View>(null);
  const listRef = useRef<View>(null);

  const tourSteps: HelpStep[] = [
    { key: "home", ref: homeRef, title: "Home", description: "Takes you back to the dashboard.", offsetY: 41, round: true },
    { key: "building", ref: buildingDropdownRef, title: "Building filter", description: "Switch between buildings to see only that building's stalls.", offsetY: 41 },
    { key: "status", ref: statusDropdownRef, title: "Status filter", description: "Narrow the list to occupied or unoccupied stalls.", offsetY: 41 },
    { key: "stats", ref: statsRef, title: "Units / Occupied / Vacant", description: "Total stalls in this building, and how many are currently occupied vs. vacant.", offsetY: 41 },
    { key: "badge", ref: listRef, title: "Occupied / Unoccupied", description: "Shows whether a stall currently has a tenant. Occupied stalls also show the tenant's name.", offsetY: 41 },
  ];

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) { router.replace("/login"); return; }
      setChecking(false);
      fetchData();
    });
    return unsub;
  }, []);

  // Auto-opens the guided tour the first time the owner ever lands on this
  // page — never again after that, since it flips a persisted per-device
  // flag. Can still be replayed anytime via the Help button.
  useEffect(() => {
    if (checking) return;
    (async () => {
      const seen = await hasSeenPageTour("owner-building");
      if (!seen) {
        setTourVisible(true);
        await markPageTourSeen("owner-building");
      }
    })();
  }, [checking]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [stallsSnap, usersSnap] = await Promise.all([
        getDocs(collection(db, "stalls")),
        getDocs(query(collection(db, "users"), where("role", "==", "tenant"))),
      ]);

      const stalls: StallDoc[] = stallsSnap.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          buildingNumber: Number(data.buildingNumber ?? 0),
          spaceId: data.spaceId ?? "",
          name: data.name ?? "",
          price: Number(data.price ?? 0),
          paymentSchedule: data.paymentSchedule ?? "",
          status: data.status ?? "unoccupied",
          tenantId: data.tenantId ?? null,
        };
      });

      setAllStalls(stalls);

      const buildings = [...new Set(stalls.map((s) => s.buildingNumber))].sort((a, b) => a - b);
      if (buildings.length > 0) {
        setSelectedBuilding((prev) => (prev !== null ? prev : buildings[0]));
      }

      const map = new Map<string, TenantInfo>();
      usersSnap.docs.forEach((doc) => {
        const data = doc.data();
        map.set(doc.id, {
          firstName: data.firstName ?? "",
          lastName: data.lastName ?? "",
        });
      });

      setTenantMap(map);
    } catch (error) {
      console.log("OWNER BUILDING ERROR:", error);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      if (!checking) fetchData();
    }, [checking]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const buildingNumbers = [...new Set(allStalls.map((s) => s.buildingNumber))].sort((a, b) => a - b);

  const buildingStalls = allStalls.filter(
    (stall) => selectedBuilding === null || stall.buildingNumber === selectedBuilding,
  );
  const occupiedCount = buildingStalls.filter((s) => s.status === "occupied").length;
  const vacantCount = buildingStalls.length - occupiedCount;

  const displayedStalls = allStalls
    .filter((stall) => selectedBuilding === null || stall.buildingNumber === selectedBuilding)
    .filter((stall) => {
      if (filter === "All") return true;
      if (filter === "Occupied") return stall.status === "occupied";
      return stall.status === "unoccupied";
    })
    .sort((a, b) => {
      if (a.buildingNumber !== b.buildingNumber) return a.buildingNumber - b.buildingNumber;
      const numA = Number(a.spaceId.split("-")[1] ?? 0);
      const numB = Number(b.spaceId.split("-")[1] ?? 0);
      return numA - numB;
    });

  if (checking) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator size="large" color={colors.emerald} />
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
          <TouchableOpacity onPress={() => setTourVisible(true)} activeOpacity={0.7} style={styles.headerIconBtn}>
            <HelpCircle size={24} color={colors.emeraldSoft} />
          </TouchableOpacity>
        </View>

        {/* Sub-header */}
        <View style={styles.subHeader}>
          <Text style={styles.subHeaderTitle}>Building Management</Text>
          <Text style={styles.viewOnly}>View only</Text>
        </View>
      </LinearGradient>

      {/* BODY */}
      <View style={styles.body}>
        {/* DROPDOWN + FILTER — same row, elevated when a dropdown is open */}
        <View
          style={[
            styles.topRow,
            sheetVisible || filterSheetVisible ? { zIndex: 150 } : undefined,
          ]}
        >
          {/* BUILDING DROPDOWN */}
          <View style={styles.dropdownWrapper} ref={buildingDropdownRef} collapsable={false}>
            <TouchableOpacity
              style={styles.dropdownTrigger}
              onPress={() => {
                setFilterSheetVisible(false);
                setSheetVisible((v) => !v);
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.dropdownCaption}>Building</Text>
              <View style={styles.dropdownValueWrap}>
                <Text style={styles.dropdownValue} numberOfLines={1}>
                  {selectedBuilding !== null ? selectedBuilding : "-"}
                </Text>
                <ChevronDown size={14} color={colors.ink} />
              </View>
            </TouchableOpacity>

            {sheetVisible && (
              <View style={styles.dropdown}>
                <View style={styles.dropdownInner}>
                  {buildingNumbers.map((num) => (
                    <TouchableOpacity
                      key={num}
                      style={[
                        styles.dropdownItem,
                        selectedBuilding === num && styles.dropdownItemActive,
                      ]}
                      onPress={() => {
                        setSelectedBuilding(num);
                        setSheetVisible(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.dropdownItemText,
                          selectedBuilding === num && styles.dropdownItemTextActive,
                        ]}
                      >
                        Building {num}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </View>

          {/* STATUS FILTER DROPDOWN */}
          <View style={styles.filterDropdownWrapper} ref={statusDropdownRef} collapsable={false}>
            <TouchableOpacity
              style={styles.dropdownTrigger}
              onPress={() => {
                setSheetVisible(false);
                setFilterSheetVisible((v) => !v);
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.dropdownCaption}>Filter</Text>
              <View style={styles.dropdownValueWrap}>
                <Text style={styles.dropdownValue} numberOfLines={1}>
                  {filter}
                </Text>
                <ChevronDown size={14} color={colors.ink} />
              </View>
            </TouchableOpacity>

            {filterSheetVisible && (
              <View style={styles.dropdown}>
                <View style={styles.dropdownInner}>
                  {(["All", "Unoccupied", "Occupied"] as const).map((item) => (
                    <TouchableOpacity
                      key={item}
                      style={[
                        styles.dropdownItem,
                        filter === item && styles.dropdownItemActive,
                      ]}
                      onPress={() => {
                        setFilter(item);
                        setFilterSheetVisible(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.dropdownItemText,
                          filter === item && styles.dropdownItemTextActive,
                        ]}
                      >
                        {item}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </View>
        </View>

        {/* STATS ROW */}
        <View style={styles.statsRow} ref={statsRef} collapsable={false}>
          <View style={styles.statCard}>
            <Text style={styles.statCaption}>Units</Text>
            <Text style={styles.statValue}>{buildingStalls.length}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statCaption}>Occupied</Text>
            <Text style={styles.statValue}>{occupiedCount}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statCaption}>Vacant</Text>
            <Text style={styles.statValue}>{vacantCount}</Text>
          </View>
        </View>

        {/* STALL LIST — all spaces live in one card; the card itself scrolls
            internally as more stalls get added over time */}
        <View style={styles.listCard} ref={listRef} collapsable={false}>
          {loading ? (
            <View style={styles.listCardCenteredBox}>
              <ActivityIndicator size="large" color={colors.emerald} />
            </View>
          ) : displayedStalls.length === 0 ? (
            <View style={styles.listCardCenteredBox}>
              <EmptyState
                icon={<Building2 size={28} color={colors.emeraldBright} />}
                title="No stalls found."
              />
            </View>
          ) : (
            <ScrollView
              style={styles.listScroll}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
              }
            >
              {displayedStalls.map((item) => (
                <StallRow key={item.id} stall={item} tenantMap={tenantMap} />
              ))}
            </ScrollView>
          )}
        </View>
      </View>

      {/* DROPDOWN BACKDROP */}
      {(sheetVisible || filterSheetVisible) && (
        <TouchableOpacity
          style={[StyleSheet.absoluteFill, { zIndex: 100 }]}
          onPress={() => {
            setSheetVisible(false);
            setFilterSheetVisible(false);
          }}
          activeOpacity={1}
        />
      )}

      <HelpTour visible={tourVisible} steps={tourSteps} onClose={() => setTourVisible(false)} />
    </View>
  );
}

const STATUS_LABEL: Record<StallDoc["status"], string> = {
  occupied: "Occupied",
  unoccupied: "Unoccupied",
  maintenance: "Maintenance",
};

const STATUS_PILL: Record<StallDoc["status"], { bg: string; fg: string }> = {
  occupied: { bg: colors.successSoft, fg: colors.emerald },
  unoccupied: { bg: colors.warningSoft, fg: colors.warning },
  maintenance: { bg: colors.errorSoft, fg: colors.error },
};

function StallRow({
  stall,
  tenantMap,
}: {
  stall: StallDoc;
  tenantMap: Map<string, TenantInfo>;
}) {
  const tenant = stall.tenantId ? tenantMap.get(stall.tenantId) : undefined;
  const tenantName = tenant ? `${tenant.firstName} ${tenant.lastName}`.trim() : "";
  const pill = STATUS_PILL[stall.status];

  return (
    <View style={styles.row}>
      <View style={styles.rowAvatar}>
        <Text style={styles.rowAvatarText}>{`B${stall.buildingNumber}`}</Text>
      </View>
      <View style={styles.rowInfo}>
        <Text style={styles.rowSpace} numberOfLines={1}>{stall.spaceId}</Text>
        {!!tenantName && (
          <Text style={styles.rowTenantName} numberOfLines={1} ellipsizeMode="tail">
            {tenantName}
          </Text>
        )}
      </View>
      <View style={[styles.statusPill, { backgroundColor: pill.bg }]}>
        <View style={[styles.statusDot, { backgroundColor: pill.fg }]} />
        <Text style={[styles.statusPillText, { color: pill.fg }]}>{STATUS_LABEL[stall.status]}</Text>
      </View>
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
    paddingBottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

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
  subHeaderTitle: { fontSize: fontSize.md, fontFamily: fontFamily.semibold, color: colors.white },
  viewOnly: { fontSize: fontSize.sm, color: colors.emeraldSoft, fontFamily: fontFamily.regular, fontStyle: "italic" },

  // ── Body ─────────────────────────────────────────────────────────────────────

  body: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },

  // ── Top row (building dropdown + filter tabs) ─────────────────────────────────

  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },

  // ── Building dropdown ─────────────────────────────────────────────────────────

  dropdownWrapper: {
    position: "relative",
    flex: 1,
  },

  dropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },

  dropdownCaption: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.bold,
    color: colors.emerald,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  dropdownValueWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  dropdownValue: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  dropdown: {
    position: "absolute",
    top: 54,
    left: 0,
    minWidth: 150,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.sm,
    zIndex: 200,
    ...shadow.raised,
  },

  dropdownInner: {
    borderRadius: radius.sm,
    overflow: "hidden",
  },

  dropdownItem: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },

  dropdownItemActive: {
    backgroundColor: colors.emeraldSoft,
  },

  dropdownItemText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
  },

  dropdownItemTextActive: {
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },

  // ── Status filter dropdown ─────────────────────────────────────────────────────

  filterDropdownWrapper: {
    position: "relative",
    flex: 1,
  },

  // ── Stats row ─────────────────────────────────────────────────────────────────

  statsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },

  statCard: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },

  statCaption: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.3,
    marginBottom: 4,
  },

  statValue: {
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  // ── Stall list card ──────────────────────────────────────────────────────────

  listCard: {
    flex: 1,
  },

  listScroll: {
    flex: 1,
  },

  listCardCenteredBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xxxl + spacing.xl,
  },

  // ── Stall row ─────────────────────────────────────────────────────────────────

  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radius.xl + 4,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md + 2,
    marginBottom: spacing.sm + 2,
    gap: spacing.md,
  },

  rowAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.emeraldSoft,
    alignItems: "center",
    justifyContent: "center",
  },

  rowAvatarText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.bold,
    color: colors.emerald,
  },

  rowInfo: {
    flex: 1,
  },

  rowSpace: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginBottom: 2,
  },

  rowTenantName: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
  },

  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },

  statusDot: { width: 6, height: 6, borderRadius: 3 },

  statusPillText: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.bold,
  },
});
