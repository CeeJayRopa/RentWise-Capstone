import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
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
import UpdatesReportFAB, { FAB_CLEARANCE } from "../components/UpdatesReportFAB";
import HelpTour, { HelpStep } from "../components/HelpTour";
import { hasSeenPageTour, markPageTourSeen } from "../../shared/services/onboardingTour";
import { Badge, EmptyState } from "../../shared/components/ui";
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

  const [tenantMap, setTenantMap] = useState<Map<string, TenantInfo>>(
    new Map(),
  );

  const [selectedBuilding, setSelectedBuilding] = useState<number | null>(null);

  const [filter, setFilter] = useState<"All" | "Unoccupied" | "Occupied">(
    "All",
  );
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);

  const [sheetVisible, setSheetVisible] = useState(false);
  const [tourVisible, setTourVisible] = useState(false);

  const homeRef = useRef<View>(null);
  const helpRef = useRef<View>(null);
  const buildingDropdownRef = useRef<View>(null);
  const statusDropdownRef = useRef<View>(null);
  const listRef = useRef<View>(null);
  const manageBtnRef = useRef<View>(null);
  const editRentalBtnRef = useRef<View>(null);
  const registerBtnRef = useRef<View>(null);
  const fabRef = useRef<View>(null);
  const listScrollRef = useRef<ScrollView>(null);

  // Scrolls a given stall row into view and gives the ScrollView time to
  // settle before HelpTour measures it — otherwise a row below the fold
  // would measure to its stale, off-screen position, and its spotlight
  // would bleed past the visible screen edge.
  const scrollSectionIntoView = (targetRef: React.RefObject<View | null>) =>
    new Promise<void>((resolve) => {
      const scrollNode = listScrollRef.current?.getNativeScrollRef?.();
      if (!scrollNode || !targetRef.current) { resolve(); return; }
      targetRef.current.measureLayout(
        scrollNode as any,
        (_x: number, y: number) => {
          listScrollRef.current?.scrollTo({ y: Math.max(0, y - 100), animated: true });
          setTimeout(resolve, 400);
        },
        () => resolve(),
      );
    });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace("/");
        return;
      }

      setChecking(false);
      fetchData();
    });

    return unsubscribe;
  }, []);

  // Auto-opens the guided tour the first time the admin ever lands on this
  // page — never again after that, since it flips a persisted per-device
  // flag. Can still be replayed anytime via the Help button.
  useEffect(() => {
    if (checking) return;
    (async () => {
      const seen = await hasSeenPageTour("building");
      if (!seen) {
        setTourVisible(true);
        await markPageTourSeen("building");
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

      const buildings = [...new Set(stalls.map((s) => s.buildingNumber))].sort(
        (a, b) => a - b,
      );

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
      console.log("BUILDING ERROR:", error);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      if (!checking) {
        fetchData();
      }
    }, [checking]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const buildingNumbers = [
    ...new Set(allStalls.map((s) => s.buildingNumber)),
  ].sort((a, b) => a - b);

  const displayedStalls = allStalls

    .filter(
      (stall) =>
        selectedBuilding === null || stall.buildingNumber === selectedBuilding,
    )

    .filter((stall) => {
      if (filter === "All") return true;

      if (filter === "Occupied") return stall.status === "occupied";

      return stall.status === "unoccupied";
    })

    .sort((a, b) => {
      if (a.buildingNumber !== b.buildingNumber)
        return a.buildingNumber - b.buildingNumber;
      const numA = Number(a.spaceId.split("-")[1] ?? 0);
      const numB = Number(b.spaceId.split("-")[1] ?? 0);
      return numA - numB;
    });

  // First occupied/unoccupied row currently on screen — used to point the
  // tour at a real, on-screen example of each button instead of a generic
  // description.
  const firstOccupiedIndex = displayedStalls.findIndex((s) => s.status === "occupied");
  const firstUnoccupiedIndex = displayedStalls.findIndex((s) => s.status === "unoccupied");

  const tourSteps: HelpStep[] = [
    { key: "home", ref: homeRef, title: "Home", description: "Takes you back to the dashboard.", edgeInset: "top", round: true },
    // Moved right after "home" (was last) -- see financials.tsx for why.
    { key: "fab", ref: fabRef, title: "Updates report", description: "Shows recent changes awaiting your review, organized by building, financials, and accounts.", edgeInset: "bottom", round: true, nudgeY: 0 },
    { key: "building", ref: buildingDropdownRef, title: "Building filter", description: "Switch between buildings to see only that building's stalls.", edgeInset: "top" },
    { key: "status", ref: statusDropdownRef, title: "Status filter", description: "Narrow the list to occupied or unoccupied stalls.", edgeInset: "top" },
    { key: "list", ref: listRef, title: "Stall list", description: "Register a tenant into a vacant stall, or manage and edit rental info for an occupied one.", edgeInset: "top" },
  ];
  if (firstOccupiedIndex !== -1) {
    tourSteps.push({ key: "manage", ref: manageBtnRef, title: "Manage", description: "Opens this tenant's account so you can view or update their details.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(manageBtnRef) });
    tourSteps.push({ key: "editrental", ref: editRentalBtnRef, title: "Edit Rental", description: "Updates this stall's rent, payment schedule, or other rental terms.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(editRentalBtnRef) });
  }
  if (firstUnoccupiedIndex !== -1) {
    tourSteps.push({ key: "register", ref: registerBtnRef, title: "Register", description: "Registers a new tenant into this vacant stall.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(registerBtnRef) });
  }

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

          <View ref={helpRef} collapsable={false}>
            <TouchableOpacity onPress={() => setTourVisible(true)} activeOpacity={0.7} style={styles.headerIconBtn}>
              <HelpCircle size={22} color={colors.emeraldSoft} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Sub-header */}
        <View style={styles.subHeader}>
          <Text style={styles.pageTitle}>Building Management</Text>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{allStalls.length} Stalls</Text>
          </View>
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
              <Text
                style={styles.dropdownTriggerText}
                numberOfLines={1}
              >
                {selectedBuilding !== null
                  ? `Building ${selectedBuilding}`
                  : "Building"}
              </Text>
              <ChevronDown size={14} color={colors.emerald} />
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
                          selectedBuilding === num &&
                            styles.dropdownItemTextActive,
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
              <Text style={styles.dropdownTriggerText} numberOfLines={1}>
                {filter}
              </Text>
              <ChevronDown size={14} color={colors.emerald} />
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
              ref={listScrollRef}
              style={styles.listScroll}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: insets.bottom + FAB_CLEARANCE }}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
              }
            >
              {displayedStalls.map((item, idx) => (
                <StallRow
                  key={item.id}
                  stall={item}
                  tenantMap={tenantMap}
                  manageRef={idx === firstOccupiedIndex ? manageBtnRef : undefined}
                  editRentalRef={idx === firstOccupiedIndex ? editRentalBtnRef : undefined}
                  registerRef={idx === firstUnoccupiedIndex ? registerBtnRef : undefined}
                />
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

      <UpdatesReportFAB fabRef={fabRef} />

      <HelpTour
        visible={tourVisible}
        steps={tourSteps}
        onClose={() => {
          setTourVisible(false);
          listScrollRef.current?.scrollTo({ y: 0, animated: true });
        }}
      />
    </View>
  );
}

const STATUS_TONE: Record<StallDoc["status"], "success" | "warning" | "error"> = {
  occupied: "success",
  unoccupied: "warning",
  maintenance: "error",
};

const STATUS_LABEL: Record<StallDoc["status"], string> = {
  occupied: "Occupied",
  unoccupied: "Unoccupied",
  maintenance: "Maintenance",
};

function StallRow({
  stall,
  tenantMap,
  manageRef,
  editRentalRef,
  registerRef,
}: {
  stall: StallDoc;
  tenantMap: Map<string, TenantInfo>;
  manageRef?: React.RefObject<View | null>;
  editRentalRef?: React.RefObject<View | null>;
  registerRef?: React.RefObject<View | null>;
}) {
  const tenant = stall.tenantId ? tenantMap.get(stall.tenantId) : undefined;
  const tenantName = tenant ? `${tenant.firstName} ${tenant.lastName}`.trim() : "";

  return (
    <View style={styles.row}>
      <View style={styles.rowInfo}>
        <View style={styles.rowSpaceLine}>
          <Text style={styles.rowSpace}>{stall.spaceId}</Text>
          <Badge label={STATUS_LABEL[stall.status]} tone={STATUS_TONE[stall.status]} />
        </View>
        <Text style={styles.rowBuilding}>Building {stall.buildingNumber}</Text>
        {tenantName && (
          <Text style={styles.rowTenantName}>{tenantName}</Text>
        )}
      </View>

      <View style={styles.rowRight}>
        <View style={styles.stallBtns}>
        {/* UNOCCUPIED */}
        {stall.status === "unoccupied" && (
          <View ref={registerRef} collapsable={false}>
          <Pressable
            style={({ pressed }) => [
              styles.btnRegister,
              pressed && styles.btnRegisterPressed,
            ]}
            onPress={() =>
              router.push({
                pathname: "/account",
                params: {
                  mode: "create",
                  stallId: stall.id,
                },
              } as any)
            }
          >
            <Text style={styles.btnText}>Register</Text>
          </Pressable>
          </View>
        )}

        {/* OCCUPIED */}
        {stall.status === "occupied" && (
          <>
            {/* MANAGE ACCOUNT */}
            <View ref={manageRef} collapsable={false}>
            <Pressable
              style={({ pressed }) => [
                styles.btnManage,
                pressed && styles.btnManagePressed,
              ]}
              onPress={() =>
                router.push({
                  pathname: "/account",
                  params: {
                    mode: "manage",
                    stallId: stall.id,
                  },
                } as any)
              }
            >
              <Text style={styles.btnText}>Manage</Text>
            </Pressable>
            </View>

            {/* EDIT RENTAL INFO */}
            <View ref={editRentalRef} collapsable={false}>
            <Pressable
              style={({ pressed }) => [
                styles.btnEditRental,
                pressed && styles.btnEditRentalPressed,
              ]}
              onPress={() =>
                router.push({
                  pathname: "/edit-rental-info",
                  params: {
                    stallId: stall.id,
                  },
                } as any)
              }
            >
              <Text style={styles.btnTextOutline}>Edit Rental</Text>
            </Pressable>
            </View>
          </>
        )}
        </View>
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
    maxWidth: 160,
  },

  dropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
  },

  dropdownTriggerText: {
    flex: 1,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    color: colors.textPrimary,
  },

  dropdown: {
    position: "absolute",
    top: 42,
    left: 0,
    minWidth: 150,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.sm,
    zIndex: 200,
    ...shadow.raised,
  },

  // Clips item highlights (dropdownItemActive) to the panel's rounded
  // corners. Kept separate from `dropdown` so the outer view's shadow isn't
  // clipped along with it (overflow: hidden hides iOS shadows on the same view).
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
    maxWidth: 160,
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

  // (empty-state text now rendered via the shared EmptyState component)

  // ── Stall row ─────────────────────────────────────────────────────────────────

  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xl - 2,
    paddingVertical: spacing.lg,
    marginBottom: spacing.sm + 2,
  },

  rowInfo: {
    flex: 1,
  },

  rowSpaceLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: 3,
  },

  rowBuilding: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.medium,
    color: colors.textMuted,
  },

  rowSpace: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  rowTenantName: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    marginTop: 3,
  },

  rowRight: {
    alignItems: "flex-end",
    gap: spacing.sm,
    marginLeft: spacing.md,
  },

  stallBtns: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: spacing.sm,
    width: 128,
    flexShrink: 0,
  },

  // ── Action buttons ────────────────────────────────────────────────────────────

  btnText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.white,
    textAlign: "center",
  },

  btnTextOutline: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
    textAlign: "center",
  },

  btnManage: {
    backgroundColor: colors.emerald,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: "center",
    transform: [{ scale: 1 }],
  },

  btnManagePressed: {
    backgroundColor: colors.ink,
    transform: [{ scale: 0.97 }],
  },

  btnEditRental: {
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: "center",
    transform: [{ scale: 1 }],
  },

  btnEditRentalPressed: {
    backgroundColor: colors.emeraldSoft,
    transform: [{ scale: 0.97 }],
  },

  btnRegister: {
    backgroundColor: colors.emeraldBright,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: "center",
    marginTop: spacing.sm,
    transform: [{ scale: 1 }],
  },

  btnRegisterPressed: {
    backgroundColor: colors.emerald,
    transform: [{ scale: 0.97 }],
  },
});
