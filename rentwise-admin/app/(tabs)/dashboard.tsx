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
  DocumentData,
  getDocs,
  onSnapshot,
  query,
  QueryDocumentSnapshot,
  where,
  Timestamp,
} from "firebase/firestore";
import Svg, { Circle } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  User,
  Wallet,
  HelpCircle,
  Store,
} from "lucide-react-native";

import { auth } from "../../shared/services/auth";
import { db } from "../../shared/services/firestore";
import { isTenantCaughtUp } from "../../shared/services/financeServices";
import { hasSeenAdminDashboardTour, markAdminDashboardTourSeen } from "../../shared/services/onboardingTour";
import NotificationBell from "../components/NotificationBell";
import HelpTour, { HelpStep } from "../components/HelpTour";
import HelpSupportModal from "../components/HelpSupportModal";
import { bottomNavRefs } from "../../shared/services/bottomNavRefs";
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

type FirestoreDoc = QueryDocumentSnapshot<DocumentData, DocumentData>;

function calculateDashboardStats(
  userDocs: FirestoreDoc[],
  stallDocs: FirestoreDoc[],
  paymentDocs: FirestoreDoc[],
  now = new Date(),
): Stats {
  const activeTenants = userDocs.filter((d) => d.data().status === "active");
  const occupiedCount = stallDocs.filter((d) => d.data().status === "occupied").length;
  const unoccupiedCount = stallDocs.filter((d) => d.data().status === "unoccupied").length;
  const approvedPayments = paymentDocs.filter((d) => d.data().status === "approved");

  const inRange = (d: FirestoreDoc, startMs: number, endMs: number) => {
    const date = d.data().date as Timestamp | undefined;
    if (!date?.toMillis) return false;
    const ms = date.toMillis();
    return ms >= startMs && ms <= endMs;
  };

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();
  const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  const yesterdayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999).getTime();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999).getTime();

  const todayPayments = approvedPayments.filter((d) => inRange(d, todayStart, todayEnd));
  const yesterdayPayments = approvedPayments.filter((d) => inRange(d, yesterdayStart, yesterdayEnd));
  const monthPayments = approvedPayments.filter((d) => inRange(d, monthStart, monthEnd));
  const lastMonthPayments = approvedPayments.filter((d) => inRange(d, lastMonthStart, lastMonthEnd));
  const sumAmounts = (docs: FirestoreDoc[]) =>
    docs.reduce((sum, d) => sum + Number(d.data().amount ?? d.data().paymentAmount ?? 0), 0);

  const paidCount = activeTenants.filter((d) => {
    const tenant = d.data();
    return isTenantCaughtUp(tenant.nextDueAt ?? tenant.billingStartedAt ?? tenant.createdAt, now);
  }).length;

  return {
    occupiedCount,
    unoccupiedCount,
    paidCount,
    unpaidCount: activeTenants.length - paidCount,
    collectedToday: sumAmounts(todayPayments),
    collectedYesterday: sumAmounts(yesterdayPayments),
    collectedThisMonth: sumAmounts(monthPayments),
    collectedLastMonth: sumAmounts(lastMonthPayments),
  };
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
  const [stats, setStats] = useState<Stats>(ZERO_STATS);
  const [focusTick, setFocusTick] = useState(0);
  const donutAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  const [tourVisible, setTourVisible] = useState(false);
  const [helpSupportVisible, setHelpSupportVisible] = useState(false);
  const profileRef = useRef<View>(null);
  const bellRef = useRef<View>(null);
  const helpRef = useRef<View>(null);
  const marketChartRef = useRef<View>(null);
  const financeChartRef = useRef<View>(null);
  const paymentStatusRef = useRef<View>(null);

  const tourSteps: HelpStep[] = [
    { key: "profile", ref: profileRef, title: "Profile", description: "View and edit your admin account details.", edgeInset: "top", round: true },
    { key: "bell", ref: bellRef, title: "Notifications", description: "Shows password reset requests and messages from the owner.", edgeInset: "top", round: true },
    { key: "market", ref: marketChartRef, title: "Market overview", description: "How many stalls are occupied vs. unoccupied right now.", edgeInset: "top" },
    { key: "finance", ref: financeChartRef, title: "Financial performance", description: "Amount collected today and this month, compared against the prior period.", edgeInset: "top" },
    { key: "payment", ref: paymentStatusRef, title: "Payment status", description: "How many active tenants have paid this month vs. are still unpaid.", edgeInset: "top" },
    { key: "navfinancials", ref: bottomNavRefs.financials, title: "Financials", description: "Track tenant payments, view receipts, and see who's paid or unpaid.", edgeInset: "bottom" },
    { key: "navbuilding", ref: bottomNavRefs.building, title: "Stall Management", description: "Browse every stall across all buildings, register tenants, and manage rentals.", edgeInset: "bottom" },
    { key: "navtenants", ref: bottomNavRefs.tenants, title: "Tenants", description: "View active tenants and archive their accounts.", edgeInset: "bottom" },
    { key: "navarchives", ref: bottomNavRefs.archives, title: "Archives", description: "View deactivated tenant accounts and restore them when needed.", edgeInset: "bottom" },
    { key: "navreports", ref: bottomNavRefs.reports, title: "Reports", description: "See the history of update reports you've submitted to the owner.", edgeInset: "bottom" },
    { key: "help", ref: helpRef, title: "Help", description: "Come back here anytime for a guided tour of this page.", edgeInset: "top", round: true },
  ];

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace("/");
        return;
      }
      setChecking(false);
      fetchData();
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
      if (!checking) fetchData(false);
      // Bumps on every focus (fresh app open and every navigate-back-to-
      // dashboard alike) so the donut/progress-bar animation below replays
      // each time, not just the first time real data arrives.
      setFocusTick((t) => t + 1);
    }, [checking]),
  );

  useEffect(() => {
    if (checking || !auth.currentUser) return;

    const tenantsQuery = query(collection(db, "users"), where("role", "==", "tenant"));
    let users: FirestoreDoc[] | null = null;
    let stalls: FirestoreDoc[] | null = null;
    let payments: FirestoreDoc[] | null = null;

    const updateDashboard = () => {
      if (!users || !stalls || !payments) return;
      setStats(calculateDashboardStats(users, stalls, payments));
      setLoading(false);
    };

    const unsubscribeUsers = onSnapshot(tenantsQuery, (snapshot) => {
      users = snapshot.docs;
      updateDashboard();
    });
    const unsubscribeStalls = onSnapshot(collection(db, "stalls"), (snapshot) => {
      stalls = snapshot.docs;
      updateDashboard();
    });
    const paymentWindowStart = Timestamp.fromDate(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1));
    const unsubscribePayments = onSnapshot(query(
      collection(db, "payments"),
      where("status", "==", "approved"),
      where("date", ">=", paymentWindowStart),
    ), (snapshot) => {
      payments = snapshot.docs;
      updateDashboard();
    });

    return () => {
      unsubscribeUsers();
      unsubscribeStalls();
      unsubscribePayments();
    };
  }, [checking]);

  const onRefresh = async () => {
    setRefreshing(true);
    // Pull-to-refresh already shows the native spinner via `refreshing` —
    // skip the full-screen loader so the existing content stays visible
    // instead of both spinners showing at once.
    await fetchData(false);
    setRefreshing(false);
  };

  const fetchData = async (showFullLoader = true) => {
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

      const [usersSnap, stallsSnap, paymentsSnap] = await Promise.all([
        getDocs(query(collection(db, "users"), where("role", "==", "tenant"))),
        getDocs(collection(db, "stalls")),
        getDocs(query(
          collection(db, "payments"),
          where("status", "==", "approved"),
          where("date", ">=", lastMonthStartTS),
        )),
      ]);

      const activeTenants = usersSnap.docs.filter((d) => d.data().status === "active");
      const occupiedCount = stallsSnap.docs.filter((d) => d.data().status === "occupied").length;
      const unoccupiedCount = stallsSnap.docs.filter((d) => d.data().status === "unoccupied").length;

      const inRange =(d: (typeof paymentsSnap.docs)[number], startMs: number, endMs: number) => {
        const date = d.data().date as Timestamp | undefined;
        if (!date?.toMillis) return false;
        const ms = date.toMillis();
        return ms >= startMs && ms <= endMs;
      };

      const todayPayments = paymentsSnap.docs.filter((d) => inRange(d, todayStartTS.toMillis(), todayEndTS.toMillis()));
      const yesterdayPayments = paymentsSnap.docs.filter((d) => inRange(d, yesterdayStartTS.toMillis(), yesterdayEndTS.toMillis()));
      const monthPayments = paymentsSnap.docs.filter((d) => inRange(d, monthStartTS.toMillis(), monthEndTS.toMillis()));
      const lastMonthPayments = paymentsSnap.docs.filter((d) => inRange(d, lastMonthStartTS.toMillis(), lastMonthEndTS.toMillis()));

      const sumAmounts = (docs: typeof paymentsSnap.docs) =>
        docs.reduce((sum, d) => sum + Number(d.data().amount ?? d.data().paymentAmount ?? 0), 0);
      const collectedToday = sumAmounts(todayPayments);
      const collectedYesterday = sumAmounts(yesterdayPayments);
      const collectedThisMonth = sumAmounts(monthPayments);
      const collectedLastMonth = sumAmounts(lastMonthPayments);

      // Caught-up-through-today accrual check (matches financials.tsx's
      // per-tenant logic) — NOT just "made any payment this month", which
      // overcounted tenants who'd only partially paid what's due.
      const paidCount = activeTenants.filter((d) => {
        const u = d.data();
        return isTenantCaughtUp(u.nextDueAt ?? u.billingStartedAt ?? u.createdAt, now);
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
      console.error("DASHBOARD FETCH ERROR:", err);
    } finally {
      setLoading(false);
    }
  };

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
      const seen = await hasSeenAdminDashboardTour();
      if (!seen) {
        setTourVisible(true);
        await markAdminDashboardTourSeen();
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

  const recentDailyTotal = stats.collectedToday + stats.collectedYesterday;
  const todayShare = recentDailyTotal > 0 ? (stats.collectedToday / recentDailyTotal) * 100 : 0;
  const yesterdayShare = recentDailyTotal > 0 ? (stats.collectedYesterday / recentDailyTotal) * 100 : 0;

  return (
    <View style={styles.screen}>
      {/* Header + market banner */}
      <LinearGradient
        colors={[colors.emerald, colors.ink]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
          <View ref={profileRef} collapsable={false}>
            <TouchableOpacity onPress={() => router.push("/admin-profile")} activeOpacity={0.7} style={styles.headerIconBtn}>
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
              <NotificationBell />
            </View>
            <View ref={helpRef} collapsable={false}>
              <TouchableOpacity onPress={() => setHelpSupportVisible(true)} activeOpacity={0.7} style={styles.headerIconBtn}>
                <HelpCircle size={24} color={colors.emeraldSoft} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={styles.banner}>
          <Text style={styles.bannerText}>Ka Domeng Talipapa Wet and Dry Market</Text>
        </View>
      </LinearGradient>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing.lg }]}
        showsVerticalScrollIndicator={false}
        scrollEnabled
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        overScrollMode="always"
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

            <View style={styles.paymentStatusCard} ref={paymentStatusRef} collapsable={false}>
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
  headerLogoWrap: {
    flex: 1,
    alignItems: "center",
  },
  headerLogo: { width: 130, height: 60, marginLeft: -62 },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
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

  banner: {
    paddingHorizontal: spacing.xl,
    paddingTop: 8,
    paddingBottom: spacing.sm + 2,
  },
  bannerText: { fontSize: fontSize.md, fontFamily: fontFamily.bold, color: colors.white },

  scroll: { flex: 1, minHeight: 0 },
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
});
