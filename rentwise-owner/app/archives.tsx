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

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import { Colors } from "../shared/constants/color";
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
  if (!ts) return "—";
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
      if (!user) { router.replace("/"); return; }
      setChecking(false);
      fetchData();
    });
    return unsub;
  }, [fetchData]);

  useFocusEffect(useCallback(() => { if (!checking) fetchData(); }, [checking, fetchData]));

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
        <Text style={styles.pageTitle}>Account Archives</Text>
        <Text style={styles.countBadge}>{archives.length} Archived</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.primary} size="large" style={styles.loader} />
      ) : (
        <FlatList
          data={archives}
          keyExtractor={(item) => item.uid}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>No archived accounts found.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarInitial}>
                  {item.firstName ? item.firstName[0].toUpperCase() : "?"}
                </Text>
              </View>
              <View style={styles.cardInfo}>
                <Text style={styles.cardName}>{item.firstName} {item.lastName}</Text>
                <Text style={styles.cardSub}>@{item.userName}</Text>
                <Text style={styles.cardSub}>
                  Building {item.buildingNumber} · Space {item.spaceId}
                </Text>
                <Text style={styles.cardDate}>Archived: {formatDate(item.archivedAt)}</Text>
              </View>
              <View style={styles.archivedTag}>
                <Text style={styles.archivedTagText}>Archived</Text>
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
  countBadge: {
    fontSize: 12,
    color: "#FFFFFF",
    backgroundColor: "rgba(255,255,255,0.25)",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    fontWeight: "600",
  },

  loader: { marginTop: 60 },
  list: { padding: 12, gap: 10, paddingBottom: 32 },
  emptyBox: { alignItems: "center", paddingTop: 80 },
  emptyText: { fontSize: 15, color: Colors.textMuted },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },

  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    flexShrink: 0,
  },
  avatarInitial: { fontSize: 18, fontWeight: "700", color: Colors.primary },

  cardInfo: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: "700", color: Colors.textPrimary, marginBottom: 2 },
  cardSub: { fontSize: 12, color: Colors.textSecondary, marginBottom: 1 },
  cardDate: { fontSize: 11, color: Colors.textMuted, marginTop: 4 },

  archivedTag: {
    backgroundColor: "#FFF3CD",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginLeft: 10,
    flexShrink: 0,
  },
  archivedTagText: { fontSize: 11, fontWeight: "700", color: "#856404" },
});
