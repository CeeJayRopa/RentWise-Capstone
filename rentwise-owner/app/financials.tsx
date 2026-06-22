import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  TextInput,
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import { Colors } from "../shared/constants/color";
import OwnerSidebar from "./components/OwnerSidebar";

type StatusFilter = "All" | "Paid" | "Unpaid";
type DateFilter = "Daily" | "Weekly" | "Monthly";

type PaymentRow = {
  id: string;
  tenantName: string;
  buildingNumber: string;
  spaceId: string;
  amount: number;
  status: "paid" | "unpaid";
  date: Timestamp | null;
};

function getDateRange(filter: DateFilter): { start: Date; end: Date } {
  const now = new Date();
  if (filter === "Daily") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    return { start, end };
  }
  if (filter === "Weekly") {
    const day = now.getDay();
    const start = new Date(now);
    start.setDate(now.getDate() - day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

export default function Financials() {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [dateFilter, setDateFilter] = useState<DateFilter>("Monthly");
  const [search, setSearch] = useState("");
  const [sidebarVisible, setSidebarVisible] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) { router.replace("/"); return; }
      setChecking(false);
      fetchData();
    });
    return unsub;
  }, []);

  useFocusEffect(useCallback(() => { if (!checking) fetchData(); }, [checking, dateFilter]));

  const fetchData = async () => {
    setLoading(true);
    try {
      const { start, end } = getDateRange(dateFilter);
      const [usersSnap, stallsSnap, paymentsSnap] = await Promise.all([
        getDocs(query(collection(db, "users"), where("role", "==", "tenant"))),
        getDocs(collection(db, "stalls")),
        getDocs(query(collection(db, "payments"), where("status", "==", "approved"))),
      ]);

      const tenantMap = new Map<string, { name: string; stallId: string }>();
      usersSnap.docs.forEach((d) => {
        const data = d.data();
        tenantMap.set(d.id, {
          name: `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim(),
          stallId: data.stallId ?? "",
        });
      });

      const stallMap = new Map<string, { buildingNumber: string; spaceId: string }>();
      stallsSnap.docs.forEach((d) => {
        const data = d.data();
        stallMap.set(d.id, {
          buildingNumber: String(data.buildingNumber ?? ""),
          spaceId: data.spaceId ?? "",
        });
      });

      const startMs = start.getTime();
      const endMs = end.getTime();

      const paidUids = new Set<string>();
      const result: PaymentRow[] = [];

      paymentsSnap.docs.forEach((d) => {
        const data = d.data();
        const date = data.date as Timestamp | null;
        const dateMs = date?.toMillis ? date.toMillis() : 0;
        if (dateMs < startMs || dateMs > endMs) return;

        const uid = data.userId as string;
        paidUids.add(uid);
        const tenant = tenantMap.get(uid);
        const stall = stallMap.get(data.stallId ?? tenant?.stallId ?? "");

        result.push({
          id: d.id,
          tenantName: tenant?.name ?? "Unknown",
          buildingNumber: stall?.buildingNumber ?? "—",
          spaceId: stall?.spaceId ?? "—",
          amount: (data.amount ?? data.paymentAmount ?? 0) as number,
          status: "paid",
          date,
        });
      });

      usersSnap.docs.forEach((d) => {
        if (d.data().status !== "active") return;
        if (paidUids.has(d.id)) return;
        const tenant = tenantMap.get(d.id)!;
        const stall = stallMap.get(d.data().stallId ?? "");
        result.push({
          id: `unpaid-${d.id}`,
          tenantName: tenant.name,
          buildingNumber: stall?.buildingNumber ?? "—",
          spaceId: stall?.spaceId ?? "—",
          amount: 0,
          status: "unpaid",
          date: null,
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

  const filtered = rows.filter((r) => {
    if (statusFilter === "Paid" && r.status !== "paid") return false;
    if (statusFilter === "Unpaid" && r.status !== "unpaid") return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!r.tenantName.toLowerCase().includes(q) && !r.buildingNumber.includes(q)) return false;
    }
    return true;
  });

  if (checking) {
    return <View style={styles.fullCenter}><ActivityIndicator color={Colors.primary} size="large" /></View>;
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.menuBtn} onPress={() => setSidebarVisible(true)} activeOpacity={0.7}>
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>RentWise</Text>
        <View style={styles.menuBtn} />
      </View>

      <View style={styles.subHeader}>
        <Text style={styles.pageTitle}>Financials</Text>
        <Text style={styles.viewOnly}>View Only</Text>
      </View>

      <View style={styles.filters}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search tenant or building..."
          placeholderTextColor={Colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />

        <View style={styles.filterRow}>
          {(["All", "Paid", "Unpaid"] as StatusFilter[]).map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.chip, statusFilter === s && styles.chipActive]}
              onPress={() => setStatusFilter(s)}
            >
              <Text style={[styles.chipText, statusFilter === s && styles.chipTextActive]}>{s}</Text>
            </TouchableOpacity>
          ))}
          <View style={styles.chipSpacer} />
          {(["Daily", "Weekly", "Monthly"] as DateFilter[]).map((d) => (
            <TouchableOpacity
              key={d}
              style={[styles.chip, dateFilter === d && styles.chipActive]}
              onPress={() => setDateFilter(d)}
            >
              <Text style={[styles.chipText, dateFilter === d && styles.chipTextActive]}>{d}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.primary} size="large" style={styles.loader} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No records found.</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Text style={styles.tenantName}>{item.tenantName}</Text>
                <Text style={styles.rowSub}>Building {item.buildingNumber} · {item.spaceId}</Text>
              </View>
              <View style={[styles.badge, item.status === "paid" ? styles.badgePaid : styles.badgeUnpaid]}>
                <Text style={[styles.badgeText, item.status === "paid" ? styles.badgePaidText : styles.badgeUnpaidText]}>
                  {item.status === "paid" ? "Paid" : "Unpaid"}
                </Text>
              </View>
            </View>
          )}
        />
      )}

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
  subHeader: {
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pageTitle: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
  viewOnly: { fontSize: 11, color: "rgba(255,255,255,0.7)", fontStyle: "italic" },
  filters: { backgroundColor: Colors.surface, padding: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  searchInput: {
    backgroundColor: Colors.inputBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: Colors.textPrimary,
    marginBottom: 10,
  },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.inputBackground,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 12, color: Colors.textSecondary },
  chipTextActive: { color: "#FFFFFF", fontWeight: "600" },
  chipSpacer: { flex: 1 },
  loader: { marginTop: 60 },
  list: { padding: 12, gap: 8, paddingBottom: 32 },
  empty: { textAlign: "center", color: Colors.textMuted, marginTop: 60, fontSize: 14 },
  row: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  rowLeft: { flex: 1 },
  tenantName: { fontSize: 14, fontWeight: "600", color: Colors.textPrimary },
  rowSub: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgePaid: { backgroundColor: "#E8F5E9" },
  badgeUnpaid: { backgroundColor: "#FFEBEE" },
  badgeText: { fontSize: 12, fontWeight: "600" },
  badgePaidText: { color: Colors.success },
  badgeUnpaidText: { color: Colors.error },
});
