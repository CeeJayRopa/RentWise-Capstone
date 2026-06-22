import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import { Colors } from "../shared/constants/color";
import OwnerSidebar from "./components/OwnerSidebar";

type ReportDoc = {
  id: string;
  category: "building" | "finance" | "archive";
  status: string;
  spaceNo?: string;
  tenantName?: string;
  change?: string;
  approvalStatus?: string;
  createdAt?: any;
};

function categoryLabel(cat: string): string {
  if (cat === "building") return "Building Management Update Approved";
  if (cat === "finance") return "Financial Change Approved";
  return "Account Archive Update Approved";
}

function reportDesc(r: ReportDoc): string {
  if (r.spaceNo) return `Space ${r.spaceNo} — ${r.change ?? r.status}`;
  if (r.tenantName) return `${r.tenantName} — ${r.change ?? r.status}`;
  return r.change ?? r.status ?? "—";
}

function formatDate(ts: any): string {
  if (!ts) return "—";
  const d: Date = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });
}

function groupByDate(reports: ReportDoc[]): { date: string; items: ReportDoc[] }[] {
  const map = new Map<string, ReportDoc[]>();
  for (const r of reports) {
    const key = formatDate(r.createdAt);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return Array.from(map.entries()).map(([date, items]) => ({ date, items }));
}

function buildHtml(groups: { date: string; items: ReportDoc[] }[]): string {
  const rows = groups
    .map(
      (g) => `
      <div class="group">
        <h3>${g.date}</h3>
        ${g.items.map((r) => `<div class="item"><strong>${categoryLabel(r.category)}</strong><p>${reportDesc(r)}</p></div>`).join("")}
      </div>`,
    )
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
    <style>
      body { font-family: Arial, sans-serif; padding: 24px; color: #1A202C; }
      h1 { color: #1A4F8A; margin-bottom: 4px; }
      h2 { color: #5A6A7A; font-size: 13px; margin-top: 0; }
      h3 { color: #1A4F8A; border-bottom: 1px solid #D0E2F0; padding-bottom: 6px; margin-top: 24px; }
      .item { background: #F5F9FD; border-radius: 6px; padding: 10px 14px; margin-bottom: 8px; }
      .item strong { font-size: 14px; }
      .item p { font-size: 12px; color: #5A6A7A; margin: 4px 0 0; }
    </style>
  </head><body>
    <h1>RentWise Daily Reports</h1>
    <h2>Ka Domeng Talipapa Wet and Dry Market</h2>
    ${rows || "<p>No reports found.</p>"}
  </body></html>`;
}

export default function DailyReports() {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<ReportDoc[]>([]);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [downloading, setDownloading] = useState(false);

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
      const snap = await getDocs(
        query(collection(db, "updates"), where("approvalStatus", "==", "approved")),
      );
      const docs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as ReportDoc))
        .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      setReports(docs);
    } catch (err) {
      console.error("DAILY REPORTS ERROR:", err);
    } finally {
      setLoading(false);
    }
  };

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const groups = groupByDate(reports);
      const html = buildHtml(groups);
      const { uri } = await Print.printToFileAsync({ html });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "RentWise Daily Reports" });
      } else {
        Alert.alert("Saved", `PDF saved to: ${uri}`);
      }
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "Failed to generate PDF.");
    } finally {
      setDownloading(false);
    }
  };

  if (checking) {
    return <View style={styles.fullCenter}><ActivityIndicator color={Colors.primary} size="large" /></View>;
  }

  const groups = groupByDate(reports);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.menuBtn} onPress={() => setSidebarVisible(true)} activeOpacity={0.7}>
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>RentWise</Text>
        <TouchableOpacity style={styles.pdfBtn} onPress={downloadPdf} disabled={downloading || loading || reports.length === 0} activeOpacity={0.7}>
          {downloading ? <ActivityIndicator color={Colors.primary} size="small" /> : <Text style={styles.pdfBtnText}>PDF</Text>}
        </TouchableOpacity>
      </View>

      <View style={styles.subHeader}>
        <Text style={styles.pageTitle}>Daily Reports</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.primary} size="large" style={styles.loader} />
      ) : reports.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>No reports yet.</Text>
          <Text style={styles.emptyHint}>Approved updates will appear here.</Text>
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(item) => item.date}
          contentContainerStyle={styles.list}
          renderItem={({ item: group }) => (
            <View style={styles.group}>
              <Text style={styles.groupDate}>{group.date}</Text>
              {group.items.map((r) => (
                <View key={r.id} style={styles.reportCard}>
                  <Text style={styles.reportTitle}>{categoryLabel(r.category)}</Text>
                  <Text style={styles.reportDesc}>{reportDesc(r)}</Text>
                </View>
              ))}
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
  pdfBtn: {
    width: 44,
    height: 30,
    backgroundColor: Colors.background,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  pdfBtnText: { fontSize: 12, fontWeight: "700", color: Colors.primary },
  subHeader: { backgroundColor: Colors.primary, paddingVertical: 12, paddingHorizontal: 16 },
  pageTitle: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
  loader: { marginTop: 60 },
  emptyBox: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { fontSize: 16, color: Colors.textMuted, fontWeight: "600" },
  emptyHint: { fontSize: 13, color: Colors.textMuted, marginTop: 6 },
  list: { padding: 12, paddingBottom: 32 },
  group: { marginBottom: 20 },
  groupDate: { fontSize: 15, fontWeight: "700", color: Colors.primary, marginBottom: 8, paddingLeft: 2 },
  reportCard: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  reportTitle: { fontSize: 14, fontWeight: "700", color: Colors.textPrimary },
  reportDesc: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
});
