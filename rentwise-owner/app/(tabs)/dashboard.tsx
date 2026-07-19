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
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import Svg, { Circle } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  User,
  HelpCircle,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  TrendingDown,
} from "lucide-react-native";

import { auth } from "../../shared/services/auth";
import { db } from "../../shared/services/firestore";
import { isTenantPaidThisMonth } from "../../shared/services/financeServices";
import { hasSeenDashboardTour, markDashboardTourSeen } from "../../shared/services/onboardingTour";
import OwnerBellIcon from "../components/OwnerBellIcon";
import HelpTour, { HelpStep } from "../components/HelpTour";
import { bottomNavRefs } from "../components/bottomNavRefs";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type Stats = {
  tenantCount: number;
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
  tenantCount: 0,
  occupiedCount: 0,
  unoccupiedCount: 0,
  paidCount: 0,
  unpaidCount: 0,
  collectedToday: 0,
  collectedYesterday: 0,
  collectedThisMonth: 0,
  collectedLastMonth: 0,
};

function pctChange(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
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
  const [tourVisible, setTourVisible] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const donutAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const profileRef = useRef<View>(null);
  const bellRef = useRef<View>(null);
  const helpRef = useRef<View>(null);
  const marketChartRef = useRef<View>(null);
  const financeChartRef = useRef<View>(null);
  const collectedRef = useRef<View>(null);

  const tourSteps: HelpStep[] = [
    { key: "profile", ref: profileRef, title: "Profile", description: "View and edit your owner account details.", edgeInset: "top", round: true },
    { key: "bell", ref: bellRef, title: "Notifications", description: "Shows admin updates waiting for your review, like payments and building changes.", edgeInset: "top", round: true },
    { key: "help", ref: helpRef, title: "Help", description: "Come back here anytime for a guided tour of this page.", edgeInset: "top", round: true },
    { key: "market", ref: marketChartRef, title: "Market overview", description: "How many stalls are occupied vs. unoccupied right now.", edgeInset: "top" },
    { key: "finance", ref: financeChartRef, title: "Financial performance", description: "Amount collected today and this month, compared against the prior period.", edgeInset: "top" },
    { key: "collected", ref: collectedRef, title: "Payment status", description: "How many active tenants have paid this month vs. are still unpaid.", edgeInset: "top" },
    { key: "navfinancials", ref: bottomNavRefs.financials, title: "Financials", description: "Track tenant payments, view receipts, and see who's paid or unpaid.", edgeInset: "bottom" },
    { key: "navbuilding", ref: bottomNavRefs.building, title: "Building", description: "Browse every stall across your buildings and see which are occupied or vacant.", edgeInset: "bottom" },
    { key: "navadmins", ref: bottomNavRefs.admins, title: "Admins", description: "Manage the market admin's profile and login password.", edgeInset: "bottom" },
    { key: "navarchives", ref: bottomNavRefs.archives, title: "Archives", description: "View archived tenant accounts, and restore or permanently delete them.", edgeInset: "bottom" },
    { key: "navreports", ref: bottomNavRefs.reports, title: "Reports", description: "Download a daily PDF report of every update the admin made and you acknowledged.", edgeInset: "bottom" },
  ];

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) { router.replace("/login"); return; }
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
        getDocs(query(collection(db, "payments"), where("status", "==", "approved"))),
      ]);

      const activeTenants = usersSnap.docs.filter((d) => d.data().status === "active");
      const occupiedCount = stallsSnap.docs.filter((d) => d.data().status === "occupied").length;
      const unoccupiedCount = stallsSnap.docs.filter((d) => d.data().status === "unoccupied").length;

      const stallMap = new Map<string, { price: number; paymentSchedule: string }>();
      stallsSnap.docs.forEach((d) => {
        const sd = d.data();
        stallMap.set(d.id, {
          price: Number(sd.price ?? 0),
          paymentSchedule: (sd.paymentSchedule as string) ?? "monthly",
        });
      });

      const inRange = (d: (typeof paymentsSnap.docs)[number], startMs: number, endMs: number) => {
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
        const stall = stallMap.get(u.stallId as string);
        if (!stall) return false;
        const paidThisMonth = monthPayments
          .filter((p) => p.data().userId === d.id)
          .reduce((sum, p) => sum + ((p.data().amount ?? p.data().paymentAmount ?? 0) as number), 0);
        return isTenantPaidThisMonth(stall.price, stall.paymentSchedule, paidThisMonth, now);
      }).length;

      setStats({
        tenantCount: activeTenants.length,
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

  const todayChange = pctChange(stats.collectedToday, stats.collectedYesterday);
  const monthChange = pctChange(stats.collectedThisMonth, stats.collectedLastMonth);

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
              <TouchableOpacity onPress={() => setTourVisible(true)} activeOpacity={0.7} style={styles.helpBtn}>
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

              <View style={styles.overviewDivider} />

              <View style={styles.overviewRight}>
                <Text style={styles.overviewTotalLabel}>Total tenants</Text>
                <Text style={styles.overviewTotalValue}>{stats.tenantCount}</Text>

                <View style={styles.overviewSplitRow}>
                  <View style={styles.overviewSplitItem}>
                    <Text style={styles.overviewSplitLabelGreen}>Occupied</Text>
                    <Text style={styles.overviewSplitValue}>{stats.occupiedCount}</Text>
                  </View>
                  <View style={styles.overviewSplitDivider} />
                  <View style={styles.overviewSplitItem}>
                    <Text style={styles.overviewSplitLabel}>Vacant</Text>
                    <Text style={styles.overviewSplitValue}>{stats.unoccupiedCount}</Text>
                  </View>
                </View>
              </View>
            </View>
            </View>

            {/* Financial performance */}
            <View ref={financeChartRef} collapsable={false}>
            <Text style={[styles.sectionTitle, styles.financeSectionTitle]}>Financial performance</Text>
            <View style={styles.financeRow}>
              <View style={[styles.financeCard, { backgroundColor: colors.emerald }]}>
                <Text style={styles.financeCardLabel}>Today</Text>
                <Text style={styles.financeCardAmount}>{formatCurrency(stats.collectedToday)}</Text>
                <View style={styles.financeTrend}>
                  {todayChange >= 0 ? (
                    <TrendingUp size={13} color={colors.emeraldSoft} />
                  ) : (
                    <TrendingDown size={13} color={colors.emeraldSoft} />
                  )}
                  <Text style={styles.financeTrendText}>
                    {Math.abs(todayChange).toFixed(1)}% vs yesterday
                  </Text>
                </View>
              </View>

              <View style={[styles.financeCard, { backgroundColor: colors.ink }]}>
                <Text style={styles.financeCardLabel}>This month</Text>
                <Text style={styles.financeCardAmount}>{formatCurrency(stats.collectedThisMonth)}</Text>
                <View style={styles.financeTrend}>
                  {monthChange >= 0 ? (
                    <TrendingUp size={13} color={colors.emeraldSoft} />
                  ) : (
                    <TrendingDown size={13} color={colors.emeraldSoft} />
                  )}
                  <Text style={styles.financeTrendText}>
                    {Math.abs(monthChange).toFixed(1)}% vs last month
                  </Text>
                </View>
              </View>
            </View>
            </View>

            <View style={styles.paymentStatusCard} ref={collectedRef} collapsable={false}>
              <View style={styles.paymentStatusHeader}>
                <View>
                  <Text style={styles.paymentStatusTitle}>Payment status</Text>
                  <Text style={styles.paymentStatusSubtitle}>Current billing cycle</Text>
                </View>
                <Text style={styles.paymentStatusUnpaid}>{stats.unpaidCount} Unpaid</Text>
              </View>

              <View style={styles.paymentProgressTrack}>
                <Animated.View
                  style={[
                    styles.paymentProgressFill,
                    {
                      width: progressAnim.interpolate({
                        inputRange: [0, 100],
                        outputRange: ["0%", "100%"],
                        extrapolate: "clamp",
                      }),
                    },
                  ]}
                />
              </View>

              <View style={styles.paymentStatusRow}>
                <View style={styles.paymentStatusItem}>
                  <View style={styles.paymentStatusIconGreen}>
                    <CheckCircle2 size={16} color={colors.emerald} />
                  </View>
                  <View>
                    <Text style={styles.paymentStatusItemLabel}>PAID</Text>
                    <Text style={styles.paymentStatusItemValue}>{stats.paidCount}</Text>
                  </View>
                </View>

                <View style={styles.paymentStatusItem}>
                  <View style={styles.paymentStatusIconRed}>
                    <AlertCircle size={16} color={colors.error} />
                  </View>
                  <View>
                    <Text style={styles.paymentStatusItemLabel}>UNPAID</Text>
                    <Text style={styles.paymentStatusItemValue}>{stats.unpaidCount}</Text>
                  </View>
                </View>
              </View>
            </View>
          </>
        )}
      </ScrollView>

      <HelpTour visible={tourVisible} steps={tourSteps} onClose={() => setTourVisible(false)} />
    </View>
  );
}

function OccupancyDonut({
  percent,
  animatedPercent,
  size = 92,
  strokeWidth = 12,
}: {
  percent: number;
  animatedPercent: Animated.Value;
  size?: number;
  strokeWidth?: number;
}) {
  const radiusVal = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radiusVal;
  const animatedOffset = animatedPercent.interpolate({
    inputRange: [0, 100],
    outputRange: [circumference, 0],
    extrapolate: "clamp",
  });

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radiusVal}
          stroke={colors.emeraldSoft}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radiusVal}
          stroke={colors.emerald}
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={animatedOffset}
          strokeLinecap="round"
          fill="none"
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.donutCenter]}>
        <Text style={styles.donutPercent}>{Math.round(percent)}%</Text>
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
    marginLeft: 2,
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
    borderRadius: radius.lg,
    padding: spacing.lg + 2,
    marginBottom: spacing.lg,
    ...shadow.card,
  },
  donutCenter: {
    alignItems: "center",
    justifyContent: "center",
  },
  donutPercent: {
    fontSize: fontSize.lg,
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
  overviewDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    backgroundColor: colors.border,
    marginHorizontal: spacing.lg,
  },
  overviewRight: {
    flex: 1,
  },
  overviewTotalLabel: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
  },
  overviewTotalValue: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.extrabold,
    color: colors.textPrimary,
    marginTop: 2,
    marginBottom: spacing.sm + 2,
  },
  overviewSplitRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  overviewSplitItem: {
    flex: 1,
  },
  overviewSplitDivider: {
    width: StyleSheet.hairlineWidth,
    height: "100%",
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
  overviewSplitLabelGreen: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.medium,
    color: colors.emerald,
  },
  overviewSplitLabel: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
  },
  overviewSplitValue: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    color: colors.textPrimary,
    marginTop: 2,
  },

  financeRow: {
    flexDirection: "row",
    gap: spacing.sm + 2,
    marginBottom: spacing.lg,
  },
  financeCard: {
    flex: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow.card,
  },
  financeCardLabel: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.emeraldSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: spacing.sm,
  },
  financeCardAmount: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.extrabold,
    color: colors.white,
    marginBottom: spacing.sm,
  },
  financeTrend: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  financeTrendText: {
    fontSize: fontSize.xs - 1,
    fontFamily: fontFamily.medium,
    color: colors.emeraldSoft,
  },

  paymentStatusCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg + 2,
    marginBottom: spacing.lg,
    ...shadow.card,
  },
  paymentStatusHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: spacing.md + 2,
  },
  paymentStatusTitle: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    color: colors.textPrimary,
  },
  paymentStatusSubtitle: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    marginTop: 2,
  },
  paymentStatusUnpaid: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.error,
  },
  paymentProgressTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.mist,
    overflow: "hidden",
    marginBottom: spacing.lg,
  },
  paymentProgressFill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.emerald,
  },
  paymentStatusRow: {
    flexDirection: "row",
    gap: spacing.xl,
  },
  paymentStatusItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  paymentStatusIconGreen: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: colors.emeraldSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  paymentStatusIconRed: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: colors.errorSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  paymentStatusItemLabel: {
    fontSize: 10,
    fontFamily: fontFamily.semibold,
    color: colors.textMuted,
    letterSpacing: 0.3,
  },
  paymentStatusItemValue: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    color: colors.textPrimary,
    marginTop: 1,
  },
});
