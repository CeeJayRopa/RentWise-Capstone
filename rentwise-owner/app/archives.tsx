import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Timestamp } from "firebase/firestore";

import { Ionicons } from "@expo/vector-icons";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";

import OwnerSidebar from "./components/OwnerSidebar";

type ArchiveEntry = {
  uid: string;
  firstName: string;
  lastName: string;
  userName: string;
  contactNo: string;
  buildingNumber: string;
  spaceId: string;
  stallId: string;
  archivedAt: Timestamp | null;
};

function formatDate(ts: Timestamp | null): string {
  if (!ts) return '—';
  const d = ts.toDate();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export default function Archives() {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [archives, setArchives] = useState<ArchiveEntry[]>([]);
  const [sidebarVisible, setSidebarVisible] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, "archives"));
      const entries: ArchiveEntry[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          uid: d.id,
          firstName: (data.firstName as string) ?? "",
          lastName: (data.lastName as string) ?? "",
          userName: (data.userName as string) ?? "",
          contactNo: (data.contactNo as string) ?? "",
          buildingNumber: (data.buildingNumber as string) ?? "",
          spaceId: (data.spaceId as string) ?? "",
          stallId: (data.stallId as string) ?? "",
          archivedAt: (data.archivedAt as Timestamp) ?? null,
        };
      });
      entries.sort((a, b) => {
        if (!a.archivedAt) return 1;
        if (!b.archivedAt) return -1;
        return b.archivedAt.seconds - a.archivedAt.seconds;
      });
      setArchives(entries);
    } catch (err) {
      console.error("OWNER ARCHIVES ERROR:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) { router.replace("/login"); return; }
      setChecking(false);
      fetchData();
    });
    return unsub;
  }, [fetchData]);

  useFocusEffect(useCallback(() => { if (!checking) fetchData(); }, [checking, fetchData]));

  if (checking) {
    return <View style={styles.fullCenter}><ActivityIndicator color="#0C2D6B" size="large" /></View>;
  }

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => setSidebarVisible(true)} activeOpacity={0.7}>
          <Ionicons name="menu" size={24} color="#E6F1FB" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>RentWise</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Sub-header */}
      <View style={styles.subHeader}>
        <Text style={styles.pageTitle}>Account archives</Text>
        <View style={styles.countPill}>
          <Text style={styles.countPillText}>{archives.length} Archived</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color="#0C2D6B" size="large" style={styles.loader} />
      ) : archives.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="archive-outline" size={40} color="#B5D4F4" style={{ marginBottom: 10 }} />
          <Text style={styles.emptyText}>No archived accounts.</Text>
        </View>
      ) : (
        <FlatList
          data={archives}
          keyExtractor={(item) => item.uid}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarInitial}>
                  {item.firstName ? item.firstName[0].toUpperCase() : "?"}
                </Text>
              </View>
              <View style={styles.cardInfo}>
                <Text style={styles.cardName}>{item.firstName} {item.lastName}</Text>
                <Text style={styles.cardUsername}>@{item.userName}</Text>
                <Text style={styles.cardStall}>
                  Building {item.buildingNumber} {"·"} Space {item.spaceId}
                </Text>
                <Text style={styles.cardDate}>Archived: {formatDate(item.archivedAt)}</Text>
              </View>
              <View style={styles.archivedBadge}>
                <Text style={styles.archivedBadgeText}>Archived</Text>
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
    fontSize: 18,
    fontWeight: "500",
    color: "#FFFFFF",
    textAlign: "center",
  },

  subHeader: {
    backgroundColor: "#1A4DA0",
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pageTitle: { fontSize: 16, fontWeight: "500", color: "#FFFFFF" },
  countPill: {
    backgroundColor: "#0C2D6B",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  countPillText: { fontSize: 12, fontWeight: "500", color: "#B5D4F4" },

  loader: { marginTop: 60 },

  list: { paddingHorizontal: 16, paddingTop: 16, gap: 10 },

  emptyBox: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  emptyText: { fontSize: 15, color: "#888780", textAlign: "center" },

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderWidth: 0.5,
    borderColor: "#B5D4F4",
  },

  avatarCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#E6F1FB",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: { fontSize: 18, fontWeight: "500", color: "#0C2D6B" },

  cardInfo: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: "500", color: "#0C2D6B" },
  cardUsername: { fontSize: 13, color: "#2E6FD9", marginTop: 1 },
  cardStall: { fontSize: 13, color: "#888780", marginTop: 2 },
  cardDate: { fontSize: 12, color: "#B4B2A9", marginTop: 4 },

  archivedBadge: {
    backgroundColor: "#FAEEDA",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    alignSelf: "flex-start",
  },
  archivedBadgeText: { fontSize: 12, fontWeight: "500", color: "#BA7517" },
});

