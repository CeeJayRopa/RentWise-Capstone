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
import { collection, getDocs } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import { Colors } from "../shared/constants/color";
import OwnerSidebar from "./components/OwnerSidebar";

type StallRow = {
  id: string;
  buildingNumber: string;
  spaceId: string;
  status: "occupied" | "unoccupied" | "maintenance";
  tenantName: string;
};

type StatusFilter = "All" | "Occupied" | "Unoccupied";

export default function Building() {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [stalls, setStalls] = useState<StallRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [buildingFilter, setBuildingFilter] = useState("");
  const [sidebarVisible, setSidebarVisible] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) { router.replace("/"); return; }
      setChecking(false);
      fetchData();
    });
    return unsub;
  }, []);

  useFocusEffect(useCallback(() => { if (!checking) fetchData(); }, [checking]));

  const fetchData = async () => {
    setLoading(true);
    try {
      const [stallsSnap, usersSnap] = await Promise.all([
        getDocs(collection(db, "stalls")),
        getDocs(collection(db, "users")),
      ]);

      const tenantMap = new Map<string, string>();
      usersSnap.docs.forEach((d) => {
        const data = d.data();
        if (data.role === "tenant") {
          tenantMap.set(d.id, `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim());
        }
      });

      const rows: StallRow[] = stallsSnap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          buildingNumber: String(data.buildingNumber ?? ""),
          spaceId: data.spaceId ?? "",
          status: data.status ?? "unoccupied",
          tenantName: data.tenantId ? (tenantMap.get(data.tenantId) ?? "Unknown") : "—",
        };
      });

      rows.sort((a, b) => {
        const bn = Number(a.buildingNumber) - Number(b.buildingNumber);
        if (bn !== 0) return bn;
        return Number(a.spaceId.split("-")[1] ?? 0) - Number(b.spaceId.split("-")[1] ?? 0);
      });

      setStalls(rows);
    } catch (err) {
      console.error("OWNER BUILDING ERROR:", err);
    } finally {
      setLoading(false);
    }
  };

  const filtered = stalls.filter((s) => {
    if (statusFilter === "Occupied" && s.status !== "occupied") return false;
    if (statusFilter === "Unoccupied" && s.status !== "unoccupied") return false;
    if (buildingFilter.trim() && s.buildingNumber !== buildingFilter.trim()) return false;
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
        <Text style={styles.pageTitle}>Building Management</Text>
        <Text style={styles.viewOnly}>View Only</Text>
      </View>

      <View style={styles.filters}>
        <TextInput
          style={styles.searchInput}
          placeholder="Filter by building number..."
          placeholderTextColor={Colors.textMuted}
          value={buildingFilter}
          onChangeText={setBuildingFilter}
          keyboardType="numeric"
        />
        <View style={styles.filterRow}>
          {(["All", "Occupied", "Unoccupied"] as StatusFilter[]).map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.chip, statusFilter === s && styles.chipActive]}
              onPress={() => setStatusFilter(s)}
            >
              <Text style={[styles.chipText, statusFilter === s && styles.chipTextActive]}>{s}</Text>
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
          ListEmptyComponent={<Text style={styles.empty}>No stalls found.</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Text style={styles.spaceId}>{item.spaceId}</Text>
                <Text style={styles.rowSub}>Building {item.buildingNumber}</Text>
                {item.status === "occupied" && (
                  <Text style={styles.tenantName}>{item.tenantName}</Text>
                )}
              </View>
              <View style={[styles.badge, item.status === "occupied" ? styles.badgeOccupied : item.status === "maintenance" ? styles.badgeMaint : styles.badgeUnoccupied]}>
                <Text style={[styles.badgeText, item.status === "occupied" ? styles.badgeOccupiedText : item.status === "maintenance" ? styles.badgeMaintText : styles.badgeUnoccupiedText]}>
                  {item.status === "occupied" ? "Occupied" : item.status === "maintenance" ? "Maintenance" : "Unoccupied"}
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
  filterRow: { flexDirection: "row", gap: 6 },
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
  spaceId: { fontSize: 15, fontWeight: "700", color: Colors.textPrimary },
  rowSub: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  tenantName: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeOccupied: { backgroundColor: "#E3F2FD" },
  badgeUnoccupied: { backgroundColor: "#F3E5F5" },
  badgeMaint: { backgroundColor: "#FFF3E0" },
  badgeText: { fontSize: 12, fontWeight: "600" },
  badgeOccupiedText: { color: Colors.primary },
  badgeUnoccupiedText: { color: "#7B1FA2" },
  badgeMaintText: { color: Colors.warning },
});
