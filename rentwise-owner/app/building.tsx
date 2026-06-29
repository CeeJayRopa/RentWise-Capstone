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
import { Ionicons } from "@expo/vector-icons";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
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
      if (!user) { router.replace("/login"); return; }
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
          <Ionicons name="menu-outline" size={24} color="#E6F1FB" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>RentWise</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Sub-header */}
      <View style={styles.subHeader}>
        <Text style={styles.subHeaderTitle}>Building management</Text>
        <Text style={styles.viewOnly}>View only</Text>
      </View>

      {/* Body */}
      <View style={styles.body}>
        {/* Search bar */}
        <View style={styles.searchBar}>
          <Ionicons name="search" size={17} color="#2E6FD9" style={{ marginRight: 10 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Filter by building number..."
            placeholderTextColor="#B4B2A9"
            value={buildingFilter}
            onChangeText={setBuildingFilter}
            keyboardType="numeric"
          />
        </View>

        {/* Filter tabs */}
        <View style={styles.tabRow}>
          {(["All", "Occupied", "Unoccupied"] as StatusFilter[]).map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.tab, statusFilter === s && styles.tabActive]}
              onPress={() => setStatusFilter(s)}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, statusFilter === s && styles.tabTextActive]}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* List */}
        {loading ? (
          <ActivityIndicator color="#0C2D6B" size="large" style={styles.loader} />
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons name="business-outline" size={40} color="#B5D4F4" style={{ marginBottom: 10 }} />
                <Text style={styles.emptyText}>No stalls found.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={styles.cardLeft}>
                  <Text style={styles.spaceId}>{item.spaceId}</Text>
                  <Text style={styles.buildingName}>Building {item.buildingNumber}</Text>
                  {item.status === "occupied" && (
                    <Text style={styles.tenantName}>{item.tenantName}</Text>
                  )}
                </View>
                <View style={[
                  styles.badge,
                  item.status === "occupied" ? styles.badgeOccupied : styles.badgeUnoccupied,
                ]}>
                  <Text style={[
                    styles.badgeText,
                    item.status === "occupied" ? styles.badgeOccupiedText : styles.badgeUnoccupiedText,
                  ]}>
                    {item.status === "occupied" ? "Occupied" : item.status === "maintenance" ? "Maintenance" : "Unoccupied"}
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

  tabRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  tab: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#B5D4F4",
    backgroundColor: "#FFFFFF",
  },
  tabActive: {
    backgroundColor: "#0C2D6B",
    borderWidth: 0,
  },
  tabText: { fontSize: 13, fontWeight: "500", color: "#888780" },
  tabTextActive: { fontSize: 13, fontWeight: "500", color: "#FFFFFF" },

  loader: { marginTop: 60 },
  list: { gap: 10, paddingBottom: 32 },

  emptyState: { alignItems: "center", justifyContent: "center", paddingTop: 60 },
  emptyText: { fontSize: 15, color: "#888780", textAlign: "center" },

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 16,
    borderWidth: 0.5,
    borderColor: "#B5D4F4",
    flexDirection: "row",
    alignItems: "center",
  },
  cardLeft: { flex: 1 },
  spaceId: { fontSize: 16, fontWeight: "500", color: "#0C2D6B" },
  buildingName: { fontSize: 13, color: "#888780", marginTop: 2 },
  tenantName: { fontSize: 14, color: "#444441", marginTop: 4 },

  badge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
  },
  badgeOccupied: { backgroundColor: "#E6F1FB" },
  badgeUnoccupied: { backgroundColor: "#F1EFE8" },
  badgeText: { fontSize: 12, fontWeight: "500" },
  badgeOccupiedText: { color: "#0C2D6B" },
  badgeUnoccupiedText: { color: "#5F5E5A" },
});
