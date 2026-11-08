import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Image,
  FlatList,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  TextInput,
  RefreshControl,
  Modal,
  Animated,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
  Timestamp,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { House, HelpCircle, Search, ChevronDown, FileText, Building2, CheckCircle2, AlertCircle, Clock, SlidersHorizontal, CalendarDays, ShieldCheck } from "lucide-react-native";

import { auth } from "../../shared/services/auth";
import { db } from "../../shared/services/firestore";
import { outstandingFromNextDue } from "../../shared/services/financeServices";
import HelpTour, { HelpStep } from "../components/HelpTour";
import HelpSupportModal from "../components/HelpSupportModal";
import OwnerBellIcon from "../components/OwnerBellIcon";
import { hasSeenPageTour, markPageTourSeen } from "../../shared/services/onboardingTour";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";
import { readLocalCache, saveLocalCache } from "../../shared/services/localCache";

type StatusFilter = "All" | "Paid" | "Unpaid" | "Pending";
type DateFilter = "All" | "Daily" | "Weekly" | "Semi-Monthly" | "Monthly";

function scheduleIntervalDays(value: string): number {
  const key = value.toLowerCase();
  if (key === "daily") return 1;
  if (key === "weekly") return 7;
  if (key === "semi-monthly") return 15;
  return 30;
}

function numericalScheduleLabel(value: string): string {
  if (value === "All") return "All";
  const days = scheduleIntervalDays(value);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

function settledReceiptAmount(data: DocumentData | undefined): number {
  const numeric = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : null;
  };
  const change = Math.max(0, numeric(data?.change) ?? 0);
  const tendered = numeric(data?.cashTendered ?? data?.cashReceived);
  if (tendered !== null) {
    return Math.max(0, numeric(data?.amountPaid) ?? tendered - change);
  }
  const submitted = numeric(data?.payment);
  if (change > 0 && submitted !== null && submitted > change) {
    return Math.max(0, submitted - change);
  }
  return Math.max(
    0,
    numeric(data?.amountPaid ?? data?.amount) ??
      submitted ??
      numeric(data?.rentAmount) ??
      0,
  );
}

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
  stalls?: Array<{ stallId: string; buildingNumber: string; spaceId: string; dailyRate?: number }>;
};

type PaymentRow = {
  id: string;
  tenantName: string;
  buildingNumber: string;
  spaceId: string;
  amount: number;
  dueAmount?: number;
  pendingAmount?: number;
  billingDaysDue?: number;
  paymentSchedule?: string;
  status: "paid" | "unpaid" | "pending";
  date: Timestamp | null;
  receipt: ReceiptInfo | null;
};

function rollingPeriodsDue(schedule: string, nextDueAt: Date | null, now: Date): number {
  if (!nextDueAt || Number.isNaN(nextDueAt.getTime()) || now < nextDueAt) return 0;
  const intervalDays = scheduleIntervalDays(schedule);
  return Math.floor((now.getTime() - nextDueAt.getTime()) / (intervalDays * 86400000)) + 1;
}

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
  const [pendingPaymentAmount, setPendingPaymentAmount] = useState(0);
  const [pendingPaymentCount, setPendingPaymentCount] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [dateFilter, setDateFilter] = useState<DateFilter>("All");
  const [search, setSearch] = useState("");
  const [showPeriodDropdown, setShowPeriodDropdown] = useState(false);
  const [viewingReceipt, setViewingReceipt] = useState<ReceiptInfo | null>(null);
  const [tourVisible, setTourVisible] = useState(false);
  const [helpSupportVisible, setHelpSupportVisible] = useState(false);
  const homeRef = useRef<View>(null);
  const bellRef = useRef<View>(null);
  const summaryRef = useRef<View>(null);
  const searchRef = useRef<View>(null);
  const filterRef = useRef<View>(null);
  const cardColorRef = useRef<View>(null);
  const receiptBtnRef = useRef<View>(null);
  const listRef = useRef<FlatList<PaymentRow>>(null);
  const liveRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveDocsRef = useRef<{
    users: QueryDocumentSnapshot<DocumentData>[] | null;
    stalls: QueryDocumentSnapshot<DocumentData>[] | null;
    approvedPayments: QueryDocumentSnapshot<DocumentData>[] | null;
    pendingPayments: QueryDocumentSnapshot<DocumentData>[] | null;
  }>({users: null, stalls: null, approvedPayments: null, pendingPayments: null});

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

  useEffect(() => {
    if (checking) return;
    let active = true;
    void readLocalCache<{rows: PaymentRow[]; pendingPaymentAmount: number; pendingPaymentCount?: number}>(
      `owner:financials:${dateFilter}`,
    ).then((cached) => {
      if (!active || !cached) return;
      const live = liveDocsRef.current;
      // Never let a slower cache read overwrite a complete live snapshot.
      if (live.users && live.stalls && live.approvedPayments && live.pendingPayments) return;
      setRows(cached.rows);
      setPendingPaymentAmount(cached.pendingPaymentAmount);
      setPendingPaymentCount(cached.pendingPaymentCount ?? 0);
      setLoading(false);
    }).catch((cacheError) => {
      console.warn("OWNER FINANCIALS CACHE ERROR:", cacheError);
    });
    return () => { active = false; };
  }, [checking, dateFilter]);

  useEffect(() => {
    if (checking) return;
    const now = new Date();
    // Match Admin Financials' recent receipt window. Month totals below are
    // still explicitly filtered to the current month.
    const paymentWindowStart = Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth() - 1, 1));

    const refreshFromLiveChange = () => {
      const live = liveDocsRef.current;
      if (!live.users || !live.stalls || !live.approvedPayments || !live.pendingPayments) return;
      const completeLive = {
        users: live.users,
        stalls: live.stalls,
        payments: [...live.approvedPayments, ...live.pendingPayments],
      };
      if (liveRefreshTimerRef.current) clearTimeout(liveRefreshTimerRef.current);
      liveRefreshTimerRef.current = setTimeout(() => fetchData(true, completeLive), 120);
    };

    const handleLiveError = (error: unknown) => {
      if (!auth.currentUser) return;
      console.error("OWNER FINANCIALS LIVE ERROR:", error);
      setLoading(false);
    };

    const unsubscribeTenants = onSnapshot(query(collection(db, "users"), where("role", "==", "tenant")), (snap) => {
      liveDocsRef.current.users = snap.docs;
      refreshFromLiveChange();
    }, handleLiveError);
    const unsubscribeStalls = onSnapshot(collection(db, "stalls"), (snap) => {
      liveDocsRef.current.stalls = snap.docs;
      refreshFromLiveChange();
    }, handleLiveError);
    const unsubscribeApprovedPayments = onSnapshot(query(
      collection(db, "payments"),
      where("status", "==", "approved"),
      where("date", ">=", paymentWindowStart),
    ), (snap) => {
      liveDocsRef.current.approvedPayments = snap.docs;
      refreshFromLiveChange();
    }, handleLiveError);
    const unsubscribePendingPayments = onSnapshot(query(
      collection(db, "payments"),
      where("status", "==", "pending"),
    ), (snap) => {
      liveDocsRef.current.pendingPayments = snap.docs;
      refreshFromLiveChange();
    }, handleLiveError);

    return () => {
      unsubscribeTenants();
      unsubscribeStalls();
      unsubscribeApprovedPayments();
      unsubscribePendingPayments();
      if (liveRefreshTimerRef.current) clearTimeout(liveRefreshTimerRef.current);
      liveRefreshTimerRef.current = null;
    };
  }, [checking, dateFilter]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const fetchData = async (
    silent = false,
    liveDocs?: {users: QueryDocumentSnapshot<DocumentData>[]; stalls: QueryDocumentSnapshot<DocumentData>[]; payments: QueryDocumentSnapshot<DocumentData>[]},
  ) => {
    if (!silent) setLoading(true);
    try {
      const now = new Date();
      const paymentWindowStart = Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      const snapshots = liveDocs ? null : await Promise.all([
        getDocs(query(collection(db, "users"), where("role", "==", "tenant"))),
        getDocs(collection(db, "stalls")),
        getDocs(query(collection(db, "payments"), where("status", "==", "approved"), where("date", ">=", paymentWindowStart))),
        getDocs(query(collection(db, "payments"), where("status", "==", "pending"))),
      ]);
      const usersDocs = liveDocs?.users ?? snapshots![0].docs;
      const stallsDocs = liveDocs?.stalls ?? snapshots![1].docs;
      const paymentsDocs = liveDocs?.payments ?? [...snapshots![2].docs, ...snapshots![3].docs];

      const paymentsByTenant = new Map<string, QueryDocumentSnapshot<DocumentData>[]>();
      paymentsDocs.forEach((payment) => {
        const tenantId = String(payment.data().userId ?? "");
        if (!tenantId) return;
        const tenantPayments = paymentsByTenant.get(tenantId);
        if (tenantPayments) tenantPayments.push(payment);
        else paymentsByTenant.set(tenantId, [payment]);
      });

      // paymentSchedule lives on the tenant, not the stall -- travels with
      // them if relocated, instead of reflecting whoever's stall this is.
      const tenantMap = new Map<string, { name: string; stallId: string; status: string; paymentSchedule: string; nextDueAt: Date | null }>();
      usersDocs.forEach((d) => {
        const data = d.data();
        tenantMap.set(d.id, {
          name: `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim(),
          stallId: data.stallId ?? "",
          status: data.status ?? "",
          paymentSchedule: String(data.paymentSchedule ?? "").toLowerCase(),
          nextDueAt: (data.nextDueAt ?? data.billingStartedAt ?? data.createdAt)?.toDate?.() ?? null,
        });
      });

      const stallMap = new Map<string, { buildingNumber: string; spaceId: string }>();
      stallsDocs.forEach((d) => {
        const data = d.data();
        stallMap.set(d.id, {
          buildingNumber: String(data.buildingNumber ?? ""),
          spaceId: data.spaceId ?? "",
        });
      });

      const scheduleKey = dateFilter === "All" ? null : dateFilter.toLowerCase();
      const result: PaymentRow[] = [];
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
      let pendingTotal = 0;
      let pendingCountTotal = 0;

      usersDocs.forEach((d) => {
        if (d.data().status !== "active") return;
        const tenant = tenantMap.get(d.id)!;
        const stall = stallMap.get(d.data().stallId ?? "");
        if (scheduleKey && tenant.paymentSchedule !== scheduleKey) return;

        const tenantPayments = paymentsByTenant.get(d.id) ?? [];
        const approvedThisMonth = tenantPayments.filter((payment) => {
          const data = payment.data();
          const paymentMs = (data.date as Timestamp | undefined)?.toMillis?.() ?? 0;
          return data.status === "approved" && paymentMs >= monthStart && paymentMs < monthEnd;
        });
        const paidThisMonth = approvedThisMonth.reduce(
          (sum, payment) => sum + Number(payment.data().amount ?? payment.data().paymentAmount ?? 0),
          0,
        );
        const dueAmount = outstandingFromNextDue(
          Number(d.data().price ?? 0),
          tenant.paymentSchedule || "monthly",
          tenant.nextDueAt,
          now,
        );
        const isPaid = dueAmount <= 0;
        const billingDaysDue = scheduleIntervalDays(tenant.paymentSchedule || "monthly") *
          rollingPeriodsDue(tenant.paymentSchedule || "monthly", tenant.nextDueAt, now);
        const pendingPayments = tenantPayments.filter((payment) => payment.data().status === "pending");
        const tenantPendingAmount = pendingPayments.reduce(
          (sum, payment) => sum + Number(payment.data().amount ?? payment.data().paymentAmount ?? 0),
          0,
        );
        if (pendingPayments.length > 0) pendingCountTotal += 1;
        pendingTotal += pendingPayments
          .reduce((sum, payment) => sum + Number(payment.data().amount ?? payment.data().paymentAmount ?? 0), 0);

        const latestApproved = tenantPayments.filter((payment) => payment.data().status === "approved").sort(
          (a, b) => ((b.data().date as Timestamp | undefined)?.toMillis?.() ?? 0) - ((a.data().date as Timestamp | undefined)?.toMillis?.() ?? 0),
        )[0];
        const paymentData = latestApproved?.data();
        const paymentDate = (paymentData?.date as Timestamp | null | undefined) ?? null;
        const rentAmount = Number(paymentData?.rentAmount ?? paymentData?.amount ?? paymentData?.paymentAmount ?? 0);
        const paymentAmount = settledReceiptAmount(paymentData);
        const receiptStalls = Array.isArray(paymentData?.stalls) && paymentData.stalls.length > 0
          ? paymentData.stalls
          : [...new Set([
              ...(Array.isArray(d.data().stallIds) ? d.data().stallIds.map(String) : []),
              String(d.data().primaryStallId ?? d.data().stallId ?? ""),
            ].filter(Boolean))].map((id) => ({stallId: id, ...(stallMap.get(id) ?? {buildingNumber: "", spaceId: id})}));

        result.push({
          id: d.id,
          tenantName: tenant.name,
          buildingNumber: stall?.buildingNumber ?? "—",
          spaceId: stall?.spaceId ?? "—",
          amount: paidThisMonth,
          dueAmount,
          pendingAmount: tenantPendingAmount,
          billingDaysDue,
          paymentSchedule: tenant.paymentSchedule || "monthly",
          status: pendingPayments.length > 0 ? "pending" : isPaid ? "paid" : "unpaid",
          date: paymentDate,
          receipt: isPaid && latestApproved ? {
            receiptNo: paymentData?.receiptNo ?? latestApproved.id,
            tenantName: tenant.name,
            buildingNumber: stall?.buildingNumber ?? "—",
            spaceId: stall?.spaceId ?? "—",
            paymentMethod: paymentData?.method === "cash" ? "Cash" : (paymentData?.paymentMethod ?? "Online"),
            date: paymentDate,
            rentAmount,
            payment: paymentAmount,
            change: Number(paymentData?.change ?? 0),
            stalls: receiptStalls,
          } : null,
        });
      });

      setRows(result);
      setPendingPaymentAmount(pendingTotal);
      setPendingPaymentCount(pendingCountTotal);
      void saveLocalCache(
        `owner:financials:${dateFilter}`,
        {rows: result, pendingPaymentAmount: pendingTotal, pendingPaymentCount: pendingCountTotal},
      ).catch((cacheError) => console.warn("OWNER FINANCIALS CACHE SAVE ERROR:", cacheError));
    } catch (err) {
      console.error("OWNER FINANCIALS ERROR:", err);
      const cached = await readLocalCache<{rows: PaymentRow[]; pendingPaymentAmount: number; pendingPaymentCount?: number}>(`owner:financials:${dateFilter}`);
      if (cached) {
        setRows(cached.rows);
        setPendingPaymentAmount(cached.pendingPaymentAmount);
        setPendingPaymentCount(cached.pendingPaymentCount ?? 0);
      }
    } finally {
      // Silent listener refreshes are also responsible for the first live
      // render, so they must release the initial loading state as well.
      setLoading(false);
    }
  };

  const filtered = rows
    .filter((r) => {
      if (statusFilter === "Paid" && r.status !== "paid") return false;
      if (statusFilter === "Unpaid" && r.status !== "unpaid") return false;
      if (statusFilter === "Pending" && r.status !== "pending") return false;
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
    { key: "bell", ref: bellRef, title: "Notifications", description: "Shows admin updates waiting for your review, like payments and building changes.", edgeInset: "top", round: true },
    { key: "summary", ref: summaryRef, title: "Payment summary", description: "Shows active spaces, paid and unpaid tenants, plus online payments waiting for confirmation.", edgeInset: "top" },
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
          title: "Payment receipt",
          description: "Tap a paid tenant card to view its full payment receipt.",
          edgeInset: "top" as const,
          onBeforeMeasure: () => scrollListToIndex(firstReceiptIndex),
        }]
      : []),
  ];

  const spacesCount = rows.length;
  const paidCount = rows.filter((r) => r.status === "paid").length;
  const unpaidCount = rows.filter((r) => r.status === "unpaid").length;
  const pendingCount = pendingPaymentCount;

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
          <View style={styles.headerSpacer} />
          <View style={styles.headerRight}>
            <View ref={bellRef} collapsable={false}>
              <OwnerBellIcon />
            </View>
            <TouchableOpacity onPress={() => setHelpSupportVisible(true)} activeOpacity={0.7} style={styles.headerIconBtn}>
              <HelpCircle size={22} color={colors.emeraldSoft} />
            </TouchableOpacity>
          </View>
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
          <View style={styles.summaryOverviewCard}>
            <View style={styles.summarySpacesBlock}>
              <Text style={styles.summaryTotalValue}>{spacesCount}</Text>
              <Text style={styles.summaryTotalLabel}>Total Spaces</Text>
              <Text style={styles.summaryTotalHint}>Active Lease Units</Text>
            </View>
            <View style={styles.summaryStatusList}>
              <View style={styles.summaryStatusRow}>
                <View style={styles.summaryStatusLabelWrap}>
                  <View style={[styles.summaryDot, styles.summaryDotPaid]} />
                  <Text style={styles.summaryStatusLabel}>Paid</Text>
                </View>
                <Text style={styles.summaryStatusValue}>{paidCount}</Text>
              </View>
              <View style={styles.summaryStatusRow}>
                <View style={styles.summaryStatusLabelWrap}>
                  <View style={[styles.summaryDot, styles.summaryDotUnpaid]} />
                  <Text style={styles.summaryStatusLabel}>Unpaid</Text>
                </View>
                <Text style={styles.summaryStatusValue}>{unpaidCount}</Text>
              </View>
              <View style={styles.summaryStatusRow}>
                <View style={styles.summaryStatusLabelWrap}>
                  <View style={[styles.summaryDot, styles.summaryDotPending]} />
                  <Text style={styles.summaryStatusLabel}>Pending</Text>
                </View>
                <Text style={[styles.summaryStatusValue, styles.summaryPendingValue]}>{pendingCount}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Search bar */}
        <View style={styles.searchBar} ref={searchRef} collapsable={false}>
          <Search size={14} color={colors.textSecondary} style={{ marginRight: 8 }} />
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
              <SlidersHorizontal size={12} color={colors.textSecondary} />
              <Text style={styles.dropdownValueCompact} numberOfLines={1}>Group: {numericalScheduleLabel(dateFilter)}</Text>
              <ChevronDown size={11} color={colors.textSecondary} />
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
                    <Text style={[styles.dropdownItemText, dateFilter === d && styles.dropdownItemTextActive]}>{numericalScheduleLabel(d)}</Text>
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
            {(["All", "Paid", "Unpaid", "Pending"] as StatusFilter[]).map((opt) => (
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
                  : statusFilter === "Pending"
                  ? "No pending payments."
                  : "No tenant set in this payment schedule."}
              </Text>
            }
            renderItem={({ item, index }) => {
              const isPaid = item.status === "paid";
              const isPending = item.status === "pending";
              const paymentDate = item.date?.toDate?.();
              const monthLabel = new Date().toLocaleDateString("en-PH", { month: "short" });
              const periodText = item.paymentSchedule === "monthly"
                ? `Period: 01–${new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()} ${monthLabel}`
                : `Period: ${item.paymentSchedule ?? "Current"}`;
              const dueDays = item.billingDaysDue ?? scheduleIntervalDays(item.paymentSchedule ?? "monthly");
              const numericalPeriodText = `Interval: ${dueDays} ${dueDays === 1 ? "day" : "days"}`;
              const amount = isPaid
                ? (item.receipt?.payment ?? item.amount)
                : isPending
                  ? (item.pendingAmount ?? 0)
                  : (item.dueAmount ?? 0);

              return (
                <Pressable
                  style={({ pressed }) => [
                    styles.card,
                    isPaid ? styles.cardPaid : isPending ? styles.cardPending : styles.cardUnpaid,
                    pressed && isPaid && item.receipt && { opacity: 0.82 },
                  ]}
                  ref={index === 0 ? cardColorRef : undefined}
                  collapsable={false}
                  onPress={() => { if (isPaid && item.receipt) setViewingReceipt(item.receipt); }}
                  disabled={!isPaid || !item.receipt}
                  accessibilityRole={isPaid && item.receipt ? "button" : undefined}
                  accessibilityLabel={isPaid && item.receipt ? `View payment receipt for ${item.tenantName}` : undefined}
                >
                  <View style={styles.cardTopRow}>
                    <View style={[styles.spacePill, isPaid && styles.spacePillPaid]}>
                      <Building2 size={12} color={colors.ink} />
                      <Text style={styles.spacePillText}>B{item.buildingNumber} • {item.spaceId}</Text>
                    </View>
                    <View style={[styles.statusPill, isPaid ? styles.statusPillPaid : isPending ? styles.statusPillPending : styles.statusPillUnpaid]}>
                      <View style={[styles.statusDot, isPaid ? styles.statusDotPaid : isPending ? styles.statusDotPending : styles.statusDotUnpaid]} />
                      <Text style={[styles.statusPillText, isPaid ? styles.statusTextPaid : isPending ? styles.statusTextPending : styles.statusTextUnpaid]}>
                        {isPaid ? "Paid" : isPending ? "Pending" : "Unpaid"}
                      </Text>
                    </View>
                  </View>

                  <View
                    style={styles.cardMiddleRow}
                    ref={index === firstReceiptIndex ? receiptBtnRef : undefined}
                    collapsable={false}
                  >
                    <View style={styles.cardTenantBlock}>
                      <Text style={styles.tenantName} numberOfLines={1}>{item.tenantName}</Text>
                    </View>
                  </View>

                  {!isPaid && <View style={styles.cardBottomRow}>
                    <View style={styles.cardDetailTextWrap}>
                      {isPaid ? <CheckCircle2 size={13} color={colors.emerald} /> : <CalendarDays size={13} color={colors.textSecondary} />}
                      <Text style={styles.cardDetailText} numberOfLines={1}>
                        {isPaid
                          ? `Settled ${paymentDate?.toLocaleDateString("en-PH", { day: "numeric", month: "short" }) ?? "—"}`
                          : numericalPeriodText}
                      </Text>
                    </View>
                    <Text style={[styles.cardAmount, isPending ? styles.cardAmountPending : !isPaid && styles.cardAmountDue]}>
                      ₱{amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{!isPaid ? " Due" : ""}
                    </Text>
                  </View>}
                </Pressable>
              );
            }}
          />
        )}
      </View>

      {/* Receipt modal */}
      <Modal visible={!!viewingReceipt} transparent animationType="fade" onRequestClose={() => setViewingReceipt(null)}>
        <View style={styles.modalBg}>
          <View style={styles.modalBox}>
            <View style={styles.receiptTenantBadge}>
              <FileText size={12} color={colors.emeraldSoft} />
              <Text style={styles.receiptTenantBadgeText}>TENANT'S</Text>
            </View>
            <Text style={styles.receiptTitle}>Payment Receipt</Text>
            <View style={styles.verifiedBadge}>
              <ShieldCheck size={13} color={colors.emerald} />
              <Text style={styles.verifiedBadgeText}>Settled &amp; Verified</Text>
            </View>

            <View style={styles.receiptAmountCard}>
              <View style={styles.amountDecorLeft} />
              <View style={styles.amountDecorRight} />
              <Text style={styles.receiptAmountLabel}>RENT</Text>
              <Text style={styles.receiptAmountValue}>₱{Number(viewingReceipt?.payment ?? 0).toLocaleString("en-PH")}</Text>
              <Text style={styles.receiptAmountCaption}>Total Settled Amount</Text>
            </View>

            <View style={styles.receiptPerforation}>
              {Array.from({ length: 12 }).map((_, index) => <View key={index} style={styles.receiptPerforationDot} />)}
            </View>

            <View style={styles.receiptNumberRow}>
              <Text style={styles.receiptNumberLabel}>Receipt No.</Text>
              <View style={styles.receiptNumberValueWrap}>
                <Text style={styles.receiptNumberValue} numberOfLines={1}>{viewingReceipt?.receiptNo ?? ""}</Text>
              </View>
            </View>

            <View style={styles.receiptInfoList}>
              <View style={styles.receiptInfoRow}>
                <Text style={styles.receiptInfoLabel}>Tenant</Text>
                <Text style={[styles.receiptInfoValue, styles.receiptTenantName]} numberOfLines={1}>{viewingReceipt?.tenantName ?? ""}</Text>
              </View>
              <View style={styles.receiptInfoRow}>
                <Text style={styles.receiptInfoLabel}>Premises</Text>
                <View style={styles.premisesValue}>
                  {(viewingReceipt?.stalls?.length ? viewingReceipt.stalls : [{buildingNumber: viewingReceipt?.buildingNumber ?? "", spaceId: viewingReceipt?.spaceId ?? ""}]).map((stall, index) => (
                    <Text key={`${stall.buildingNumber}-${stall.spaceId}-${index}`} style={styles.receiptInfoValue}>
                      Building {stall.buildingNumber} · Space {stall.spaceId}
                    </Text>
                  ))}
                </View>
              </View>
              <View style={styles.receiptInfoRow}>
                <Text style={styles.receiptInfoLabel}>Payment Date</Text>
                <Text style={styles.receiptInfoValue}>{viewingReceipt?.date?.toDate?.().toLocaleDateString("en-PH") ?? ""}</Text>
              </View>
              <View style={styles.receiptInfoRow}>
                <Text style={styles.receiptInfoLabel}>Payment Method</Text>
                <View style={styles.receiptMethodValueRow}>
                  {methodIcon(viewingReceipt?.paymentMethod) ? <Image source={methodIcon(viewingReceipt?.paymentMethod)} style={styles.receiptMethodIcon} resizeMode="contain" /> : <View style={styles.methodInitial}><Text style={styles.methodInitialText}>{(viewingReceipt?.paymentMethod ?? "P").charAt(0)}</Text></View>}
                  <Text style={styles.receiptInfoValue}>{viewingReceipt?.paymentMethod ?? ""}</Text>
                </View>
              </View>
              <View style={styles.receiptInfoRow}>
                <Text style={styles.receiptInfoLabel}>Payment Applied</Text>
                <Text style={[styles.receiptInfoValue, styles.receiptRentValue]}>₱{Number(viewingReceipt?.payment ?? 0).toLocaleString("en-PH")}</Text>
              </View>
            </View>

            <Pressable style={({ pressed }) => [styles.receiptCloseBtn, pressed && { opacity: 0.85 }]} onPress={() => setViewingReceipt(null)}>
              <Text style={styles.receiptCloseText}>Close</Text>
            </Pressable>
          </View>
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
    paddingBottom: 2,
    paddingHorizontal: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
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
  headerSpacer: { flex: 1 },

  subHeader: {
    paddingHorizontal: spacing.xl,
    paddingTop: 4,
    paddingBottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  subHeaderTitle: { fontSize: fontSize.md, fontFamily: fontFamily.semibold, color: colors.white },
  viewOnly: { fontSize: fontSize.sm, color: colors.emeraldSoft, fontFamily: fontFamily.regular, fontStyle: "italic" },

  body: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: spacing.md,
  },

  // ── Summary stats — mirrors rentwise-admin/app/financials.tsx exactly ─────────

  summaryRow: {
    width: "100%",
    marginBottom: spacing.sm,
  },
  summaryOverviewCard: {
    minHeight: 92,
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...shadow.card,
  },
  summarySpacesBlock: {
    flex: 1,
    justifyContent: "center",
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: "rgba(255,255,255,0.18)",
    paddingRight: spacing.lg,
  },
  summaryTotalValue: {
    fontSize: 27,
    lineHeight: 29,
    fontFamily: fontFamily.extrabold,
    color: colors.white,
  },
  summaryTotalLabel: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.bold,
    color: "#6DE8BE",
    textTransform: "uppercase",
    letterSpacing: 0.35,
    marginTop: 2,
  },
  summaryTotalHint: {
    fontSize: 8,
    fontFamily: fontFamily.regular,
    color: "rgba(255,255,255,0.65)",
    marginTop: 1,
  },
  summaryStatusList: {
    flex: 1,
    justifyContent: "space-between",
    paddingLeft: spacing.lg,
    paddingVertical: 1,
  },
  summaryStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  summaryStatusLabelWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  summaryDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  summaryDotPaid: { backgroundColor: "#64E7B8" },
  summaryDotUnpaid: { backgroundColor: "#F6A3A3" },
  summaryDotPending: { backgroundColor: "#F5C842" },
  summaryStatusLabel: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.medium,
    color: "rgba(255,255,255,0.78)",
    textTransform: "uppercase",
  },
  summaryStatusValue: {
    width: 20,
    textAlign: "right",
    fontSize: fontSize.sm,
    fontFamily: fontFamily.bold,
    color: colors.white,
    fontVariant: ["tabular-nums"],
  },
  summaryPendingValue: {
    color: "#F5C842",
  },
  summaryCard: {
    width: "23%",
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: "23%",
    minWidth: 0,
    minHeight: 58,
    borderRadius: radius.md,
    paddingVertical: 6,
    paddingHorizontal: 7,
    borderWidth: 1,
    borderColor: "transparent",
    overflow: "hidden",
  },
  summaryCardSpaces: { backgroundColor: colors.emerald },
  summaryCardPaid: { backgroundColor: colors.emeraldSoft, borderColor: colors.success },
  summaryCardUnpaid: { backgroundColor: colors.errorSoft, borderColor: colors.error },
  summaryCardPending: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
  summaryCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 2,
    minWidth: 0,
  },
  summaryLabelSpaces: {
    flexShrink: 1,
    fontSize: fontSize.xs - 1,
    fontFamily: fontFamily.semibold,
    color: colors.emeraldSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  summaryLabelPaid: {
    flexShrink: 1,
    fontSize: fontSize.xs - 1,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  summaryLabelUnpaid: {
    flexShrink: 1,
    fontSize: fontSize.xs - 1,
    fontFamily: fontFamily.semibold,
    color: colors.error,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  summaryValueSpaces: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.extrabold,
    color: colors.white,
    marginTop: 2,
  },
  summaryValuePaid: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.extrabold,
    color: colors.emerald,
    marginTop: 2,
  },
  summaryValueUnpaid: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.extrabold,
    color: colors.error,
    marginTop: 2,
  },
  summaryLabelPending: {
    flexShrink: 1,
    fontSize: fontSize.xs - 1,
    fontFamily: fontFamily.semibold,
    color: colors.warning,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  summaryValuePending: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.extrabold,
    color: colors.warning,
    marginTop: 2,
  },

  // ── Status filter — segmented control, mirrors admin exactly ─────────────────

  segmentTrack: {
    flexDirection: "row",
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: 3,
    position: "relative",
  },
  segmentPill: {
    position: "absolute",
    top: 3,
    bottom: 3,
    left: 0,
    borderRadius: radius.sm,
    backgroundColor: colors.ink,
  },
  segmentItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  segmentText: {
    fontSize: 9,
    fontFamily: fontFamily.medium,
    color: colors.ink,
  },
  segmentTextActive: {
    color: colors.white,
  },

  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.xs,
    fontFamily: fontFamily.regular,
    color: colors.ink,
    padding: 0,
  },

  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.md,
    zIndex: 10,
  },
  dropdownWrapperCompact: {
    zIndex: 1,
  },
  dropdownTriggerCompact: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 7,
    paddingHorizontal: spacing.sm,
  },
  dropdownValueCompact: {
    fontSize: 9,
    fontFamily: fontFamily.medium,
    color: colors.ink,
  },
  dropdownMenu: {
    position: "absolute",
    top: 34,
    left: 0,
    width: 126,
    zIndex: 200,
    elevation: 10,
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    ...shadow.raised,
  },
  dropdownItem: {
    minHeight: 34,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    justifyContent: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.mist,
  },
  dropdownItemActive: {
    backgroundColor: colors.emeraldSoft,
  },
  dropdownItemText: {
    fontSize: fontSize.xs,
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
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 9,
    overflow: "hidden",
    ...shadow.card,
  },
  cardPaid: { borderLeftWidth: 5, borderLeftColor: colors.emerald },
  cardUnpaid: { borderLeftWidth: 5, borderLeftColor: colors.error },
  cardPending: { borderLeftWidth: 5, borderLeftColor: colors.warning },
  cardTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  spacePill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#DDF4E9", borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 3 },
  spacePillPaid: { backgroundColor: "#A8F2D8" },
  spacePillText: { fontSize: 10, fontFamily: fontFamily.bold, color: colors.ink },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  statusPillPaid: { backgroundColor: "#BFF4E1" },
  statusPillUnpaid: { backgroundColor: "#FFE1E1" },
  statusPillPending: { backgroundColor: colors.warningSoft },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusDotPaid: { backgroundColor: colors.emerald },
  statusDotUnpaid: { backgroundColor: colors.error },
  statusDotPending: { backgroundColor: colors.warning },
  statusPillText: { fontSize: 10, fontFamily: fontFamily.semibold },
  statusTextPaid: { color: colors.emerald },
  statusTextUnpaid: { color: colors.error },
  statusTextPending: { color: colors.warning },
  cardMiddleRow: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 7 },
  cardTenantBlock: { flex: 1, minWidth: 0 },
  tenantName: { fontSize: fontSize.sm, fontFamily: fontFamily.bold, color: colors.textPrimary },
  paymentMethod: { marginTop: 1, fontSize: 10, fontFamily: fontFamily.regular, color: colors.textSecondary },
  cardBottomRow: { minHeight: 30, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 5, borderRadius: radius.sm, backgroundColor: colors.mist, paddingHorizontal: 8, paddingVertical: 5 },
  cardDetailTextWrap: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 5 },
  cardDetailText: { flex: 1, fontSize: 10, fontFamily: fontFamily.regular, color: colors.textPrimary },
  cardAmount: { fontSize: fontSize.xs, fontFamily: fontFamily.bold, color: colors.emerald },
  cardAmountDue: { color: colors.error },
  cardAmountPending: { color: colors.warning },

  receiptBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.ink,
  },
  receiptBtnPressed: {
    opacity: 0.8,
  },
  receiptBtnText: {
    fontSize: fontSize.xs,
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
    width: "92%",
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 16,
    ...shadow.raised,
  },
  receiptTenantBadge: { alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.pill, backgroundColor: colors.ink, paddingHorizontal: 10, paddingVertical: 3 },
  receiptTenantBadgeText: { color: colors.emeraldSoft, fontSize: 10, fontFamily: fontFamily.bold },
  receiptTitle: { marginTop: 6, textAlign: "center", fontSize: 24, fontFamily: fontFamily.extrabold, color: "#07140F" },
  verifiedBadge: { alignSelf: "center", marginTop: 3, flexDirection: "row", alignItems: "center", gap: 5, borderRadius: radius.pill, backgroundColor: "#C9F1E3", paddingHorizontal: 11, paddingVertical: 4 },
  verifiedBadgeText: { fontSize: fontSize.xs, fontFamily: fontFamily.medium, color: colors.ink },
  receiptAmountCard: { height: 122, marginTop: 14, borderRadius: radius.lg, backgroundColor: "#DDF4EA", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  amountDecorLeft: { position: "absolute", width: 82, height: 82, borderRadius: 41, top: -34, left: -20, backgroundColor: "#C2F3E2" },
  amountDecorRight: { position: "absolute", width: 102, height: 102, borderRadius: 51, right: -25, bottom: -38, backgroundColor: "rgba(8,74,57,0.06)" },
  receiptAmountLabel: { fontSize: fontSize.xs, fontFamily: fontFamily.medium, color: colors.textPrimary },
  receiptAmountValue: { marginTop: 2, fontSize: 35, lineHeight: 40, fontFamily: fontFamily.extrabold, color: colors.ink },
  receiptAmountCaption: { fontSize: fontSize.xs, fontFamily: fontFamily.medium, color: colors.emerald },
  receiptPerforation: { height: 40, flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingHorizontal: 10 },
  receiptPerforationDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#E1E3E2" },
  receiptNumberRow: { height: 30, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: radius.sm, backgroundColor: colors.mist, paddingHorizontal: 10 },
  receiptNumberLabel: { fontSize: fontSize.xs, fontFamily: fontFamily.regular, color: colors.textPrimary },
  receiptNumberValueWrap: { maxWidth: "70%", flexDirection: "row", alignItems: "center", gap: 6 },
  receiptNumberValue: { flexShrink: 1, fontSize: 10, fontFamily: fontFamily.bold, color: colors.ink, letterSpacing: 0.35 },
  receiptInfoList: { marginTop: 9, gap: 1 },
  receiptInfoRow: { minHeight: 35, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  receiptInfoLabel: { fontSize: fontSize.sm, fontFamily: fontFamily.regular, color: colors.textPrimary },
  receiptInfoValue: { flexShrink: 1, textAlign: "right", fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.ink },
  receiptTenantName: { fontSize: fontSize.base, fontFamily: fontFamily.bold },
  premisesValue: { flexDirection: "row", alignItems: "center", gap: 7 },
  spaceBadge: { overflow: "hidden", borderRadius: 6, backgroundColor: "#E7E9E8", paddingHorizontal: 8, paddingVertical: 3, fontSize: fontSize.xs, fontFamily: fontFamily.bold, color: colors.ink },

  receiptMethodValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  receiptMethodIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  methodInitial: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#1677F2" },
  methodInitialText: { color: colors.white, fontSize: 10, fontFamily: fontFamily.bold },
  receiptRentValue: { fontSize: fontSize.base, fontFamily: fontFamily.extrabold },
  receiptCloseBtn: { height: 52, marginTop: 15, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.ink, ...shadow.card },
  receiptCloseText: { fontSize: fontSize.base, fontFamily: fontFamily.bold, color: colors.white },
});
