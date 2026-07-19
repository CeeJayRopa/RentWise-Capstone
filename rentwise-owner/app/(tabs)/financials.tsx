import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Image,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  TextInput,
  RefreshControl,
  Modal,
  Animated,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  getDocs,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { House, HelpCircle, Search, ChevronDown, FileText } from "lucide-react-native";

import { auth } from "../../shared/services/auth";
import { db } from "../../shared/services/firestore";
import HelpTour, { HelpStep } from "../components/HelpTour";
import { hasSeenPageTour, markPageTourSeen } from "../../shared/services/onboardingTour";
import { Badge, Button } from "../../shared/components/ui";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";

type StatusFilter = "All" | "Paid" | "Unpaid";
type DateFilter = "All" | "Daily" | "Weekly" | "Semi-Monthly" | "Monthly";

type ReceiptInfo = {
  receiptNo: string;
  tenantName: string;
  buildingNumber: string;
  spaceId: string;
  paymentMethod: string;
  date: Timestamp | null;
  rentAmount: number;
  payment: number;
  change: number;
};

type PaymentRow = {
  id: string;
  tenantName: string;
  buildingNumber: string;
  spaceId: string;
  amount: number;
  status: "paid" | "unpaid";
  date: Timestamp | null;
  receipt: ReceiptInfo | null;
};

function getDateRangeForSchedule(schedule: string): { start: Date; end: Date } {
  const now = new Date();
  switch (schedule) {
    case "daily": {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      return { start, end };
    }
    case "weekly": {
      const day = now.getDay();
      const start = new Date(now);
      start.setDate(now.getDate() - day);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    case "semi-monthly": {
      const d = now.getDate();
      if (d <= 15) {
        return {
          start: new Date(now.getFullYear(), now.getMonth(), 1),
          end: new Date(now.getFullYear(), now.getMonth(), 15, 23, 59, 59, 999),
        };
      }
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 16),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
      };
    }
    default: // monthly
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
      };
  }
}

function getDateRange(filter: DateFilter): { start: Date; end: Date } {
  return getDateRangeForSchedule(filter.toLowerCase());
}

// Mirrors rentwise-admin/app/tenant-preview.tsx's methodIcon — returns a
// logo image for wallet-based methods, or null for cash (no icon needed).
function methodIcon(paymentMethod: string | undefined) {
  const m = String(paymentMethod ?? "").toLowerCase();
  if (m.includes("gcash")) return require("../../assets/gcash.png");
  if (m.includes("maya")) return require("../../assets/maya-icon.png");
  return null;
}

export default function Financials() {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [dateFilter, setDateFilter] = useState<DateFilter>("All");
  const [search, setSearch] = useState("");
  const [showPeriodDropdown, setShowPeriodDropdown] = useState(false);
  const [viewingReceipt, setViewingReceipt] = useState<ReceiptInfo | null>(null);
  const [tourVisible, setTourVisible] = useState(false);
  const homeRef = useRef<View>(null);
  const summaryRef = useRef<View>(null);
  const searchRef = useRef<View>(null);
  const filterRef = useRef<View>(null);
  const cardColorRef = useRef<View>(null);
  const receiptBtnRef = useRef<View>(null);
  const listRef = useRef<FlatList<PaymentRow>>(null);

  // Sliding pill behind the status filter's selected option — segments are
  // different widths ("All" vs "Unpaid"), so the pill's x/width are driven
  // by each item's actual measured layout rather than an even 1/3 split.
  const segmentLayoutsRef = useRef<Record<StatusFilter, { x: number; width: number }>>({} as any);
  const pillX = useRef(new Animated.Value(0)).current;
  const pillWidth = useRef(new Animated.Value(0)).current;
  const pillReadyRef = useRef(false);

  const onSegmentLayout = (opt: StatusFilter, x: number, width: number) => {
    segmentLayoutsRef.current[opt] = { x, width };
    if (!pillReadyRef.current && opt === statusFilter) {
      pillReadyRef.current = true;
      pillX.setValue(x);
      pillWidth.setValue(width);
    }
  };

  const selectStatusFilter = (opt: StatusFilter) => {
    setStatusFilter(opt);
    const layout = segmentLayoutsRef.current[opt];
    if (layout) {
      Animated.parallel([
        Animated.timing(pillX, { toValue: layout.x, duration: 220, useNativeDriver: false }),
        Animated.timing(pillWidth, { toValue: layout.width, duration: 220, useNativeDriver: false }),
      ]).start();
    }
  };

  // Scrolls a given row into view and gives the FlatList time to settle
  // before HelpTour measures it — otherwise a row outside the currently
  // rendered window measures to nothing.
  const scrollListToIndex = (index: number) =>
    new Promise<void>((resolve) => {
      if (index < 0) { resolve(); return; }
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.3 });
      setTimeout(resolve, 400);
    });

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
      const seen = await hasSeenPageTour("owner-financials");
      if (!seen) {
        setTourVisible(true);
        await markPageTourSeen("owner-financials");
      }
    })();
  }, [checking]);

  useFocusEffect(useCallback(() => { if (!checking) fetchData(); }, [checking, dateFilter]));

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [usersSnap, stallsSnap, paymentsSnap] = await Promise.all([
        getDocs(query(collection(db, "users"), where("role", "==", "tenant"))),
        getDocs(collection(db, "stalls")),
        getDocs(query(collection(db, "payments"), where("status", "==", "approved"))),
      ]);

      const tenantMap = new Map<string, { name: string; stallId: string; status: string }>();
      usersSnap.docs.forEach((d) => {
        const data = d.data();
        tenantMap.set(d.id, {
          name: `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim(),
          stallId: data.stallId ?? "",
          status: data.status ?? "",
        });
      });

      const stallMap = new Map<string, { buildingNumber: string; spaceId: string; paymentSchedule: string }>();
      stallsSnap.docs.forEach((d) => {
        const data = d.data();
        stallMap.set(d.id, {
          buildingNumber: String(data.buildingNumber ?? ""),
          spaceId: data.spaceId ?? "",
          paymentSchedule: String(data.paymentSchedule ?? "").toLowerCase(),
        });
      });

      const scheduleKey = dateFilter === "All" ? null : dateFilter.toLowerCase();
      const fixedRange = dateFilter !== "All" ? getDateRange(dateFilter) : null;

      const paidUids = new Set<string>();
      const result: PaymentRow[] = [];

      paymentsSnap.docs.forEach((d) => {
        const data = d.data();
        const date = data.date as Timestamp | null;
        const dateMs = date?.toMillis ? date.toMillis() : 0;

        const uid = data.userId as string;
        const tenant = tenantMap.get(uid);
        if (!tenant || tenant.status !== "active") return;
        const stall = stallMap.get(tenant.stallId ?? "");
        if (scheduleKey && stall?.paymentSchedule !== scheduleKey) return;

        const range = fixedRange ?? getDateRangeForSchedule(stall?.paymentSchedule ?? "monthly");
        if (dateMs < range.start.getTime() || dateMs > range.end.getTime()) return;

        if (paidUids.has(uid)) return;
        paidUids.add(uid);
        const rentAmount = (data.rentAmount ?? data.amount ?? data.paymentAmount ?? 0) as number;
        const paymentAmt = (data.cashReceived ?? data.amount ?? data.paymentAmount ?? 0) as number;
        result.push({
          id: d.id,
          tenantName: tenant.name,
          buildingNumber: stall?.buildingNumber ?? "—",
          spaceId: stall?.spaceId ?? "—",
          amount: (data.amount ?? data.paymentAmount ?? 0) as number,
          status: "paid",
          date,
          receipt: {
            receiptNo: data.receiptNo ?? d.id,
            tenantName: tenant.name,
            buildingNumber: stall?.buildingNumber ?? "—",
            spaceId: stall?.spaceId ?? "—",
            paymentMethod: data.method === "cash" ? "Cash" : (data.paymentMethod ?? "Online"),
            date,
            rentAmount,
            payment: paymentAmt,
            change: (data.change ?? 0) as number,
          },
        });
      });

      usersSnap.docs.forEach((d) => {
        if (d.data().status !== "active") return;
        if (paidUids.has(d.id)) return;
        const tenant = tenantMap.get(d.id)!;
        const stall = stallMap.get(d.data().stallId ?? "");
        if (scheduleKey && stall?.paymentSchedule !== scheduleKey) return;
        result.push({
          id: `unpaid-${d.id}`,
          tenantName: tenant.name,
          buildingNumber: stall?.buildingNumber ?? "—",
          spaceId: stall?.spaceId ?? "—",
          amount: 0,
          status: "unpaid",
          date: null,
          receipt: null,
        });
      });

      setRows(result);
    } catch (err) {
      console.error("OWNER FINANCIALS ERROR:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (!checking) fetchData(); }, [dateFilter]);

  const filtered = rows
    .filter((r) => {
      if (statusFilter === "Paid" && r.status !== "paid") return false;
      if (statusFilter === "Unpaid" && r.status !== "unpaid") return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!r.tenantName.toLowerCase().includes(q) && !r.buildingNumber.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const bldCmp = a.buildingNumber.localeCompare(b.buildingNumber, undefined, { numeric: true });
      if (bldCmp !== 0) return bldCmp;
      return a.spaceId.localeCompare(b.spaceId, undefined, { numeric: true });
    });

  const firstReceiptIndex = filtered.findIndex((r) => r.status === "paid" && r.receipt);

  const tourSteps: HelpStep[] = [
    { key: "home", ref: homeRef, title: "Home", description: "Takes you back to the dashboard.", edgeInset: "top", round: true },
    { key: "summary", ref: summaryRef, title: "Spaces / Paid / Unpaid", description: "Total stalls tracked here, and how many tenants have paid vs. are still unpaid this period.", edgeInset: "top" },
    { key: "search", ref: searchRef, title: "Search", description: "Find a tenant fast by typing their name or building/space number.", edgeInset: "top" },
    { key: "filter", ref: filterRef, title: "Period & status filters", description: "Narrow the list by payment schedule (daily, weekly, etc.) or by paid/unpaid status.", edgeInset: "top" },
    {
      key: "cardcolor",
      ref: cardColorRef,
      title: "Paid / Unpaid badge",
      description: "A green Paid badge means the tenant already paid this period; red Unpaid means they haven't yet.",
      edgeInset: "top",
      onBeforeMeasure: () => scrollListToIndex(0),
    },
    ...(firstReceiptIndex !== -1
      ? [{
          key: "receipt",
          ref: receiptBtnRef,
          title: "Receipt",
          description: "Tap Receipt on a paid card to view the full payment breakdown.",
          edgeInset: "top" as const,
          onBeforeMeasure: () => scrollListToIndex(firstReceiptIndex),
        }]
      : []),
  ];

  const spacesCount = rows.length;
  const paidCount = rows.filter((r) => r.status === "paid").length;
  const unpaidCount = rows.filter((r) => r.status === "unpaid").length;

  if (checking) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator color={colors.emerald} size="large" />
      </View>
    );
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
          <TouchableOpacity onPress={() => setTourVisible(true)} activeOpacity={0.7} style={styles.headerIconBtn}>
            <HelpCircle size={22} color={colors.emeraldSoft} />
          </TouchableOpacity>
        </View>

        {/* Sub-header */}
        <View style={styles.subHeader}>
          <Text style={styles.subHeaderTitle}>Financials</Text>
          <Text style={styles.viewOnly}>View only</Text>
        </View>
      </LinearGradient>

      {/* Body */}
      <View style={styles.body}>
        {/* Summary stats */}
        <View style={styles.summaryRow} ref={summaryRef} collapsable={false}>
          <View style={[styles.summaryCard, styles.summaryCardSpaces]}>
            <Text style={styles.summaryLabelSpaces}>Spaces</Text>
            <Text style={styles.summaryValueSpaces}>{spacesCount}</Text>
          </View>
          <View style={[styles.summaryCard, styles.summaryCardPaid]}>
            <Text style={styles.summaryLabelPaid}>Paid</Text>
            <Text style={styles.summaryValuePaid}>{paidCount}</Text>
          </View>
          <View style={[styles.summaryCard, styles.summaryCardUnpaid]}>
            <Text style={styles.summaryLabelUnpaid}>Unpaid</Text>
            <Text style={styles.summaryValueUnpaid}>{unpaidCount}</Text>
          </View>
        </View>

        {/* Search bar */}
        <View style={styles.searchBar} ref={searchRef} collapsable={false}>
          <Search size={17} color={colors.emeraldBright} style={{ marginRight: 10 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search tenant or stall..."
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        {/* Filter row — compact period dropdown + status segment, side by side */}
        <View style={styles.filterRow} ref={filterRef} collapsable={false}>
          {/* Period dropdown */}
          <View style={[styles.dropdownWrapperCompact, showPeriodDropdown && { zIndex: 100, elevation: 10 }]}>
            <TouchableOpacity
              style={styles.dropdownTriggerCompact}
              onPress={() => setShowPeriodDropdown((v) => !v)}
              activeOpacity={0.8}
            >
              <Text style={styles.dropdownValueCompact} numberOfLines={1}>{dateFilter}</Text>
              <ChevronDown size={12} color={colors.emeraldBright} />
            </TouchableOpacity>
            {showPeriodDropdown && (
              <View style={styles.dropdownMenu}>
                {(["All", "Daily", "Weekly", "Semi-Monthly", "Monthly"] as DateFilter[]).map((d) => (
                  <TouchableOpacity
                    key={d}
                    style={[styles.dropdownItem, dateFilter === d && styles.dropdownItemActive]}
                    onPress={() => { setDateFilter(d); setShowPeriodDropdown(false); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.dropdownItemText, dateFilter === d && styles.dropdownItemTextActive]}>{d}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* Status filter — segmented control, matches admin's Financials exactly */}
          <View style={styles.segmentTrack}>
            <Animated.View
              style={[
                styles.segmentPill,
                { transform: [{ translateX: pillX }], width: pillWidth },
              ]}
              pointerEvents="none"
            />
            {(["All", "Paid", "Unpaid"] as StatusFilter[]).map((opt) => (
              <TouchableOpacity
                key={opt}
                style={styles.segmentItem}
                onPress={() => selectStatusFilter(opt)}
                onLayout={(e) => onSegmentLayout(opt, e.nativeEvent.layout.x, e.nativeEvent.layout.width)}
                activeOpacity={0.8}
              >
                <Text style={[styles.segmentText, statusFilter === opt && styles.segmentTextActive]}>
                  {opt}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* List */}
        {loading ? (
          <ActivityIndicator color={colors.emerald} size="large" style={styles.loader} />
        ) : (
          <FlatList
            ref={listRef}
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]}
            showsVerticalScrollIndicator={false}
            onScrollToIndexFailed={(info) => {
              setTimeout(() => {
                listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.3 });
              }, 100);
            }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />
            }
            ListEmptyComponent={
              <Text style={styles.empty}>
                {statusFilter === "Paid"
                  ? "No payments recorded yet."
                  : statusFilter === "Unpaid"
                  ? "All tenants are paid."
                  : "No tenant set in this payment schedule."}
              </Text>
            }
            renderItem={({ item, index }) => (
              <View style={styles.card} ref={index === 0 ? cardColorRef : undefined} collapsable={false}>
                <View style={styles.cardLeft}>
                  <View style={styles.rowMetaWrap}>
                    <Text style={styles.stallInfo}>
                      B{item.buildingNumber} · {item.spaceId}
                    </Text>
                    <Badge
                      label={item.status === "paid" ? "Paid" : "Unpaid"}
                      tone={item.status === "paid" ? "success" : "error"}
                    />
                  </View>
                  <Text style={styles.tenantName}>{item.tenantName}</Text>
                </View>
                {item.status === "paid" && item.receipt && (
                  <View ref={index === firstReceiptIndex ? receiptBtnRef : undefined} collapsable={false}>
                    <TouchableOpacity
                      style={styles.receiptBtn}
                      onPress={() => setViewingReceipt(item.receipt)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.receiptBtnText}>Receipt</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          />
        )}
      </View>

      {/* Receipt modal */}
      <Modal visible={!!viewingReceipt} transparent animationType="fade" onRequestClose={() => setViewingReceipt(null)}>
        <View style={styles.modalBg}>
          <View style={styles.modalBox}>
            <View style={styles.receiptHeaderRow}>
              <View style={styles.receiptBadge}>
                <FileText size={20} color={colors.emerald} />
              </View>
              <View>
                <Text style={styles.receiptEyebrow}>Tenant's</Text>
                <Text style={styles.receiptTitle}>Payment Receipt</Text>
              </View>
            </View>

            <View style={styles.receiptDetailsBox}>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Receipt No.</Text>
                <Text style={styles.receiptDetailValue}>{viewingReceipt?.receiptNo ?? ""}</Text>
              </View>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Tenant</Text>
                <Text style={styles.receiptDetailValue}>{viewingReceipt?.tenantName ?? ""}</Text>
              </View>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Building</Text>
                <Text style={styles.receiptDetailValue}>{viewingReceipt?.buildingNumber ?? ""}</Text>
              </View>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Space ID</Text>
                <Text style={styles.receiptDetailValue}>{viewingReceipt?.spaceId ?? ""}</Text>
              </View>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Date</Text>
                <Text style={styles.receiptDetailValue}>
                  {viewingReceipt?.date?.toDate?.().toLocaleDateString() ?? ""}
                </Text>
              </View>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Method</Text>
                <View style={styles.receiptMethodValueRow}>
                  {methodIcon(viewingReceipt?.paymentMethod) && (
                    <Image
                      source={methodIcon(viewingReceipt?.paymentMethod)}
                      style={styles.receiptMethodIcon}
                      resizeMode="contain"
                    />
                  )}
                  <Text style={styles.receiptDetailValue}>{viewingReceipt?.paymentMethod ?? ""}</Text>
                </View>
              </View>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Rent</Text>
                <Text style={styles.receiptDetailValue}>₱{viewingReceipt?.rentAmount ?? 0}</Text>
              </View>
              {(viewingReceipt?.change ?? 0) > 0 && (
                <View style={styles.receiptDetailRow}>
                  <Text style={styles.receiptDetailLabel}>Change</Text>
                  <Text style={styles.receiptDetailValue}>₱{viewingReceipt?.change}</Text>
                </View>
              )}
            </View>

            <View style={styles.modalButtons}>
              <Button
                label="Close"
                variant="primary"
                onPress={() => setViewingReceipt(null)}
                style={styles.receiptCloseBtn}
              />
            </View>
          </View>
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
    flex: 1,
    textAlign: "center",
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
    color: colors.white,
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

  body: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },

  // ── Summary stats — mirrors rentwise-admin/app/financials.tsx exactly ─────────

  summaryRow: {
    flexDirection: "row",
    gap: spacing.sm + 2,
    marginBottom: spacing.lg,
  },
  summaryCard: {
    flex: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg - 2,
  },
  summaryCardSpaces: { backgroundColor: colors.emerald },
  summaryCardPaid: { backgroundColor: colors.emeraldSoft },
  summaryCardUnpaid: { backgroundColor: colors.warningSoft },
  summaryLabelSpaces: {
    fontSize: fontSize.xs - 1,
    fontFamily: fontFamily.semibold,
    color: colors.emeraldSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  summaryLabelPaid: {
    fontSize: fontSize.xs - 1,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  summaryLabelUnpaid: {
    fontSize: fontSize.xs - 1,
    fontFamily: fontFamily.semibold,
    color: colors.warning,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  summaryValueSpaces: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.extrabold,
    color: colors.white,
    marginTop: 2,
  },
  summaryValuePaid: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.extrabold,
    color: colors.emerald,
    marginTop: 2,
  },
  summaryValueUnpaid: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.extrabold,
    color: colors.warning,
    marginTop: 2,
  },

  // ── Status filter — segmented control, mirrors admin exactly ─────────────────

  segmentTrack: {
    flexDirection: "row",
    backgroundColor: colors.mist,
    borderRadius: radius.pill,
    padding: 3,
    position: "relative",
  },
  segmentPill: {
    position: "absolute",
    top: 3,
    bottom: 3,
    left: 0,
    borderRadius: radius.pill,
    backgroundColor: colors.emerald,
  },
  segmentItem: {
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
  },
  segmentText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.textSecondary,
  },
  segmentTextActive: {
    color: colors.white,
  },

  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.emeraldSoft,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md + 2,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.base,
    fontFamily: fontFamily.medium,
    color: colors.ink,
    padding: 0,
  },

  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm + 2,
    marginBottom: spacing.lg,
    zIndex: 10,
  },
  dropdownWrapperCompact: {
    zIndex: 1,
  },
  dropdownTriggerCompact: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.emeraldSoft,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
  },
  dropdownValueCompact: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
  },
  dropdownMenu: {
    position: "absolute",
    top: 40,
    left: 0,
    minWidth: 150,
    zIndex: 200,
    elevation: 10,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.emeraldSoft,
    overflow: "hidden",
    ...shadow.raised,
  },
  dropdownItem: {
    paddingHorizontal: spacing.md + 2,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: colors.mist,
  },
  dropdownItemActive: {
    backgroundColor: colors.emeraldSoft,
  },
  dropdownItemText: {
    fontSize: fontSize.base,
    color: colors.textSecondary,
    fontFamily: fontFamily.regular,
  },
  dropdownItemTextActive: {
    color: colors.emerald,
    fontFamily: fontFamily.semibold,
  },

  loader: { marginTop: 60 },
  list: { gap: spacing.sm + 2, paddingBottom: 32 },
  empty: { textAlign: "center", color: colors.textSecondary, fontFamily: fontFamily.regular, marginTop: 60, fontSize: fontSize.base },

  card: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xl - 2,
    paddingVertical: spacing.lg,
  },
  cardLeft: { flex: 1, flexShrink: 1 },
  rowMetaWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  tenantName: { fontSize: fontSize.base, fontFamily: fontFamily.bold, color: colors.textPrimary, marginTop: spacing.xs + 2 },
  stallInfo: { fontSize: fontSize.xs, fontFamily: fontFamily.medium, color: colors.textMuted },

  receiptBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.emerald,
  },
  receiptBtnText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.bold,
    color: colors.white,
  },

  // ── Receipt modal — ported from rentwise-admin/app/tenant-preview.tsx's
  // digital receipt modal (digitalReceipt state / receiptHeaderRow styles) ────

  modalBg: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    alignItems: "center",
  },

  modalBox: {
    width: "88%",
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.xl,
    ...shadow.raised,
  },

  modalButtons: {
    flexDirection: "row",
    marginTop: spacing.lg,
    gap: spacing.sm + 2,
  },

  receiptHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },

  receiptBadge: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.emeraldSoft,
    alignItems: "center",
    justifyContent: "center",
  },

  receiptEyebrow: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },

  receiptTitle: {
    fontSize: fontSize.lg,
    fontFamily: fontFamily.extrabold,
    color: colors.ink,
  },

  receiptDetailsBox: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    backgroundColor: colors.mist,
    padding: spacing.lg,
  },

  receiptDetailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.xs + 2,
  },

  receiptDetailLabel: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
  },

  receiptDetailValue: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  receiptMethodValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  receiptMethodIcon: {
    width: 16,
    height: 16,
    borderRadius: 4,
  },

  receiptCloseBtn: {
    borderRadius: radius.pill,
  },
});
