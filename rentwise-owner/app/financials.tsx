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
import { Ionicons } from "@expo/vector-icons";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import OwnerSidebar from "./components/OwnerSidebar";

type StatusFilter = "All" | "Paid" | "Unpaid";
type DateFilter = "All" | "Daily" | "Weekly" | "Semi-Monthly" | "Monthly";

type PaymentRow = {
  id: string;
  tenantName: string;
  buildingNumber: string;
  spaceId: string;
  amount: number;
  status: "paid" | "unpaid";
  date: Timestamp | null;
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

export default function Financials() {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [dateFilter, setDateFilter] = useState<DateFilter>("Monthly");
  const [search, setSearch] = useState("");
  const [showPeriodDropdown, setShowPeriodDropdown] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) { router.replace("/login"); return; }
      setChecking(false);
      fetchData();
    });
    return unsub;
  }, []);

  useFocusEffect(useCallback(() => { if (!checking) fetchData(); }, [checking, dateFilter]));

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
        result.push({
          id: d.id,
          tenantName: tenant.name,
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
        if (scheduleKey && stall?.paymentSchedule !== scheduleKey) return;
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

  if (checking) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator color="#0C2D6B" size="large" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => setSidebarVisible(true)} activeOpacity={0.7}>
          <Ionicons name="menu" size={24} color="#E6F1FB" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>RentWise</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* Sub-header */}
      <View style={styles.subHeader}>
        <Text style={styles.subHeaderTitle}>Financials</Text>
        <Text style={styles.viewOnly}>View only</Text>
      </View>

      {/* Body */}
      <View style={styles.body}>
        {/* Search bar */}
        <View style={styles.searchBar}>
          <Ionicons name="search" size={17} color="#2E6FD9" style={{ marginRight: 10 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search tenant or stall..."
            placeholderTextColor="#B4B2A9"
            value={search}
            onChangeText={setSearch}
          />
        </View>

        {/* Filter row */}
        <View style={styles.filterRow}>
          {/* Period dropdown */}
          <View style={[styles.dropdownWrapper, showPeriodDropdown && { zIndex: 100, elevation: 10 }]}>
            <TouchableOpacity
              style={styles.dropdownTrigger}
              onPress={() => { setShowPeriodDropdown((v) => !v); setShowStatusDropdown(false); }}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.dropdownLabel}>Period</Text>
                <Text style={styles.dropdownValue}>{dateFilter}</Text>
              </View>
              <Ionicons name="chevron-down" size={14} color="#2E6FD9" />
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

          {/* Status dropdown */}
          <View style={[styles.dropdownWrapper, showStatusDropdown && { zIndex: 100, elevation: 10 }]}>
            <TouchableOpacity
              style={styles.dropdownTrigger}
              onPress={() => { setShowStatusDropdown((v) => !v); setShowPeriodDropdown(false); }}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.dropdownLabel}>Payment status</Text>
                <Text style={styles.dropdownValue}>{statusFilter}</Text>
              </View>
              <Ionicons name="chevron-down" size={14} color="#2E6FD9" />
            </TouchableOpacity>
            {showStatusDropdown && (
              <View style={styles.dropdownMenu}>
                {(["All", "Paid", "Unpaid"] as StatusFilter[]).map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={[styles.dropdownItem, statusFilter === s && styles.dropdownItemActive]}
                    onPress={() => { setStatusFilter(s); setShowStatusDropdown(false); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.dropdownItemText, statusFilter === s && styles.dropdownItemTextActive]}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </View>

        {/* List */}
        {loading ? (
          <ActivityIndicator color="#0C2D6B" size="large" style={styles.loader} />
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 32 }]}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <Text style={styles.empty}>
                {statusFilter === "Paid"
                  ? "No payments recorded yet."
                  : statusFilter === "Unpaid"
                  ? "All tenants are paid."
                  : "No tenant set in this payment schedule."}
              </Text>
            }
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={styles.cardLeft}>
                  <Text style={styles.tenantName}>{item.tenantName}</Text>
                  <Text style={styles.stallInfo}>
                    Building {item.buildingNumber} {"·"} {item.spaceId}
                  </Text>
                </View>
                <View style={[
                  styles.badge,
                  item.status === "paid" ? styles.badgePaid : styles.badgeUnpaid,
                ]}>
                  <Text style={[
                    styles.badgeText,
                    item.status === "paid" ? styles.badgePaidText : styles.badgeUnpaidText,
                  ]}>
                    {item.status === "paid" ? "Paid" : "Unpaid"}
                  </Text>
                </View>
              </View>
            )}
          />
        )}
      </View>

      <OwnerSidebar visible={sidebarVisible} onClose={() => setSidebarVisible(false)} />
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
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "500",
    color: "#FFFFFF",
  },

  subHeader: {
    backgroundColor: "#1A4DA0",
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  subHeaderTitle: { fontSize: 16, fontWeight: "500", color: "#FFFFFF" },
  viewOnly: { fontSize: 13, color: "#B5D4F4", fontStyle: "italic" },

  body: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },

  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#B5D4F4",
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: "#0C2D6B",
    padding: 0,
  },

  filterRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
    zIndex: 10,
  },
  dropdownWrapper: {
    flex: 1,
    zIndex: 1,
  },
  dropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#B5D4F4",
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  dropdownLabel: {
    fontSize: 11,
    fontWeight: "500",
    color: "#B5D4F4",
    marginBottom: 2,
  },
  dropdownValue: {
    fontSize: 14,
    fontWeight: "500",
    color: "#0C2D6B",
  },
  dropdownMenu: {
    position: "absolute",
    top: 62,
    left: 0,
    right: 0,
    zIndex: 200,
    elevation: 10,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#B5D4F4",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    overflow: "hidden",
  },
  dropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: "#EEF2FA",
  },
  dropdownItemActive: {
    backgroundColor: "#E6F1FB",
  },
  dropdownItemText: {
    fontSize: 14,
    color: "#444441",
  },
  dropdownItemTextActive: {
    color: "#0C2D6B",
    fontWeight: "600",
  },

  loader: { marginTop: 60 },
  list: { gap: 10, paddingBottom: 32 },
  empty: { textAlign: "center", color: "#888780", marginTop: 60, fontSize: 14 },

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderWidth: 0.5,
    borderColor: "#B5D4F4",
    flexDirection: "row",
    alignItems: "center",
  },
  cardLeft: { flex: 1 },
  tenantName: { fontSize: 15, fontWeight: "500", color: "#0C2D6B" },
  stallInfo: { fontSize: 13, color: "#888780", marginTop: 2 },

  badge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
  },
  badgePaid: { backgroundColor: "#E1F5EE" },
  badgeUnpaid: { backgroundColor: "#FCEBEB" },
  badgeText: { fontSize: 12, fontWeight: "500" },
  badgePaidText: { color: "#0F6E56" },
  badgeUnpaidText: { color: "#A32D2D" },
});
