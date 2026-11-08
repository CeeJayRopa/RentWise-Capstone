import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
  Modal,
  Pressable,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, onSnapshot, query, where, type DocumentData, type QueryDocumentSnapshot } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { House, HelpCircle, Building2, SlidersHorizontal, ChevronsUpDown, Check, UserRound, Phone, AtSign } from "lucide-react-native";

import { auth } from "../../shared/services/auth";
import { db } from "../../shared/services/firestore";
import HelpTour, { HelpStep } from "../components/HelpTour";
import HelpSupportModal from "../components/HelpSupportModal";
import OwnerBellIcon from "../components/OwnerBellIcon";
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
  category: string;
  length: number | null;
  width: number | null;
  status: "occupied" | "unoccupied" | "maintenance";
  tenantId: string | null;
};

type TenantInfo = {
  firstName: string;
  lastName: string;
  username: string;
  contactNo: string;
  paymentSchedule: string;
  price: number | null;
  category: string;
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
  const [selectedStall, setSelectedStall] = useState<StallDoc | null>(null);
  const liveDocsRef = useRef<{
    stalls: QueryDocumentSnapshot<DocumentData>[] | null;
    users: QueryDocumentSnapshot<DocumentData>[] | null;
  }>({stalls: null, users: null});

  const [tourVisible, setTourVisible] = useState(false);
  const [helpSupportVisible, setHelpSupportVisible] = useState(false);
  const homeRef = useRef<View>(null);
  const bellRef = useRef<View>(null);
  const buildingDropdownRef = useRef<View>(null);
  const statusDropdownRef = useRef<View>(null);
  const statsRef = useRef<View>(null);
  const listRef = useRef<View>(null);

  const tourSteps: HelpStep[] = [
    { key: "home", ref: homeRef, title: "Home", description: "Takes you back to the dashboard.", edgeInset: "top", round: true },
    { key: "bell", ref: bellRef, title: "Notifications", description: "Shows admin updates waiting for your review, like payments and building changes.", edgeInset: "top", round: true },
    { key: "building", ref: buildingDropdownRef, title: "Building filter", description: "Switch between buildings to see only that building's stalls.", edgeInset: "top" },
    { key: "status", ref: statusDropdownRef, title: "Status filter", description: "Narrow the list to occupied or unoccupied stalls.", edgeInset: "top" },
    { key: "stats", ref: statsRef, title: "Units / Occupied / Vacant", description: "Total stalls in this building, and how many are currently occupied vs. vacant.", edgeInset: "top" },
    { key: "badge", ref: listRef, title: "Occupied / Unoccupied", description: "Shows whether a stall currently has a tenant. Occupied stalls also show the tenant's name.", edgeInset: "top" },
  ];

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) { router.replace("/login"); return; }
      setChecking(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (checking) return;
    const applyLiveData = () => {
      const live = liveDocsRef.current;
      if (!live.stalls || !live.users) return;
      const stalls: StallDoc[] = live.stalls.map((stallDoc) => {
        const data = stallDoc.data();
        return {
          id: stallDoc.id,
          buildingNumber: Number(data.buildingNumber ?? 0),
          spaceId: data.spaceId ?? "",
          name: data.name ?? "",
          price: Number(data.price ?? 0),
          paymentSchedule: data.paymentSchedule ?? "",
          category: data.category ?? "",
          length: Number.isFinite(Number(data.length)) ? Number(data.length) : null,
          width: Number.isFinite(Number(data.width)) ? Number(data.width) : null,
          status: data.status ?? "unoccupied",
          tenantId: data.tenantId ?? null,
        };
      });
      const map = new Map<string, TenantInfo>();
      live.users.forEach((userDoc) => {
        const data = userDoc.data();
        map.set(userDoc.id, {
          firstName: data.firstName ?? "",
          lastName: data.lastName ?? "",
          username: data.username ?? "",
          contactNo: data.contactNo ?? "",
          paymentSchedule: data.paymentSchedule ?? "",
          price: Number.isFinite(Number(data.price)) ? Number(data.price) : null,
          category: data.category ?? "",
        });
      });
      setAllStalls(stalls);
      setTenantMap(map);
      setLoading(false);
      void saveLocalCache("owner:stalls", {stalls, tenants: Array.from(map.entries())});
    };
    const unsubscribeStalls = onSnapshot(
      collection(db, "stalls"),
      (snap) => { liveDocsRef.current.stalls = snap.docs; applyLiveData(); },
      () => { void fetchData(); },
    );
    const unsubscribeUsers = onSnapshot(
      query(collection(db, "users"), where("role", "==", "tenant")),
      (snap) => { liveDocsRef.current.users = snap.docs; applyLiveData(); },
      () => { void fetchData(); },
    );
    return () => { unsubscribeStalls(); unsubscribeUsers(); };
  }, [checking]);

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
          category: data.category ?? "",
          length: Number.isFinite(Number(data.length)) ? Number(data.length) : null,
          width: Number.isFinite(Number(data.width)) ? Number(data.width) : null,
          status: data.status ?? "unoccupied",
          tenantId: data.tenantId ?? null,
        };
      });

      setAllStalls(stalls);

      const map = new Map<string, TenantInfo>();
      usersSnap.docs.forEach((doc) => {
        const data = doc.data();
        map.set(doc.id, {
          firstName: data.firstName ?? "",
          lastName: data.lastName ?? "",
          username: data.username ?? "",
          contactNo: data.contactNo ?? "",
          paymentSchedule: data.paymentSchedule ?? "",
          price: Number.isFinite(Number(data.price)) ? Number(data.price) : null,
          category: data.category ?? "",
        });
      });

      setTenantMap(map);
      await saveLocalCache("owner:stalls", {stalls, tenants: Array.from(map.entries())});
    } catch (error) {
      console.log("OWNER BUILDING ERROR:", error);
      const cached = await readLocalCache<{stalls: StallDoc[]; tenants: Array<[string, TenantInfo]>}>("owner:stalls");
      if (cached) {
        setAllStalls(cached.stalls);
        setTenantMap(new Map(cached.tenants));
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
          <Text style={styles.subHeaderTitle}>Stall Management</Text>
          <Text style={styles.viewOnly}>View only</Text>
        </View>
      </LinearGradient>

      {/* BODY */}
      <View style={styles.body}>
        <View style={styles.capacityCard} ref={statsRef} collapsable={false}>
          <View style={styles.capacityTotalBlock}>
            <Text style={styles.capacityEyebrow}>TOTAL UNITS</Text>
            <View style={styles.capacityValueRow}>
              <Text style={styles.capacityValue}>{buildingStalls.length}</Text>
              <Text style={styles.capacityUnit}>units</Text>
            </View>
            <Text style={styles.capacityCaption}>Allocated Market Capacity</Text>
          </View>
          <View style={styles.capacityStatusBlock}>
            <View style={styles.capacityStatusRow}>
              <View style={[styles.capacityDot, styles.capacityDotOccupied]} />
              <View>
                <Text style={styles.capacityStatusValue}>{String(occupiedCount).padStart(2, "0")} <Text style={styles.capacityOccupiedLabel}>Occupied</Text></Text>
                <Text style={styles.capacityStatusCaption}>Active Leases</Text>
              </View>
            </View>
            <View style={styles.capacityStatusRow}>
              <View style={[styles.capacityDot, styles.capacityDotVacant]} />
              <View>
                <Text style={styles.capacityStatusValue}>{String(vacantCount).padStart(2, "0")} <Text style={styles.capacityVacantLabel}>Vacant</Text></Text>
                <Text style={styles.capacityStatusCaption}>Available Spaces</Text>
              </View>
            </View>
          </View>
        </View>
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
              <Text style={styles.dropdownCaption}>Stalls</Text>
              <View style={styles.dropdownValueWrap}>
                <Text style={styles.dropdownValue} numberOfLines={1}>
                  {selectedBuilding !== null ? `Building ${selectedBuilding}` : "All Spaces"}
                </Text>
                <ChevronsUpDown size={14} color={colors.ink} />
              </View>
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
                    <Text style={[styles.dropdownItemText, selectedBuilding === null && styles.dropdownItemTextActive]}>All Spaces</Text>
                    {selectedBuilding === null && <Check size={15} color={colors.emerald} />}
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
                          selectedBuilding === num && styles.dropdownItemTextActive,
                        ]}
                      >
                        Building {num}
                      </Text>
                      {selectedBuilding === num && <Check size={15} color={colors.emerald} />}
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </View>

          {/* STATUS FILTER DROPDOWN */}
          <View style={styles.filterDropdownWrapper} ref={statusDropdownRef} collapsable={false}>
            <TouchableOpacity
              style={[styles.dropdownTrigger, styles.filterDropdownTrigger]}
              onPress={() => {
                setSheetVisible(false);
                setFilterSheetVisible((v) => !v);
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.dropdownCaption}>Filter</Text>
              <View style={styles.dropdownValueWrap}>
                <Text style={styles.dropdownValue} numberOfLines={1}>
                  {filter === "All" ? "All Statuses" : filter}
                </Text>
                <SlidersHorizontal size={15} color={colors.ink} />
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
                        {item === "All" ? "All Statuses" : item}
                      </Text>
                      {filter === item && <Check size={15} color={colors.emerald} />}
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </View>
        </View>

        {/* STATS ROW */}
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
              contentContainerStyle={[styles.stallGrid, { paddingBottom: insets.bottom + spacing.xl }]}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
              }
            >
              {displayedStalls.map((item) => (
                <StallRow key={item.id} stall={item} tenantMap={tenantMap} onPress={() => setSelectedStall(item)} />
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
      <HelpSupportModal visible={helpSupportVisible} steps={tourSteps} onClose={() => setHelpSupportVisible(false)} onReplayTour={() => setTourVisible(true)} />

      <StallDetailsModal
        stall={selectedStall}
        tenant={selectedStall?.tenantId ? tenantMap.get(selectedStall.tenantId) : undefined}
        onClose={() => setSelectedStall(null)}
      />
    </View>
  );
}

const STATUS_LABEL: Record<StallDoc["status"], string> = {
  occupied: "Occupied",
  unoccupied: "Vacant",
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
  onPress,
}: {
  stall: StallDoc;
  tenantMap: Map<string, TenantInfo>;
  onPress: () => void;
}) {
  const tenant = stall.tenantId ? tenantMap.get(stall.tenantId) : undefined;
  const tenantName = tenant ? `${tenant.firstName} ${tenant.lastName}`.trim() : "";
  const pill = STATUS_PILL[stall.status];
  const isOccupied = stall.status === "occupied";

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`View details for ${stall.spaceId}`}
      style={({ pressed }) => [styles.stallCard, isOccupied && styles.stallCardOccupied, pressed && styles.stallCardPressed]}
    >
      <View style={styles.stallCardTop}>
        <View style={[styles.buildingBadge, isOccupied && styles.buildingBadgeOccupied]}>
          <Text style={[styles.buildingBadgeText, isOccupied && styles.buildingBadgeTextOccupied]}>{`B${stall.buildingNumber}`}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: pill.bg }]}>
          <View style={[styles.statusDot, { backgroundColor: pill.fg }]} />
          <Text style={[styles.statusPillText, { color: isOccupied ? colors.ink : pill.fg }]}>{STATUS_LABEL[stall.status]}</Text>
        </View>
      </View>
      <Text style={styles.stallSpace} numberOfLines={1}>{stall.spaceId}</Text>
      <View style={[styles.stallCardFooter, isOccupied && styles.stallCardFooterOccupied]}>
        <Text style={[styles.stallTenantName, !isOccupied && styles.stallVacantName]} numberOfLines={1} ellipsizeMode="tail">
          {isOccupied ? (tenantName || "Tenant assigned") : "No tenant assigned"}
        </Text>
        <Text style={[styles.stallFooterCaption, isOccupied && styles.stallFooterCaptionOccupied]}>
          {isOccupied ? "Active Lease" : "Available Space"}
        </Text>
      </View>
    </Pressable>
  );
}

function titleCaseSchedule(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "Not set";
  if (normalized === "semi-monthly" || normalized === "semimonthly") return "Semi-monthly";
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function StallDetailsModal({
  stall,
  tenant,
  onClose,
}: {
  stall: StallDoc | null;
  tenant?: TenantInfo;
  onClose: () => void;
}) {
  if (!stall) return null;

  const occupied = stall.status === "occupied";
  const tenantName = tenant ? `${tenant.firstName} ${tenant.lastName}`.trim() : "";
  // This modal describes one physical stall. A tenant's `price` may be the
  // combined rate for as many as three stalls, so use the stall's own rate.
  const effectivePrice = stall.price;
  const effectiveSchedule = tenant?.paymentSchedule || stall.paymentSchedule;
  const effectiveCategory = tenant?.category || stall.category;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.detailsModal} onPress={(event) => event.stopPropagation()}>
          <View style={styles.detailsHeader}>
            <View>
              <Text style={styles.detailsEyebrow}>STALL INFORMATION</Text>
              <Text style={styles.detailsTitle}>{stall.spaceId}</Text>
            </View>
          </View>

          <View style={[styles.detailsStatus, { backgroundColor: STATUS_PILL[stall.status].bg }]}>
            <View style={[styles.statusDot, { backgroundColor: STATUS_PILL[stall.status].fg }]} />
            <Text style={[styles.detailsStatusText, { color: STATUS_PILL[stall.status].fg }]}>{STATUS_LABEL[stall.status]}</Text>
          </View>

          <View style={styles.detailsSection}>
            <Text style={styles.detailsSectionTitle}>Space details</Text>
            <DetailRow label="Building" value={`Building ${stall.buildingNumber}`} />
            <DetailRow label="Space" value={stall.spaceId || "Not set"} />
            {stall.name ? <DetailRow label="Stall name" value={stall.name} /> : null}
            <DetailRow label="Category" value={effectiveCategory || "Not set"} />
            {stall.length !== null && stall.width !== null ? <DetailRow label="Dimensions" value={`${stall.length} m × ${stall.width} m`} /> : null}
            <DetailRow label="Rent rate" value={`₱${effectivePrice.toLocaleString()} / day`} />
            <DetailRow label="Schedule" value={titleCaseSchedule(effectiveSchedule)} last />
          </View>

          <View style={styles.detailsSection}>
            <View style={styles.detailsSectionHeading}>
              <UserRound size={16} color={colors.emerald} />
              <Text style={styles.detailsSectionTitle}>Tenant information</Text>
            </View>
            {occupied ? (
              <>
                <DetailRow label="Tenant" value={tenantName || "Tenant assigned"} />
                {tenant?.username ? <DetailRow label="Username" value={tenant.username} icon={<AtSign size={14} color={colors.textSecondary} />} /> : null}
                {tenant?.contactNo ? <DetailRow label="Contact" value={tenant.contactNo} icon={<Phone size={14} color={colors.textSecondary} />} /> : null}
                <DetailRow label="Lease" value="Active Lease" last />
              </>
            ) : (
              <Text style={styles.noTenantText}>No tenant is currently assigned to this space.</Text>
            )}
          </View>

          <TouchableOpacity style={styles.detailsDoneButton} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.detailsDoneText}>Done</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function DetailRow({ label, value, icon, last = false }: { label: string; value: string; icon?: React.ReactNode; last?: boolean }) {
  return (
    <View style={[styles.detailRow, !last && styles.detailRowBorder]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <View style={styles.detailValueWrap}>
        {icon}
        <Text style={styles.detailValue}>{value}</Text>
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
    paddingTop: spacing.md,
  },

  capacityCard: {
    minHeight: 132,
    flexDirection: "row",
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
    paddingHorizontal: 22,
    paddingVertical: 18,
    borderTopWidth: 4,
    borderTopColor: colors.emerald,
    ...shadow.card,
  },
  capacityTotalBlock: { flex: 1.45, justifyContent: "center" },
  capacityEyebrow: { fontSize: 10, fontFamily: fontFamily.semibold, color: colors.textPrimary, letterSpacing: 1.1 },
  capacityValueRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 5 },
  capacityValue: { fontSize: 43, lineHeight: 47, fontFamily: fontFamily.extrabold, color: colors.ink },
  capacityUnit: { fontSize: fontSize.xs, fontFamily: fontFamily.medium, color: colors.textPrimary },
  capacityCaption: { marginTop: 3, fontSize: fontSize.xs, fontFamily: fontFamily.regular, color: colors.textSecondary },
  capacityStatusBlock: { flex: 1, justifyContent: "center", gap: 12, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border, paddingLeft: 18 },
  capacityStatusRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  capacityDot: { width: 11, height: 11, borderRadius: 6, ...shadow.card },
  capacityDotOccupied: { backgroundColor: colors.emerald },
  capacityDotVacant: { backgroundColor: "#E87500" },
  capacityStatusValue: { fontSize: fontSize.md, lineHeight: 20, fontFamily: fontFamily.bold, color: colors.ink },
  capacityOccupiedLabel: { fontSize: fontSize.xs, color: colors.emerald },
  capacityVacantLabel: { fontSize: fontSize.xs, color: colors.error },
  capacityStatusCaption: { fontSize: 9, fontFamily: fontFamily.regular, color: colors.textSecondary },

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
    minHeight: 51,
    alignItems: "flex-start",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },

  dropdownCaption: {
    fontSize: 9,
    fontFamily: fontFamily.bold,
    color: colors.emerald,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  dropdownValueWrap: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
  },

  dropdownValue: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  dropdown: {
    position: "absolute",
    top: 57,
    left: 0,
    right: 0,
    width: "100%",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    zIndex: 200,
    overflow: "hidden",
    ...shadow.raised,
  },

  dropdownInner: {
    borderRadius: radius.md,
    overflow: "hidden",
  },

  dropdownItem: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },

  dropdownItemActive: {
    backgroundColor: "#DDF3EA",
  },

  dropdownItemText: {
    fontSize: fontSize.sm,
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

  filterDropdownTrigger: {
    paddingHorizontal: spacing.md,
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
  stallGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },

  listCardCenteredBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xxxl + spacing.xl,
  },

  // ── Stall row ─────────────────────────────────────────────────────────────────

  stallCard: {
    width: "48%",
    minHeight: 165,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    overflow: "hidden",
    ...shadow.card,
  },
  stallCardOccupied: { backgroundColor: "#F0F9F5" },
  stallCardPressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
  stallCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: 14,
  },
  buildingBadge: {
    borderRadius: 5,
    backgroundColor: "#E7E9E8",
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  buildingBadgeOccupied: { backgroundColor: colors.ink },
  buildingBadgeText: {
    fontSize: 10,
    fontFamily: fontFamily.bold,
    color: colors.textPrimary,
  },
  buildingBadgeTextOccupied: { color: colors.white },
  stallSpace: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 20,
    fontSize: 29,
    lineHeight: 34,
    fontFamily: fontFamily.extrabold,
    color: colors.ink,
  },
  stallCardFooter: {
    minHeight: 54,
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: "#FAFBFA",
  },
  stallCardFooterOccupied: { backgroundColor: "#D9F1E7" },
  stallTenantName: { fontSize: fontSize.xs, fontFamily: fontFamily.bold, color: colors.ink },
  stallVacantName: { fontFamily: fontFamily.regular, fontStyle: "italic", color: colors.textPrimary },
  stallFooterCaption: { marginTop: 2, fontSize: 10, fontFamily: fontFamily.regular, color: colors.textSecondary },
  stallFooterCaptionOccupied: { color: colors.emerald },

  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },

  statusDot: { width: 6, height: 6, borderRadius: 3 },

  statusPillText: {
    fontSize: 10,
    fontFamily: fontFamily.medium,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    backgroundColor: "rgba(5, 35, 29, 0.55)",
  },
  detailsModal: {
    maxHeight: "88%",
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.white,
    ...shadow.card,
  },
  detailsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  detailsEyebrow: { fontSize: 10, fontFamily: fontFamily.bold, color: colors.textSecondary, letterSpacing: 0.8 },
  detailsTitle: { marginTop: 3, fontSize: 28, fontFamily: fontFamily.extrabold, color: colors.ink },
  detailsStatus: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5, marginTop: spacing.sm, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  detailsStatusText: { fontSize: fontSize.xs, fontFamily: fontFamily.bold },
  detailsSection: { marginTop: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg, backgroundColor: "#F5F8F6" },
  detailsSectionHeading: { flexDirection: "row", alignItems: "center", gap: 7 },
  detailsSectionTitle: { marginBottom: 3, fontSize: fontSize.sm, fontFamily: fontFamily.bold, color: colors.ink },
  detailRow: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, paddingVertical: 8 },
  detailRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  detailLabel: { flexShrink: 0, fontSize: fontSize.xs, fontFamily: fontFamily.regular, color: colors.textSecondary },
  detailValueWrap: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5 },
  detailValue: { flexShrink: 1, textAlign: "right", fontSize: fontSize.xs, fontFamily: fontFamily.bold, color: colors.ink },
  noTenantText: { paddingVertical: spacing.sm, fontSize: fontSize.xs, lineHeight: 18, fontFamily: fontFamily.regular, color: colors.textSecondary },
  detailsDoneButton: { minHeight: 46, alignItems: "center", justifyContent: "center", marginTop: spacing.lg, borderRadius: radius.md, backgroundColor: colors.ink },
  detailsDoneText: { fontSize: fontSize.sm, fontFamily: fontFamily.bold, color: colors.white },
});
