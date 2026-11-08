import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
  Animated,
  Easing,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
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
import Svg, { Circle } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  User,
  HelpCircle,
  FileText,
  Store,
} from "lucide-react-native";

import { auth } from "../../shared/services/auth";
import { db } from "../../shared/services/firestore";
import { outstandingFromNextDue } from "../../shared/services/financeServices";
import { hasSeenDashboardTour, markDashboardTourSeen } from "../../shared/services/onboardingTour";
import OwnerBellIcon from "../components/OwnerBellIcon";
import HelpTour, { HelpStep } from "../components/HelpTour";
import HelpSupportModal from "../components/HelpSupportModal";
import { bottomNavRefs } from "../components/bottomNavRefs";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type Stats = {
  occupiedCount: number;
  unoccupiedCount: number;
  paidCount: number;
  unpaidCount: number;
  collectedToday: number;
  collectedYesterday: number;
  collectedThisMonth: number;
  collectedLastMonth: number;
};

const ZERO_STATS: Stats = {
  occupiedCount: 0,
  unoccupiedCount: 0,
  paidCount: 0,
  unpaidCount: 0,
  collectedToday: 0,
  collectedYesterday: 0,
  collectedThisMonth: 0,
  collectedLastMonth: 0,
};

type ReportStats = {
  pendingToday: number;
  acknowledgedToday: number;
  active: number;
};

const ZERO_REPORT_STATS: ReportStats = {
  pendingToday: 0,
  acknowledgedToday: 0,
  active: 0,
};

function localDayKey(date = new Date()): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatCurrency(amount: number): string {
  const [integer, decimal] = amount.toFixed(2).split(".");
  return `₱${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${decimal}`;
}

export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const liveRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveDocsRef = useRef<{
    users: QueryDocumentSnapshot<DocumentData>[] | null;
    stalls: QueryDocumentSnapshot<DocumentData>[] | null;
    payments: QueryDocumentSnapshot<DocumentData>[] | null;
  }>({users: null, stalls: null, payments: null});
  const [stats, setStats] = useState<Stats>(ZERO_STATS);
  const [reportStats, setReportStats] = useState<ReportStats>(ZERO_REPORT_STATS);
  const [reportDayKey, setReportDayKey] = useState(() => localDayKey());
  const [tourVisible, setTourVisible] = useState(false);
  const [helpSupportVisible, setHelpSupportVisible] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const donutAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const profileRef = useRef<View>(null);
  const bellRef = useRef<View>(null);
  const helpRef = useRef<View>(null);
  const marketChartRef = useRef<View>(null);
  const financeChartRef = useRef<View>(null);
  const collectedRef = useRef<View>(null);
  const reportsRef = useRef<View>(null);

  const tourSteps: HelpStep[] = [
    { key: "profile", ref: profileRef, title: "Profile", description: "View and edit your owner account details.", edgeInset: "top", round: true },
    { key: "bell", ref: bellRef, title: "Notifications", description: "Shows admin updates waiting for your review, like payments and building changes.", edgeInset: "top", round: true },
    { key: "market", ref: marketChartRef, title: "Market overview", description: "How many stalls are occupied vs. unoccupied right now.", edgeInset: "top" },
    { key: "finance", ref: financeChartRef, title: "Financial performance", description: "Amount collected today and this month, compared against the prior period.", edgeInset: "top" },
    { key: "collected", ref: collectedRef, title: "Payment status", description: "How many active tenants have paid this month vs. are still unpaid.", edgeInset: "top" },
    { key: "reportsSummary", ref: reportsRef, title: "Report status", description: "Today's acknowledged and pending reports, plus every older report that still needs your attention.", edgeInset: "top" },
    { key: "navfinancials", ref: bottomNavRefs.financials, title: "Financials", description: "Track tenant payments, view receipts, and see who's paid or unpaid.", edgeInset: "bottom" },
    { key: "navbuilding", ref: bottomNavRefs.building, title: "Stalls", description: "Browse every stall across your buildings and see which are occupied or vacant.", edgeInset: "bottom" },
    { key: "navadmins", ref: bottomNavRefs.admins, title: "Admin", description: "Manage the market admin's profile and login password.", edgeInset: "bottom" },
    { key: "navarchives", ref: bottomNavRefs.archives, title: "Archives", description: "View archived tenant accounts, and restore or permanently delete them.", edgeInset: "bottom" },
    { key: "navreports", ref: bottomNavRefs.reports, title: "Reports", description: "Download a daily PDF report of every update the admin made and you acknowledged.", edgeInset: "bottom" },
    { key: "help", ref: helpRef, title: "Help", description: "Come back here anytime for a guided tour of this page.", edgeInset: "top", round: true },
  ];

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      setChecking(false);
    });
    return unsub;
  }, []);

  useFocusEffect(
    useCallback(() => {
      // showFullLoader=false: the initial mount already gets its spinner
      // from `loading`'s default `true` state via the auth-resolved fetch
      // below. Forcing the full loader on every refocus too would hide the
      // donut/progress-bar behind a spinner for the whole refetch, so the
      // animation triggered by focusTick would finish invisibly before the
      // content ever reappears.
      // Bumps on every focus (fresh app open and every navigate-back-to-
      // dashboard alike) so the donut/progress-bar animation below replays
      // each time, not just the first time real data arrives.
      setFocusTick((t) => t + 1);
    }, [checking]),
  );

  useEffect(() => {
    if (checking || !auth.currentUser) return;
    const now = new Date();
    const paymentWindowStart = Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth() - 1, 1));

    const refreshFromLiveChange = () => {
      const live = liveDocsRef.current;
      if (!live.users || !live.stalls || !live.payments) return;
      const completeLive = {users: live.users, stalls: live.stalls, payments: live.payments};
      if (liveRefreshTimerRef.current) clearTimeout(liveRefreshTimerRef.current);
      liveRefreshTimerRef.current = setTimeout(() => fetchData(false, completeLive), 120);
    };

    const handleLiveError = (error: unknown) => {
      if (!auth.currentUser) return;
      console.error("OWNER DASHBOARD LIVE ERROR:", error);
    };

    const unsubscribeStalls = onSnapshot(collection(db, "stalls"), (snap) => {
      liveDocsRef.current.stalls = snap.docs;
      refreshFromLiveChange();
    }, handleLiveError);
    const unsubscribePayments = onSnapshot(
      query(
        collection(db, "payments"),
        where("status", "==", "approved"),
        where("date", ">=", paymentWindowStart),
      ),
      (snap) => {
        liveDocsRef.current.payments = snap.docs;
        refreshFromLiveChange();
      },
      handleLiveError,
    );
    const unsubscribeTenants = onSnapshot(
      query(collection(db, "users"), where("role", "==", "tenant")),
      (snap) => {
        liveDocsRef.current.users = snap.docs;
        refreshFromLiveChange();
      },
      handleLiveError,
    );

    return () => {
      unsubscribeStalls();
      unsubscribePayments();
      unsubscribeTenants();
      if (liveRefreshTimerRef.current) clearTimeout(liveRefreshTimerRef.current);
      liveRefreshTimerRef.current = null;
    };
  }, [checking, reportDayKey]);

  // Move the two daily report counters to a new day even if the dashboard
  // remains open across midnight. The underlying reports are never reset or
  // deleted here; only the date window changes.
  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timer = setTimeout(() => setReportDayKey(localDayKey()), nextMidnight.getTime() - now.getTime() + 250);
    return () => clearTimeout(timer);
  }, [reportDayKey]);

  // Use the same owner-scoped notification records as the Notifications page,
  // so the dashboard count always matches the reports the current owner can see.
  useEffect(() => {
    if (checking || !auth.currentUser) return;

    const ownerNotifications = query(
      collection(db, "notifications"),
      where("userId", "==", auth.currentUser.uid),
    );

    return onSnapshot(
      ownerNotifications,
      (snapshot) => {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
        let pendingToday = 0;
        let acknowledgedToday = 0;
        let active = 0;

        snapshot.docs.forEach((notification) => {
          const data = notification.data();
          const status = data.status as string | undefined;
          const submittedMs = data.createdAt?.toMillis?.();
          const isPending = status === "To be Acknowledged" || status === "To be Approved" || status === "Pending" || status === "Rejected";
          const isAcknowledged = status === "Acknowledged" || status === "Approved";
          const isToday = typeof submittedMs === "number" && submittedMs >= todayStart && submittedMs < tomorrowStart;

          if (isPending) active += 1;
          if (isToday && isPending) pendingToday += 1;
          if (isToday && isAcknowledged) acknowledgedToday += 1;
        });

        setReportStats({ pendingToday, acknowledgedToday, active });
      },
      (err) => {
        if (!auth.currentUser) return;
        console.error("OWNER REPORT SUMMARY ERROR:", err);
      },
    );
  }, [checking, reportDayKey]);

  const hasFinanceData = stats.paidCount + stats.unpaidCount > 0;
  const occupancyTotal = stats.occupiedCount + stats.unoccupiedCount;
  const occupancyPercent = occupancyTotal > 0 ? (stats.occupiedCount / occupancyTotal) * 100 : 0;
  const paidPercent = hasFinanceData ? (stats.paidCount / (stats.paidCount + stats.unpaidCount)) * 100 : 0;

  useEffect(() => {
    donutAnim.setValue(0);
    progressAnim.setValue(0);
    Animated.timing(donutAnim, {
      toValue: occupancyPercent,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    Animated.timing(progressAnim, {
      toValue: paidPercent,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick, occupancyPercent, paidPercent]);

  // Auto-opens the guided tour the very first time this device ever lands
  // on the dashboard (fresh install) — never again after that, since it
  // flips a persisted per-device flag. Users can still replay it anytime
  // via the Help button.
  useEffect(() => {
    if (checking) return;
    (async () => {
      const seen = await hasSeenDashboardTour();
      if (!seen) {
        setTourVisible(true);
        await markDashboardTourSeen();
      }
    })();
  }, [checking]);

  const onRefresh = async () => {
    setRefreshing(true);
    // Pull-to-refresh already shows the native spinner via `refreshing` —
    // skip the full-screen loader so the existing content stays visible
    // instead of both spinners showing at once.
    await fetchData(false);
    setRefreshing(false);
  };

  const fetchData = async (
    showFullLoader = true,
    liveDocs?: {users: QueryDocumentSnapshot<DocumentData>[]; stalls: QueryDocumentSnapshot<DocumentData>[]; payments: QueryDocumentSnapshot<DocumentData>[]},
  ) => {
    if (showFullLoader) setLoading(true);
    try {
      const now = new Date();
      const todayStartTS = Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0));
      const todayEndTS = Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999));
      const yesterdayStartTS = Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0));
      const yesterdayEndTS = Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999));
      const monthStartTS = Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth(), 1));
      const monthEndTS = Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999));
      const lastMonthStartTS = Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      const lastMonthEndTS = Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999));

      const snapshots = liveDocs ? null : await Promise.all([
        getDocs(query(collection(db, "users"), where("role", "==", "tenant"))),
        getDocs(collection(db, "stalls")),
        getDocs(query(
          collection(db, "payments"),
          where("status", "==", "approved"),
          where("date", ">=", lastMonthStartTS),
        )),
      ]);
      const usersDocs = liveDocs?.users ?? snapshots![0].docs;
      const stallsDocs = liveDocs?.stalls ?? snapshots![1].docs;
      const paymentsDocs = liveDocs?.payments ?? snapshots![2].docs;

      const activeTenants = usersDocs.filter((d) => d.data().status === "active");
      const occupiedCount = stallsDocs.filter((d) => d.data().status === "occupied").length;
      const unoccupiedCount = stallsDocs.filter((d) => d.data().status === "unoccupied").length;

      const inRange = (d: QueryDocumentSnapshot<DocumentData>, startMs: number, endMs: number) => {
        const date = d.data().date as Timestamp | undefined;
        if (!date?.toMillis) return false;
        const ms = date.toMillis();
        return ms >= startMs && ms <= endMs;
      };

      const todayPayments = paymentsDocs.filter((d) => inRange(d, todayStartTS.toMillis(), todayEndTS.toMillis()));
      const yesterdayPayments = paymentsDocs.filter((d) => inRange(d, yesterdayStartTS.toMillis(), yesterdayEndTS.toMillis()));
      const monthPayments = paymentsDocs.filter((d) => inRange(d, monthStartTS.toMillis(), monthEndTS.toMillis()));
      const lastMonthPayments = paymentsDocs.filter((d) => inRange(d, lastMonthStartTS.toMillis(), lastMonthEndTS.toMillis()));

      const sumAmounts = (docs: QueryDocumentSnapshot<DocumentData>[]) =>
        docs.reduce((sum, d) => sum + ((d.data().amount ?? d.data().paymentAmount ?? 0) as number), 0);
      const collectedToday = sumAmounts(todayPayments);
      const collectedYesterday = sumAmounts(yesterdayPayments);
      const collectedThisMonth = sumAmounts(monthPayments);
      const collectedLastMonth = sumAmounts(lastMonthPayments);

      // Caught-up-through-today accrual check (matches financials.tsx's
      // per-tenant logic) — NOT just "made any payment this month", which
      // overcounted tenants who'd only partially paid what's due.
      const paidCount = activeTenants.filter((d) => {
        const u = d.data();
        // Billing terms live on the tenant, not the stall -- travels with
        // them if relocated, instead of reflecting whoever's stall this is.
        if (!u.stallId) return false;
        const rawNextDue = u.nextDueAt ?? u.billingStartedAt ?? u.createdAt;
        const nextDueAt = rawNextDue?.toDate?.() ?? null;
        return outstandingFromNextDue(u.price ?? 0, u.paymentSchedule ?? "monthly", nextDueAt, now) <= 0;
      }).length;

      setStats({
        occupiedCount,
        unoccupiedCount,
        paidCount,
        unpaidCount: activeTenants.length - paidCount,
        collectedToday,
        collectedYesterday,
        collectedThisMonth,
        collectedLastMonth,
      });
    } catch (err) {
      console.error("OWNER DASHBOARD ERROR:", err);
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator color={colors.emerald} size="large" />
      </View>
    );
  }

  const recentDailyTotal = stats.collectedToday + stats.collectedYesterday;
  const todayShare = recentDailyTotal > 0 ? (stats.collectedToday / recentDailyTotal) * 100 : 0;
  const yesterdayShare = recentDailyTotal > 0 ? (stats.collectedYesterday / recentDailyTotal) * 100 : 0;

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
          <View ref={profileRef} collapsable={false}>
            <TouchableOpacity onPress={() => router.push("/owner-profile")} activeOpacity={0.7} style={styles.headerIconBtn}>
              <User size={24} color={colors.emeraldSoft} />
            </TouchableOpacity>
          </View>
          <View style={styles.headerLogoWrap}>
            <Image
              source={require("../../assets/rentwise-icon.png")}
              style={styles.headerLogo}
              resizeMode="contain"
            />
          </View>
          <View style={styles.headerRight}>
            <View ref={bellRef} collapsable={false}>
              <OwnerBellIcon />
            </View>
            <View ref={helpRef} collapsable={false}>
              <TouchableOpacity onPress={() => setHelpSupportVisible(true)} activeOpacity={0.7} style={styles.helpBtn}>
                <HelpCircle size={24} color={colors.emeraldSoft} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Market name banner */}
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Ka Domeng Talipapa Wet and Dry Market</Text>
        </View>
      </LinearGradient>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 20 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />
        }
      >
        {loading ? (
          <ActivityIndicator color={colors.emerald} size="large" style={styles.dataLoader} />
        ) : (
          <>
            {/* Market overview */}
            <View ref={marketChartRef} collapsable={false}>
            <Text style={styles.sectionTitle}>Market overview</Text>
            <View style={styles.overviewCard}>
              <OccupancyDonut percent={occupancyPercent} animatedPercent={donutAnim} />
              <View style={styles.overviewRight}>
                <View style={styles.stallOverviewItem}>
                  <View style={[styles.stallIconBox, styles.stallIconBoxOccupied]}>
                    <Store size={23} color={colors.emerald} strokeWidth={2.3} />
                  </View>
                  <View>
                    <Text style={styles.stallOverviewValue}>{stats.occupiedCount}</Text>
                    <Text style={styles.stallOverviewLabel}>Occupied stalls</Text>
                  </View>
                </View>
                <View style={styles.stallOverviewItem}>
                  <View style={styles.stallIconBox}>
                    <Store size={23} color={colors.textMuted} strokeWidth={2.3} />
                  </View>
                  <View>
                    <Text style={styles.stallOverviewValue}>{stats.unoccupiedCount}</Text>
                    <Text style={styles.stallOverviewLabel}>Vacant stalls</Text>
                  </View>
                </View>
              </View>
            </View>
            </View>

            {/* Financial performance */}
            <View ref={financeChartRef} collapsable={false}>
            <Text style={[styles.sectionTitle, styles.financeSectionTitle]}>Financial performance</Text>
            <View style={styles.financeSummaryCard}>
              <Text style={styles.financeSummaryLabel}>This month total</Text>
              <Text style={styles.financeSummaryAmount}>{formatCurrency(stats.collectedThisMonth)}</Text>
            </View>

            <View style={styles.financeDayRow}>
              <View style={styles.financeDayCard}>
                <View style={styles.financeDayHeader}>
                  <Text style={styles.financeDayLabel}>Today</Text>
                  <Text style={styles.financeDayPercent}>{todayShare.toFixed(1)}%</Text>
                </View>
                <Text style={styles.financeDayAmount}>{formatCurrency(stats.collectedToday)}</Text>
              </View>
              <View style={styles.financeDayCard}>
                <View style={styles.financeDayHeader}>
                  <Text style={styles.financeDayLabel}>Yesterday</Text>
                  <Text style={styles.financeYesterdayPercent}>+{yesterdayShare.toFixed(0)}%</Text>
                </View>
                <Text style={styles.financeDayAmount}>{formatCurrency(stats.collectedYesterday)}</Text>
              </View>
            </View>
            </View>

            <View style={styles.paymentStatusCard} ref={collectedRef} collapsable={false}>
              <View style={styles.paymentStatusHeader}>
                <Text style={styles.paymentStatusTitle}>Payment Status</Text>
                <View style={styles.paymentStatusBadge}>
                  <Text style={styles.paymentStatusUnpaid}>{stats.unpaidCount} Unpaid</Text>
                </View>
              </View>

              <View style={styles.paymentSegments}>
                {Array.from({ length: 10 }, (_, index) => {
                  const segmentStart = index * 10;
                  const segmentEnd = segmentStart + 10;
                  return (
                    <View
                      key={index}
                      style={[styles.paymentSegmentTrack, hasFinanceData && styles.paymentSegmentUnpaid]}
                    >
                      <Animated.View
                        style={[
                          styles.paymentSegmentPaid,
                          {
                            width: progressAnim.interpolate({
                              inputRange: [segmentStart, segmentEnd],
                              outputRange: ["0%", "100%"],
                              extrapolate: "clamp",
                            }),
                          },
                        ]}
                      />
                    </View>
                  );
                })}
              </View>

              <View style={styles.paymentStatusRow}>
                <View style={styles.paymentStatusItem}>
                  <View style={styles.paymentPaidDot} />
                  <Text style={styles.paymentStatusItemText}>Paid: <Text style={styles.paymentPaidValue}>{stats.paidCount}</Text></Text>
                </View>

                <View style={styles.paymentStatusItem}>
                  <View style={styles.paymentUnpaidDot} />
                  <Text style={styles.paymentStatusItemText}>Unpaid: <Text style={styles.paymentUnpaidValue}>{stats.unpaidCount}</Text></Text>
                </View>
              </View>
            </View>

            <View ref={reportsRef} collapsable={false}>
              <View style={styles.reportsSummaryCard}>
                <View style={styles.reportsSummaryHeader}>
                  <Text style={styles.paymentStatusTitle}>Reports Today</Text>
                  <Text style={styles.reportsResetText}>Resets automatically each day</Text>
                </View>

                <View style={styles.reportsTodayRow}>
                  <TouchableOpacity
                    style={styles.reportMetric}
                    activeOpacity={0.75}
                    onPress={() => router.push("/(tabs)/daily-reports")}
                  >
                    <Text style={[styles.reportMetricValue, styles.reportAcknowledgedValue]}>{reportStats.acknowledgedToday}</Text>
                    <Text style={styles.reportMetricLabel}>Acknowledged</Text>
                    <Text style={styles.reportMetricHint}>Reviewed today</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.reportMetric}
                    activeOpacity={0.75}
                    onPress={() => router.push("/notifications")}
                  >
                    <Text style={styles.reportMetricValue}>{reportStats.pendingToday}</Text>
                    <Text style={styles.reportMetricLabel}>Pending Reviews</Text>
                    <Text style={styles.reportMetricHint}>Needs review</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity
                style={styles.activeReportsCard}
                activeOpacity={0.78}
                onPress={() => router.push("/notifications")}
              >
                <View style={styles.activeReportsIcon}>
                  <FileText size={18} color={colors.ink} />
                </View>
                <View style={styles.activeReportsCopy}>
                  <Text style={styles.activeReportsTitle}>{reportStats.active} Active Report{reportStats.active !== 1 ? "s" : ""}</Text>
                  <Text style={styles.activeReportsSubtitle}>All reports still waiting for acknowledgment</Text>
                </View>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>

      <HelpTour visible={tourVisible} steps={tourSteps} onClose={() => setTourVisible(false)} />
      <HelpSupportModal visible={helpSupportVisible} steps={tourSteps} onClose={() => setHelpSupportVisible(false)} onReplayTour={() => setTourVisible(true)} />

    </View>
  );
}

function OccupancyDonut({
  percent,
  animatedPercent,
  size = 106,
  strokeWidth = 11,
}: {
  percent: number;
  animatedPercent: Animated.Value;
  size?: number;
  strokeWidth?: number;
}) {
  const radiusVal = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radiusVal;
  const segmentCount = 10;
  const segmentSlot = circumference / segmentCount;
  const segmentLength = segmentSlot * 0.5;
  const clampedPercent = Math.max(0, Math.min(100, percent));
  const displayedPercent = Number.isInteger(clampedPercent)
    ? clampedPercent.toFixed(0)
    : clampedPercent.toFixed(1);

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {Array.from({ length: segmentCount }, (_, index) => (
          <Circle
            key={index}
            cx={size / 2}
            cy={size / 2}
            r={radiusVal}
            stroke={colors.emeraldSoft}
            strokeWidth={strokeWidth}
            strokeDasharray={`${segmentLength} ${circumference - segmentLength}`}
            strokeLinecap="round"
            fill="none"
            rotation={-90 + index * (360 / segmentCount)}
            origin={`${size / 2}, ${size / 2}`}
          />
        ))}
        {Array.from({ length: segmentCount }, (_, index) => {
          const segmentStart = index * (100 / segmentCount);
          const segmentEnd = segmentStart + (100 / segmentCount);
          const fillFraction = Math.max(0, Math.min(1, (clampedPercent - segmentStart) / (segmentEnd - segmentStart)));
          if (fillFraction <= 0) return null;
          const activeLength = segmentLength * fillFraction;
          const opacity = animatedPercent.interpolate({
            inputRange: [segmentStart, Math.min(segmentEnd, Math.max(segmentStart + 0.01, clampedPercent))],
            outputRange: [0, 1],
            extrapolate: "clamp",
          });
          return (
            <AnimatedCircle
              key={`active-${index}`}
              cx={size / 2}
              cy={size / 2}
              r={radiusVal}
              stroke={colors.emerald}
              strokeWidth={strokeWidth}
              strokeDasharray={`${activeLength} ${circumference - activeLength}`}
              strokeLinecap="round"
              fill="none"
              opacity={opacity}
              rotation={-90 + index * (360 / segmentCount)}
              origin={`${size / 2}, ${size / 2}`}
            />
          );
        })}
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.donutCenter]}>
        <Text style={styles.donutPercent}>{displayedPercent}%</Text>
        <Text style={styles.donutLabel}>OCCUPIED</Text>
      </View>
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
  headerLogoWrap: { flex: 1, alignItems: "center" },
  headerLogo: { width: 112, height: 51, marginLeft: -62 },
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
  helpBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },

  banner: {
    paddingHorizontal: spacing.xl,
    paddingTop: 8,
    paddingBottom: spacing.sm + 2,
  },
  bannerText: { fontSize: fontSize.md, fontFamily: fontFamily.bold, color: colors.white },

  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  dataLoader: { marginTop: 60 },

  sectionTitle: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.bold,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: spacing.md,
  },
  financeSectionTitle: {
    marginTop: spacing.sm,
  },

  overviewCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.lg,
    marginBottom: spacing.lg,
    ...shadow.card,
  },
  donutCenter: {
    alignItems: "center",
    justifyContent: "center",
  },
  donutPercent: {
    fontSize: 24,
    fontFamily: fontFamily.extrabold,
    color: colors.textPrimary,
  },
  donutLabel: {
    fontSize: 8,
    fontFamily: fontFamily.semibold,
    color: colors.textMuted,
    letterSpacing: 0.3,
    marginTop: 1,
  },
  overviewRight: {
    flex: 1,
    gap: spacing.sm,
  },
  stallOverviewItem: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 58,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    gap: spacing.md,
  },
  stallIconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.border,
  },
  stallIconBoxOccupied: {
    backgroundColor: colors.emeraldSoft,
  },
  stallOverviewLabel: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
  },
  stallOverviewValue: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.extrabold,
    color: colors.textPrimary,
    lineHeight: 23,
  },

  financeSummaryCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    ...shadow.card,
  },
  financeSummaryLabel: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.textPrimary,
    textTransform: "uppercase",
    letterSpacing: 0.35,
  },
  financeSummaryAmount: {
    fontSize: 29,
    fontFamily: fontFamily.extrabold,
    color: colors.textPrimary,
    marginTop: spacing.md,
  },
  financeDayRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  financeDayCard: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...shadow.card,
  },
  financeDayHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  financeDayLabel: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.textPrimary,
    textTransform: "uppercase",
  },
  financeDayPercent: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
  },
  financeYesterdayPercent: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },
  financeDayAmount: {
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },

  paymentStatusCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  paymentStatusHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  paymentStatusTitle: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.bold,
    color: colors.textPrimary,
  },
  paymentStatusBadge: {
    backgroundColor: colors.errorSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  paymentStatusUnpaid: {
    fontSize: 9,
    fontFamily: fontFamily.semibold,
    color: colors.error,
  },
  paymentSegments: {
    flexDirection: "row",
    gap: 5,
    marginBottom: spacing.md,
  },
  paymentSegmentTrack: {
    flex: 1,
    height: 10,
    borderRadius: radius.pill,
    overflow: "hidden",
    backgroundColor: colors.mist,
  },
  paymentSegmentPaid: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.emerald,
  },
  paymentSegmentUnpaid: {
    backgroundColor: "#DDE2DF",
  },
  paymentStatusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  paymentStatusItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  paymentPaidDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.emerald,
  },
  paymentUnpaidDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.error,
  },
  paymentStatusItemText: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.medium,
    color: colors.textPrimary,
  },
  paymentPaidValue: {
    fontFamily: fontFamily.bold,
    color: colors.emerald,
  },
  paymentUnpaidValue: {
    fontFamily: fontFamily.bold,
    color: colors.error,
  },
  reportsSummaryCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  reportsSummaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  reportsResetText: {
    fontSize: 9,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
  },
  reportsTodayRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing.sm,
  },
  reportMetric: {
    flex: 1,
    minHeight: 72,
    justifyContent: "center",
    backgroundColor: colors.mist,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  reportMetricValue: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.extrabold,
    marginBottom: 1,
    color: colors.textPrimary,
  },
  reportAcknowledgedValue: { color: colors.textPrimary },
  reportMetricLabel: {
    fontSize: 10,
    fontFamily: fontFamily.medium,
    color: colors.textPrimary,
  },
  reportMetricHint: {
    fontSize: 9,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    marginTop: 1,
  },
  activeReportsCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#B8F4DE",
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    ...shadow.card,
  },
  activeReportsIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#6BEAC0",
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  activeReportsCopy: { flex: 1 },
  activeReportsTitle: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.bold,
    color: colors.textPrimary,
  },
  activeReportsSubtitle: {
    fontSize: 9,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
