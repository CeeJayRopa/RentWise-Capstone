import { useEffect, useState, useCallback } from "react";
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
import { getPaidTenantUserIds } from "../shared/services/financeServices";
import Sidebar from "./components/Sidebar";

const SCREEN_WIDTH = Dimensions.get("window").width;
// Accounts for 16px scroll padding + 16px card padding on each side
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
  const formatted = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `₱${formatted}.${decimal}`;
}

function StatCard({
  label,
  value,
  accent = Colors.primary,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
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

  useFocusEffect(
    useCallback(() => {
      if (!checking) {
        fetchData();
      }
    }, [checking])
  );
  const fetchData = async () => {
    setLoading(true);
    try {
      const now = new Date();
      const startTS = Timestamp.fromDate(
        new Date(now.getFullYear(), now.getMonth(), 1),
      );
      const endTS = Timestamp.fromDate(
        new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
      );

      const [usersSnap, stallsSnap, paymentsSnap] = await Promise.all([
        getDocs(query(collection(db, "users"), where("role", "==", "tenant"))),
        getDocs(collection(db, "stalls")),
        getDocs(
          query(collection(db, "payments"), where("status", "==", "approved")),
        ),
      ]);

      // Active tenants only (role already filtered by query)
      const activeTenants = usersSnap.docs.filter(
        (d) => d.data().status === "active",
      );

      // Stall counts — maintenance stalls are excluded from both buckets
      const occupiedCount = stallsSnap.docs.filter(
        (d) => d.data().status === "occupied",
      ).length;
      const unoccupiedCount = stallsSnap.docs.filter(
        (d) => d.data().status === "unoccupied",
      ).length;

      // Approved payments within the current calendar month (filtered in memory)
      const startMs = startTS.toMillis();
      const endMs = endTS.toMillis();
      const monthPayments = paymentsSnap.docs.filter((d) => {
        const date = d.data().date as Timestamp | undefined;
        if (!date?.toMillis) return false;
        const ms = date.toMillis();
        return ms >= startMs && ms <= endMs;
      });

      const paidUids = getPaidTenantUserIds(monthPayments);
      const collectedAmount = monthPayments.reduce(
        (sum, d) =>
          sum + ((d.data().amount ?? d.data().paymentAmount ?? 0) as number),
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
      console.error("DASHBOARD FETCH ERROR:", err);
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
    {
      name: "Occupied",
      population: stats.occupiedCount,
      color: Colors.primary,
      legendFontColor: Colors.textSecondary,
      legendFontSize: 12,
    },
    {
      name: "Unoccupied",
      population: stats.unoccupiedCount,
      color: Colors.textMuted,
      legendFontColor: Colors.textSecondary,
      legendFontSize: 12,
    },
  ];

  const financePieData = [
    {
      name: "Unpaid",
      population: stats.unpaidCount,
      color: Colors.error,
      legendFontColor: Colors.textSecondary,
      legendFontSize: 12,
    },
    {
      name: "Paid",
      population: stats.paidCount,
      color: Colors.primary,
      legendFontColor: Colors.textSecondary,
      legendFontSize: 12,
    },
  ];

  const hasMarketData = stats.occupiedCount + stats.unoccupiedCount > 0;
  const hasFinanceData = stats.paidCount + stats.unpaidCount > 0;

  return (
    <View style={styles.screen}>
      {/* Header bar */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.menuBtn}
          activeOpacity={0.7}
          onPress={() => setSidebarVisible(true)}
        >
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>RentWise</Text>
        {/* Spacer keeps title visually centered */}
        <View style={styles.menuBtn} />
      </View>

      {/* Banner */}
      <View style={styles.banner}>
        <Text style={styles.bannerText}>
          Ka Domeng Talipapa Wet and Dry Market
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <ActivityIndicator
            color={Colors.primary}
            size="large"
            style={styles.dataLoader}
          />
        ) : (
          <>
            {/* ── Market Overview ─────────────────────────────── */}
            <Text style={styles.sectionTitle}>Market Overview</Text>

            <View style={styles.statRow}>
              <StatCard label="Tenants" value={stats.tenantCount} />
              <StatCard label="Occupied Space" value={stats.occupiedCount} />
              <StatCard
                label="Unoccupied Space"
                value={stats.unoccupiedCount}
              />
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

            {/* ── Finances Overview ────────────────────────────── */}
            <Text style={[styles.sectionTitle, styles.sectionGap]}>
              Finances Overview
            </Text>

            <View style={styles.statRow}>
              <StatCard
                label="Unpaid Tenants"
                value={stats.unpaidCount}
                accent={Colors.error}
              />
              <StatCard label="Paid Tenants" value={stats.paidCount} />
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
                <Text style={styles.noData}>
                  No payments recorded this month
                </Text>
              )}
            </View>

            <View style={styles.collectionCard}>
              <Text style={styles.collectionLabel}>
                Collected Payment This Month
              </Text>
              <Text style={styles.collectionAmount}>
                {formatCurrency(stats.collectedAmount)}
              </Text>
            </View>
          </>
        )}
      </ScrollView>

      <Sidebar
        visible={sidebarVisible}
        onClose={() => setSidebarVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  fullCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.background,
  },
  header: {
    backgroundColor: Colors.primary,
    paddingBottom: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  menuBtn: {
    width: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  menuIcon: {
    fontSize: 22,
    color: "#FFFFFF",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  banner: {
    backgroundColor: Colors.primaryDark,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  bannerText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#FFFFFF",
    textAlign: "center",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  dataLoader: {
    paddingVertical: 48,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  sectionGap: {
    marginTop: 24,
  },
  statRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  statValue: {
    fontSize: 26,
    fontWeight: "700",
  },
  statLabel: {
    fontSize: 10,
    color: Colors.textSecondary,
    textAlign: "center",
    marginTop: 4,
  },
  chartCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingVertical: 8,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    overflow: "hidden",
    marginBottom: 4,
  },
  noData: {
    fontSize: 13,
    color: Colors.textMuted,
    paddingVertical: 32,
  },
  collectionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 20,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    marginTop: 12,
  },
  collectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textSecondary,
    marginBottom: 8,
  },
  collectionAmount: {
    fontSize: 28,
    fontWeight: "700",
    color: Colors.primary,
  },
});
