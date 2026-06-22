import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
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

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import { Colors } from "../shared/constants/color";
import OwnerSidebar from "./components/OwnerSidebar";
import OwnerBellIcon from "./components/OwnerBellIcon";

const SCREEN_WIDTH = Dimensions.get("window").width;
const CHART_WIDTH = SCREEN_WIDTH - 64;

const CHART_CONFIG = {
  backgroundColor: Colors.surface,
  backgroundGradientFrom: Colors.surface,
  backgroundGradientTo: Colors.surface,
  color: (opacity = 1) => `rgba(26, 79, 138, ${opacity})`,
};

type Stats = {
  tenantCount: number;
  occupiedCount: number;
  unoccupiedCount: number;
  paidCount: number;
  unpaidCount: number;
  collectedAmount: number;
};

const ZERO_STATS: Stats = {
  tenantCount: 0,
  occupiedCount: 0,
  unoccupiedCount: 0,
  paidCount: 0,
  unpaidCount: 0,
  collectedAmount: 0,
};

function formatCurrency(amount: number): string {
  const [integer, decimal] = amount.toFixed(2).split(".");
  return `₱${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${decimal}`;
}

function StatCard({ label, value, accent = Colors.primary }: { label: string; value: string | number; accent?: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, { color: accent }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
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

  const fetchData = async () => {
    setLoading(true);
    try {
      const now = new Date();
      const startTS = Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth(), 1));
      const endTS = Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999));

      const [usersSnap, stallsSnap, paymentsSnap] = await Promise.all([
        getDocs(query(collection(db, "users"), where("role", "==", "tenant"))),
        getDocs(collection(db, "stalls")),
        getDocs(query(collection(db, "payments"), where("status", "==", "approved"))),
      ]);

      const activeTenants = usersSnap.docs.filter((d) => d.data().status === "active");
      const occupiedCount = stallsSnap.docs.filter((d) => d.data().status === "occupied").length;
      const unoccupiedCount = stallsSnap.docs.filter((d) => d.data().status === "unoccupied").length;

      const startMs = startTS.toMillis();
      const endMs = endTS.toMillis();
      const monthPayments = paymentsSnap.docs.filter((d) => {
        const date = d.data().date as Timestamp | undefined;
        if (!date?.toMillis) return false;
        return date.toMillis() >= startMs && date.toMillis() <= endMs;
      });

      const paidUids = new Set(monthPayments.map((d) => d.data().userId as string));
      const collectedAmount = monthPayments.reduce(
        (sum, d) => sum + ((d.data().amount ?? d.data().paymentAmount ?? 0) as number),
        0,
      );
      const paidCount = activeTenants.filter((d) => paidUids.has(d.id)).length;

      setStats({
        tenantCount: activeTenants.length,
        occupiedCount,
        unoccupiedCount,
        paidCount,
        unpaidCount: activeTenants.length - paidCount,
        collectedAmount,
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
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  const marketPieData = [
    { name: "Occupied", population: stats.occupiedCount || 0, color: Colors.primary, legendFontColor: Colors.textSecondary, legendFontSize: 12 },
    { name: "Unoccupied", population: stats.unoccupiedCount || 0, color: Colors.textMuted, legendFontColor: Colors.textSecondary, legendFontSize: 12 },
  ];

  const financePieData = [
    { name: "Unpaid", population: stats.unpaidCount || 0, color: Colors.error, legendFontColor: Colors.textSecondary, legendFontSize: 12 },
    { name: "Paid", population: stats.paidCount || 0, color: Colors.success, legendFontColor: Colors.textSecondary, legendFontSize: 12 },
  ];

  const hasMarketData = stats.occupiedCount + stats.unoccupiedCount > 0;
  const hasFinanceData = stats.paidCount + stats.unpaidCount > 0;

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.menuBtn} onPress={() => setSidebarVisible(true)} activeOpacity={0.7}>
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>RentWise</Text>
        <OwnerBellIcon />
      </View>

      <View style={styles.banner}>
        <Text style={styles.bannerText}>Ka Domeng Talipapa Wet and Dry Market</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color={Colors.primary} size="large" style={styles.dataLoader} />
        ) : (
          <>
            <Text style={styles.sectionTitle}>Market Overview</Text>
            <View style={styles.statRow}>
              <StatCard label="Tenants" value={stats.tenantCount} />
              <StatCard label="Occupied" value={stats.occupiedCount} />
              <StatCard label="Unoccupied" value={stats.unoccupiedCount} accent={Colors.textMuted} />
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

            <Text style={styles.sectionTitle}>Financial Overview</Text>
            <View style={styles.statRow}>
              <StatCard label="Paid" value={stats.paidCount} accent={Colors.success} />
              <StatCard label="Unpaid" value={stats.unpaidCount} accent={Colors.error} />
              <StatCard label="Collected" value={formatCurrency(stats.collectedAmount)} accent={Colors.primary} />
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
          </>
        )}
      </ScrollView>

      <OwnerSidebar visible={sidebarVisible} onClose={() => setSidebarVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  fullCenter: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: Colors.background },
  header: {
    backgroundColor: "#1A1A1A",
    paddingBottom: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  menuBtn: { width: 36, alignItems: "center", justifyContent: "center" },
  menuIcon: { fontSize: 24, color: "#FFFFFF" },
  headerTitle: { fontSize: 20, fontWeight: "700", color: "#FFFFFF" },
  banner: { backgroundColor: Colors.primary, paddingVertical: 16, alignItems: "center" },
  bannerText: { fontSize: 14, fontWeight: "600", color: "#FFFFFF", textAlign: "center", paddingHorizontal: 16 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  dataLoader: { marginTop: 60 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: Colors.textPrimary, marginBottom: 12, marginTop: 8 },
  statRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  statValue: { fontSize: 20, fontWeight: "700", marginBottom: 4 },
  statLabel: { fontSize: 11, color: Colors.textMuted, textAlign: "center" },
  chartCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  noData: { fontSize: 14, color: Colors.textMuted, paddingVertical: 40 },
});
