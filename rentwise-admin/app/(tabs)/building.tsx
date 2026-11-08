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
import { collection, getDocs, onSnapshot } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { House, HelpCircle, ChevronDown, Building2, Store, UserRound, UserRoundPlus, SlidersHorizontal, Building as BuildingIcon } from "lucide-react-native";

import { auth } from "../../shared/services/auth";
import { db } from "../../shared/services/firestore";
import HelpTour, { HelpStep } from "../components/HelpTour";
import HelpSupportModal from "../components/HelpSupportModal";
import { hasSeenPageTour, markPageTourSeen } from "../../shared/services/onboardingTour";
import { EmptyState } from "../../shared/components/ui";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";
import { readLocalCache, saveLocalCache } from "../../shared/services/localCache";

type StallDoc = {
  id: string;
  buildingNumber: number;
  spaceId: string;
  name: string;
  price: number;
  paymentSchedule: string;
  status: "occupied" | "unoccupied" | "maintenance";
  tenantId: string | null;
  tenantName: string;
};

export default function Building() {
  const insets = useSafeAreaInsets();

  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [allStalls, setAllStalls] = useState<StallDoc[]>([]);

  const [selectedBuilding, setSelectedBuilding] = useState<number | null>(null);

  const [filter, setFilter] = useState<"All" | "Unoccupied" | "Occupied">(
    "All",
  );
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);

  const [sheetVisible, setSheetVisible] = useState(false);
  const [tourVisible, setTourVisible] = useState(false);
  const [helpSupportVisible, setHelpSupportVisible] = useState(false);

  const homeRef = useRef<View>(null);
  const helpRef = useRef<View>(null);
  const buildingDropdownRef = useRef<View>(null);
  const statusDropdownRef = useRef<View>(null);
  const listRef = useRef<View>(null);
  const manageBtnRef = useRef<View>(null);
  const editRentalBtnRef = useRef<View>(null);
  const registerBtnRef = useRef<View>(null);
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
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (checking || !auth.currentUser) return;
    let stallsReady = false;
    const finishInitialLoad = () => {
      if (stallsReady) setLoading(false);
    };

    const unsubscribeStalls = onSnapshot(collection(db, "stalls"), (snapshot) => {
      setAllStalls(snapshot.docs.map((stallDoc) => {
        const data = stallDoc.data();
        return {
          id: stallDoc.id,
          buildingNumber: Number(data.buildingNumber ?? 0),
          spaceId: data.spaceId ?? "",
          name: data.name ?? "",
          price: Number(data.price ?? 0),
          paymentSchedule: data.paymentSchedule ?? "",
          status: data.status ?? "unoccupied",
          tenantId: data.tenantId ?? null,
          tenantName: String(data.tenantName ?? "").trim(),
        };
      }));
      stallsReady = true;
      finishInitialLoad();
    }, (error) => {
      console.log("STALLS LISTENER ERROR:", error);
      setLoading(false);
    });

    return () => {
      unsubscribeStalls();
    };
  }, [checking]);

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
      const stallsSnap = await getDocs(collection(db, "stalls"));

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
          tenantName: String(data.tenantName ?? "").trim(),
        };
      });

      setAllStalls(stalls);
      await saveLocalCache("admin:stalls", {stalls});
    } catch (error) {
      console.log("BUILDING ERROR:", error);
      const cached = await readLocalCache<{stalls: StallDoc[]}>("admin:stalls");
      if (cached) {
        setAllStalls(cached.stalls);
      }
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      if (!checking) {
        setSelectedBuilding(null);
      }
    }, [checking]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  // Keep the two managed buildings available even when one currently has no
  // stall documents. Any future building numbers found in Firestore are also
  // included automatically.
  const buildingNumbers = [
    ...new Set([1, 2, ...allStalls.map((s) => s.buildingNumber)]),
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
            <TouchableOpacity onPress={() => setHelpSupportVisible(true)} activeOpacity={0.7} style={styles.headerIconBtn}>
              <HelpCircle size={22} color={colors.emeraldSoft} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Sub-header */}
        <View style={styles.subHeader}>
          <Text style={styles.pageTitle}>Stall Management</Text>
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
              <View style={styles.dropdownLabelRow}>
                <Building2 size={12} color={colors.ink} />
                <Text style={styles.dropdownTriggerText} numberOfLines={1}>
                  {selectedBuilding !== null ? `Building ${selectedBuilding}` : "All Buildings"}
                </Text>
              </View>
              <ChevronDown size={14} color={colors.emerald} />
            </TouchableOpacity>

            {sheetVisible && (
              <View style={styles.dropdown}>
                <View style={styles.dropdownInner}>
                  <TouchableOpacity
                    style={[
                      styles.dropdownItem,
                      selectedBuilding === null && styles.dropdownItemActive,
                    ]}
                    onPress={() => {
                      setSelectedBuilding(null);
                      setSheetVisible(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.dropdownItemText,
                        selectedBuilding === null &&
                          styles.dropdownItemTextActive,
                      ]}
                    >
                      All Buildings
                    </Text>
                  </TouchableOpacity>
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
              <View style={styles.dropdownLabelRow}>
                <SlidersHorizontal size={12} color={colors.ink} />
                <Text style={styles.dropdownTriggerText} numberOfLines={1}>{filter}</Text>
              </View>
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
              contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
              }
            >
              {displayedStalls.map((item, idx) => (
                <StallRow
                  key={item.id}
                  stall={item}
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


      <HelpSupportModal visible={helpSupportVisible} steps={tourSteps} onClose={() => setHelpSupportVisible(false)} onReplayTour={() => setTourVisible(true)} />
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

const STATUS_LABEL: Record<StallDoc["status"], string> = {
  occupied: "Occupied",
  unoccupied: "Unoccupied",
  maintenance: "Maintenance",
};

function StallRow({
  stall,
  manageRef,
  editRentalRef,
  registerRef,
}: {
  stall: StallDoc;
  manageRef?: React.RefObject<View | null>;
  editRentalRef?: React.RefObject<View | null>;
  registerRef?: React.RefObject<View | null>;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.stallHeaderRow}>
        <View style={styles.stallIconBox}><Store size={17} color={colors.emerald} /></View>
      <View style={styles.rowInfo}>
        <Text style={styles.rowSpace}>{stall.spaceId}</Text>
        <View style={styles.buildingLine}><BuildingIcon size={10} color={colors.textMuted} /><Text style={styles.rowBuilding}>Building {stall.buildingNumber}</Text></View>
        {stall.status === "occupied" && (
          <View style={styles.occupantLine}>
            <UserRound size={10} color={colors.emerald} />
            <Text style={[styles.occupantName, !stall.tenantName && styles.occupantNameMissing]} numberOfLines={1}>
              {stall.tenantName || "Occupant not recorded"}
            </Text>
          </View>
        )}
      </View>
        <View style={[styles.statusPill, stall.status === "occupied" ? styles.statusPillOccupied : stall.status === "maintenance" ? styles.statusPillMaintenance : styles.statusPillUnoccupied]}>
          <View style={[styles.statusDot, stall.status === "occupied" ? styles.statusDotOccupied : stall.status === "maintenance" ? styles.statusDotMaintenance : styles.statusDotUnoccupied]} />
          <Text style={styles.statusPillText}>{STATUS_LABEL[stall.status]}</Text>
        </View>
      </View>

      <View style={styles.stallBtns}>
        {/* UNOCCUPIED */}
        {stall.status === "unoccupied" && (
          <>
            <View ref={registerRef} collapsable={false} style={styles.buttonWrap}>
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
                {({ pressed }) => (
                  <View style={styles.buttonContent}><UserRoundPlus size={13} color={pressed ? colors.emerald : colors.white} /><Text style={[styles.btnText, pressed && styles.btnRegisterTextPressed]}>Register</Text></View>
                )}
              </Pressable>
            </View>

            <View style={styles.buttonWrap}>
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
              {({ pressed }) => (
                <View style={styles.buttonContent}><SlidersHorizontal size={13} color={pressed ? colors.white : colors.ink} /><Text style={[styles.btnTextOutline, pressed && styles.btnEditRentalTextPressed]}>Edit Rental</Text></View>
              )}
            </Pressable>
            </View>
          </>
        )}

        {/* OCCUPIED */}
        {stall.status === "occupied" && (
          <>
            {/* MANAGE ACCOUNT */}
            <View ref={manageRef} collapsable={false} style={styles.buttonWrap}>
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
              {({ pressed }) => (
                <View style={styles.buttonContent}><SlidersHorizontal size={13} color={pressed ? colors.emerald : colors.white} /><Text style={[styles.btnText, pressed && styles.btnManageTextPressed]}>Manage</Text></View>
              )}
            </Pressable>
            </View>

            {/* EDIT RENTAL INFO */}
            <View ref={editRentalRef} collapsable={false} style={styles.buttonWrap}>
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
              {({ pressed }) => (
                <View style={styles.buttonContent}><SlidersHorizontal size={13} color={pressed ? colors.white : colors.ink} /><Text style={[styles.btnTextOutline, pressed && styles.btnEditRentalTextPressed]}>Edit Rental</Text></View>
              )}
            </Pressable>
            </View>
          </>
        )}
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
    marginBottom: 10,
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
    minHeight: 36,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 7,
    ...shadow.subtle,
  },

  dropdownLabelRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  dropdownTriggerText: {
    fontSize: 10,
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
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#EEF0ED",
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 8,
    overflow: "hidden",
  },

  stallHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },

  stallIconBox: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.mist,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 9,
  },

  rowInfo: {
    flex: 1,
  },

  buildingLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },

  rowBuilding: {
    fontSize: 9,
    fontFamily: fontFamily.medium,
    color: colors.textMuted,
  },

  occupantLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 2,
  },

  occupantName: {
    flexShrink: 1,
    fontSize: 9,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },

  occupantNameMissing: {
    color: colors.textMuted,
    fontFamily: fontFamily.medium,
  },

  rowSpace: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  statusPillOccupied: { backgroundColor: "#79EDC4" },
  statusPillUnoccupied: { backgroundColor: "#E8EAE9" },
  statusPillMaintenance: { backgroundColor: colors.errorSoft },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusDotOccupied: { backgroundColor: colors.emerald },
  statusDotUnoccupied: { backgroundColor: "#F2B6AA" },
  statusDotMaintenance: { backgroundColor: colors.error },
  statusPillText: {
    fontSize: 9,
    fontFamily: fontFamily.medium,
    color: colors.ink,
  },

  stallBtns: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 7,
    width: "100%",
  },

  buttonWrap: {
    flex: 1,
  },

  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },

  // ── Action buttons ────────────────────────────────────────────────────────────

  btnText: {
    fontSize: 10,
    fontFamily: fontFamily.semibold,
    color: colors.white,
    textAlign: "center",
  },

  btnTextOutline: {
    fontSize: 10,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
    textAlign: "center",
  },

  btnManage: {
    width: "100%",
    minHeight: 32,
    backgroundColor: colors.ink,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ scale: 1 }],
  },

  btnManagePressed: {
    backgroundColor: colors.white,
    transform: [{ scale: 0.97 }],
  },

  btnManageTextPressed: {
    color: colors.emerald,
  },

  btnEditRental: {
    width: "100%",
    minHeight: 32,
    backgroundColor: colors.mist,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ scale: 1 }],
  },

  btnEditRentalPressed: {
    backgroundColor: colors.emerald,
    borderColor: colors.emerald,
    transform: [{ scale: 0.97 }],
  },

  btnEditRentalTextPressed: {
    color: colors.white,
  },

  btnRegister: {
    width: "100%",
    minHeight: 32,
    backgroundColor: colors.emerald,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ scale: 1 }],
  },

  btnRegisterPressed: {
    backgroundColor: colors.white,
    transform: [{ scale: 0.97 }],
  },

  btnRegisterTextPressed: {
    color: colors.emeraldBright,
  },
});
