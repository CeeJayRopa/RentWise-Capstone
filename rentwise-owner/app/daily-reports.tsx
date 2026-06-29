import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Animated,
  Easing,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Print from "expo-print";
import RNBlobUtil from "react-native-blob-util";
import DateTimePicker from "@react-native-community/datetimepicker";

import { Ionicons } from "@expo/vector-icons";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
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
  const detail = r.change ?? r.status ?? null;
  const detailStr = detail && detail !== 'undefined' ? detail : '—';
  if (r.spaceNo) return `Space ${r.spaceNo} — ${detailStr}`;
  if (r.tenantName) return `${r.tenantName} — ${detailStr}`;
  return detailStr;
}

function formatDate(ts: any): string {
  if (!ts) return '—';
  const d: Date = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });
}

function isSameDay(r: ReportDoc, target: Date): boolean {
  if (!r.createdAt) return false;
  const d: Date = r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt);
  return (
    d.getFullYear() === target.getFullYear() &&
    d.getMonth() === target.getMonth() &&
    d.getDate() === target.getDate()
  );
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
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const downloadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const [toastVisible, setToastVisible] = useState(false);

  // Reset downloading state on mount — prevents stuck button on app restart/revisit
  useEffect(() => { setDownloading(false); }, []);

  const showToast = () => {
    setToastVisible(true);
    toastAnim.setValue(0);
    Animated.sequence([
      Animated.timing(toastAnim, { toValue: 1, duration: 300, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.delay(1800),
      Animated.timing(toastAnim, { toValue: 0, duration: 250, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(() => setToastVisible(false));
  };

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

  const onDateChange = (_: unknown, date?: Date) => {
    setShowDatePicker(false);
    if (date) setSelectedDate(date);
  };

  const downloadPdf = async () => {
    setDownloading(true);
    downloadTimeoutRef.current = setTimeout(() => {
      setDownloading(false);
      Alert.alert("Timed Out", "Download took too long. Please try again.");
    }, 15000);
    try {
      const filtered = reports.filter((r) => isSameDay(r, selectedDate));
      if (filtered.length === 0) {
        Alert.alert("No Reports", `No approved reports found for ${formatDate({ toDate: () => selectedDate })}.`);
        return;
      }

      const groups = groupByDate(filtered);
      const html = buildHtml(groups);
      const { base64 } = await Print.printToFileAsync({ html, base64: true });

      const pad = (n: number) => String(n).padStart(2, "0");
      const fileName = `daily-reports-${selectedDate.getFullYear()}-${pad(selectedDate.getMonth() + 1)}-${pad(selectedDate.getDate())}.pdf`;
      const cachePath = `${RNBlobUtil.fs.dirs.CacheDir}/daily-reports-temp.pdf`;
      await RNBlobUtil.fs.writeFile(cachePath, base64!, "base64");
      await RNBlobUtil.MediaCollection.copyToMediaStore(
        { name: fileName, parentFolder: "", mimeType: "application/pdf" },
        "Download",
        cachePath
      );
      RNBlobUtil.fs.unlink(cachePath).catch(() => {});

      showToast();
    } catch (err) {
      console.error("Download error:", err);
      Alert.alert("Download Failed", "Something went wrong. Please try again.");
    } finally {
      if (downloadTimeoutRef.current) {
        clearTimeout(downloadTimeoutRef.current);
        downloadTimeoutRef.current = null;
      }
      setDownloading(false);
    }
  };

  if (checking) {
    return <View style={styles.fullCenter}><ActivityIndicator color="#0C2D6B" size="large" /></View>;
  }

  const groups = groupByDate(reports);

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
        <Text style={styles.pageTitle}>Daily reports</Text>
        <TouchableOpacity style={styles.datePill} onPress={() => setShowDatePicker(true)} activeOpacity={0.7}>
          <Text style={styles.datePillText}>{formatDate({ toDate: () => selectedDate })}</Text>
        </TouchableOpacity>
      </View>

      {showDatePicker && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display="default"
          maximumDate={new Date()}
          onValueChange={onDateChange}
          onDismiss={() => setShowDatePicker(false)}
        />
      )}

      {/* Download Report button */}
      <View style={styles.downloadRow}>
        <TouchableOpacity
          style={[styles.downloadBtn, downloading && styles.downloadBtnDisabled]}
          onPress={downloadPdf}
          disabled={downloading}
          activeOpacity={0.8}
        >
          {downloading ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <>
              <Ionicons name="download-outline" size={16} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.downloadBtnText}>Download Report</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color="#0C2D6B" size="large" style={styles.loader} />
      ) : reports.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="document-text-outline" size={40} color="#B5D4F4" style={{ marginBottom: 10 }} />
          <Text style={styles.emptyText}>No reports for this period.</Text>
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(item) => item.date}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: group }) => (
            <View>
              <Text style={styles.groupDate}>{group.date}</Text>
              {group.items.map((r) => (
                <View key={r.id} style={styles.reportCard}>
                  <View style={styles.cardIcon}>
                    <Ionicons
                      name={
                        r.category === "archive"
                          ? "archive-outline"
                          : r.category === "finance"
                          ? "cash-outline"
                          : "document-text-outline"
                      }
                      size={18}
                      color="#0C2D6B"
                    />
                  </View>
                  <View style={styles.cardText}>
                    <Text style={styles.reportTitle}>{categoryLabel(r.category)}</Text>
                    <Text style={styles.reportDesc}>{reportDesc(r)}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        />
      )}

      <OwnerSidebar visible={sidebarVisible} onClose={() => setSidebarVisible(false)} />

      {toastVisible && (
        <Animated.View
          style={[
            styles.toast,
            {
              opacity: toastAnim,
              transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
            },
          ]}
        >
          <Ionicons name="checkmark-circle" size={22} color="#B5D4F4" style={{ marginRight: 10 }} />
          <Text style={styles.toastText}>PDF saved to Downloads.</Text>
        </Animated.View>
      )}
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
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "500",
    color: "#FFFFFF",
    textAlign: "center",
  },
  downloadRow: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
  },
  downloadBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0C2D6B",
    borderRadius: 12,
    paddingVertical: 13,
  },
  downloadBtnDisabled: { opacity: 0.4 },
  downloadBtnText: { fontSize: 14, fontWeight: "600", color: "#FFFFFF" },

  subHeader: {
    backgroundColor: "#1A4DA0",
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pageTitle: { fontSize: 16, fontWeight: "500", color: "#FFFFFF" },
  datePill: {
    backgroundColor: "#0C2D6B",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  datePillText: { fontSize: 12, fontWeight: "500", color: "#B5D4F4" },

  loader: { marginTop: 60 },

  emptyBox: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  emptyText: { fontSize: 15, color: "#888780", textAlign: "center" },

  list: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 },

  groupDate: {
    fontSize: 15,
    fontWeight: "500",
    color: "#1A4DA0",
    marginTop: 16,
    marginBottom: 8,
  },

  reportCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 0.5,
    borderColor: "#B5D4F4",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#E6F1FB",
    alignItems: "center",
    justifyContent: "center",
  },
  cardText: { flex: 1 },
  reportTitle: { fontSize: 14, fontWeight: "500", color: "#0C2D6B" },
  reportDesc: { fontSize: 13, color: "#888780", marginTop: 2 },

  toast: {
    position: "absolute",
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: "#0C2D6B",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  toastText: { fontSize: 15, fontWeight: "500", color: "#FFFFFF", flex: 1 },
});

