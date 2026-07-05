import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
  RefreshControl,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  getDocs,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { PieChart } from "react-native-chart-kit";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Menu, Wallet } from "lucide-react-native";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import { getPaidTenantUserIds } from "../shared/services/financeServices";
import Sidebar from "./components/Sidebar";
import NotificationBell from "./components/NotificationBell";
import UpdatesReportFAB from "./components/UpdatesReportFAB";

const SCREEN_WIDTH = Dimensions.get("window").width;
const CHART_WIDTH = SCREEN_WIDTH - 68;

const CHART_CONFIG = {
  backgroundColor: "#ffffff",
  backgroundGradientFrom: "#ffffff",
  backgroundGradientTo: "#ffffff",
  color: (opacity = 1) => `rgba(12, 45, 107, ${opacity})`,
};

type Stats = {
  tenantCount: number;
  occupiedCount: number;
  unoccupiedCount: number;
  paidCount: number;
  unpaidCount: number;
  collectedToday: number;
  collectedThisMonth: number;
};

const ZERO_STATS: Stats = {
  tenantCount: 0,
  occupiedCount: 0,
  unoccupiedCount: 0,
  paidCount: 0,
  unpaidCount: 0,
  collectedToday: 0,
  collectedThisMonth: 0,
};

function formatCurrency(amount: number): string {
  const [integer, decimal] = amount.toFixed(2).split(".");
  return `₱${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${decimal}`;
}

function StatCard({ label, value, numColor }: { label: string; value: string | number; numColor: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, { color: numColor }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<Stats>(ZERO_STATS);
  const [sidebarVisible, setSidebarVisible] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) { router.replace("/"); return; }
      setChecking(false);
      fetchData();
    });
    return unsub;
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!checking) fetchData();
    }, [checking]),
  );

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
      const monthStartTS = Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth(), 1));
      const monthEndTS = Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999));

      const [usersSnap, stallsSnap, paymentsSnap] = await Promise.all([
        getDocs(query(collection(db, "users"), where("role", "==", "tenant"))),
        getDocs(collection(db, "stalls")),
        getDocs(query(collection(db, "payments"), where("status", "==", "approved"))),
      ]);

      const activeTenants = usersSnap.docs.filter((d) => d.data().status === "active");
      const occupiedCount = stallsSnap.docs.filter((d) => d.data().status === "occupied").length;
      const unoccupiedCount = stallsSnap.docs.filter((d) => d.data().status === "unoccupied").length;

      const todayStartMs = todayStartTS.toMillis();
      const todayEndMs = todayEndTS.toMillis();
      const monthStartMs = monthStartTS.toMillis();
      const monthEndMs = monthEndTS.toMillis();

      const todayPayments = paymentsSnap.docs.filter((d) => {
        const date = d.data().date as Timestamp | undefined;
        if (!date?.toMillis) return false;
        return date.toMillis() >= todayStartMs && date.toMillis() <= todayEndMs;
      });
      const monthPayments = paymentsSnap.docs.filter((d) => {
        const date = d.data().date as Timestamp | undefined;
        if (!date?.toMillis) return false;
        return date.toMillis() >= monthStartMs && date.toMillis() <= monthEndMs;
      });

      const paidUids = getPaidTenantUserIds(monthPayments);
      const sumAmounts = (docs: typeof paymentsSnap.docs) =>
        docs.reduce((sum, d) => sum + ((d.data().amount ?? d.data().paymentAmount ?? 0) as number), 0);
      const collectedToday = sumAmounts(todayPayments);
      const collectedThisMonth = sumAmounts(monthPayments);
      const paidCount = activeTenants.filter((d) => paidUids.has(d.id)).length;

      setStats({
        tenantCount: activeTenants.length,
        occupiedCount,
        unoccupiedCount,
        paidCount,
        unpaidCount: activeTenants.length - paidCount,
        collectedToday,
        collectedThisMonth,
      });
    } catch (err) {
      console.error("DASHBOARD FETCH ERROR:", err);
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator color="#0C2D6B" size="large" />
      </View>
    );
  }

  const marketPieData = [
    { name: "Occupied",   population: stats.occupiedCount || 0,   color: "#0C2D6B", legendFontColor: "#444441", legendFontSize: 14 },
    { name: "Unoccupied", population: stats.unoccupiedCount || 0, color: "#B5D4F4", legendFontColor: "#444441", legendFontSize: 14 },
  ];

  const financePieData = [
    { name: "Unpaid", population: stats.unpaidCount || 0, color: "#E24B4A", legendFontColor: "#444441", legendFontSize: 14 },
    { name: "Paid",   population: stats.paidCount || 0,   color: "#1D9E75", legendFontColor: "#444441", legendFontSize: 14 },
  ];

  const hasMarketData  = stats.occupiedCount + stats.unoccupiedCount > 0;
  const hasFinanceData = stats.paidCount + stats.unpaidCount > 0;

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => setSidebarVisible(true)} activeOpacity={0.7}>
          <Menu size={24} color="#E6F1FB" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>RentWise</Text>
        <NotificationBell />
      </View>

      {/* Market name banner */}
      <View style={styles.banner}>
        <Text style={styles.bannerText}>Ka Domeng Talipapa Wet and Dry Market</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 10 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {loading ? (
          <ActivityIndicator color="#0C2D6B" size="large" style={styles.dataLoader} />
        ) : (
          <>
            {/* Market overview */}
            <Text style={styles.sectionTitle}>Market overview</Text>
            <View style={styles.statRow}>
              <StatCard label="Tenants"    value={stats.tenantCount}    numColor="#0C2D6B" />
              <StatCard label="Occupied"   value={stats.occupiedCount}   numColor="#0C2D6B" />
              <StatCard label="Unoccupied" value={stats.unoccupiedCount} numColor="#B4B2A9" />
            </View>

            <View style={styles.chartCard}>
              {hasMarketData ? (
                <PieChart
                  data={marketPieData}
                  width={CHART_WIDTH}
                  height={160}
                  chartConfig={CHART_CONFIG}
                  accessor="population"
                  backgroundColor="transparent"
                  paddingLeft="8"
                  absolute
                />
              ) : (
                <Text style={styles.noData}>No stall data available</Text>
              )}
            </View>

            {/* Financial overview */}
            <Text style={[styles.sectionTitle, styles.financeSectionTitle]}>Financial overview</Text>
            <View style={styles.statRow}>
              <StatCard label="Paid"   value={stats.paidCount}   numColor="#1D9E75" />
              <StatCard label="Unpaid" value={stats.unpaidCount} numColor="#E24B4A" />
            </View>

            <View style={styles.chartCard}>
              {hasFinanceData ? (
                <PieChart
                  data={financePieData}
                  width={CHART_WIDTH}
                  height={160}
                  chartConfig={CHART_CONFIG}
                  accessor="population"
                  backgroundColor="transparent"
                  paddingLeft="8"
                  absolute
                />
              ) : (
                <Text style={styles.noData}>No payment data available</Text>
              )}
            </View>

            {/* Collected card */}
            <View style={styles.collectedCard}>
              <View style={styles.collectedLeft}>
                <Wallet size={22} color="#0C2D6B" style={{ marginRight: 10 }} />
                <Text style={styles.collectedLabel}>Total payment collected</Text>
              </View>

              <View style={styles.collectedRow}>
                <Text style={styles.collectedRowLabel}>Today</Text>
                <Text style={styles.collectedRowAmount}>{formatCurrency(stats.collectedToday)}</Text>
              </View>

              <View style={styles.collectedDivider} />

              <View style={styles.collectedRow}>
                <Text style={styles.collectedRowLabel}>This month</Text>
                <Text style={[styles.collectedRowAmount, styles.collectedRowAmountEmphasis]}>
                  {formatCurrency(stats.collectedThisMonth)}
                </Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>

      <UpdatesReportFAB disabled={sidebarVisible} />

      <Sidebar visible={sidebarVisible} onClose={() => setSidebarVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F0F4FA" },
  fullCenter: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F0F4FA" },

  header: {
    backgroundColor: "#0C2D6B",
    paddingBottom: 14,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: { fontSize: 18, fontWeight: "500", color: "#FFFFFF" },

  banner: {
    backgroundColor: "#1A4DA0",
    paddingHorizontal: 20,
    paddingVertical: 12,
    alignItems: "center",
  },
  bannerText: { fontSize: 14, fontWeight: "500", color: "#FFFFFF", textAlign: "center" },

  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  dataLoader: { marginTop: 60 },

  sectionTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#0C2D6B",
    marginBottom: 12,
  },
  financeSectionTitle: {
    marginTop: 8,
  },

  statRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
    borderWidth: 0.5,
    borderColor: "#B5D4F4",
  },
  statValue: { fontSize: 24, fontWeight: "500" },
  statLabel: { fontSize: 12, color: "#888780", marginTop: 4 },

  chartCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 18,
    borderWidth: 0.5,
    borderColor: "#B5D4F4",
    alignItems: "center",
    marginBottom: 16,
  },

  collectedCard: {
    backgroundColor: "#E6F1FB",
    borderRadius: 16,
    padding: 18,
    borderWidth: 0.5,
    borderColor: "#B5D4F4",
    marginBottom: 32,
  },
  collectedLeft: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  collectedLabel: { fontSize: 13, color: "#1A4DA0", fontWeight: "500" },
  collectedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  collectedRowLabel: { fontSize: 13, color: "#5F5E5A" },
  collectedRowAmount: { fontSize: 16, fontWeight: "500", color: "#0C2D6B" },
  collectedRowAmountEmphasis: { fontSize: 22 },
  collectedDivider: {
    height: 0.5,
    backgroundColor: "#B5D4F4",
    marginVertical: 8,
  },

  noData: { fontSize: 14, color: "#888780", paddingVertical: 40 },
});
