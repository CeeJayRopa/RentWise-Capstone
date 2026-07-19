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
  RefreshControl,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Print from "expo-print";
import RNBlobUtil from "react-native-blob-util";
import DateTimePicker from "@react-native-community/datetimepicker";

import { House, HelpCircle, Download, FileText, Archive, Wallet, CheckCircle2 } from "lucide-react-native";

import { auth } from "../../shared/services/auth";
import { db } from "../../shared/services/firestore";
import HelpTour, { HelpStep } from "../components/HelpTour";
import OwnerBellIcon from "../components/OwnerBellIcon";
import { hasSeenPageTour, markPageTourSeen } from "../../shared/services/onboardingTour";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";

type ReportDoc = {
  id: string;
  // Legacy schema
  category?: "building" | "finance" | "archive";
  status?: string;
  change?: string;
  // New schema
  module?: string;
  type?: string;
  fieldChanged?: string;
  oldValue?: string;
  newValue?: string;
  // Common
  spaceNo?: string;
  tenantName?: string;
  approvalStatus?: string;
  createdAt?: any;
};

function moduleToCategory(module: string): "building" | "finance" | "archive" {
  if (module === "Building Management") return "building";
  if (module === "Financials") return "finance";
  return "archive";
}

function resolveCategory(r: ReportDoc): "building" | "finance" | "archive" {
  if (r.module) return moduleToCategory(r.module);
  return r.category ?? "archive";
}

function categoryLabel(cat: string): string {
  if (cat === "building") return "Building Management Update";
  if (cat === "finance") return "Financial Change";
  return "Account Archive Update";
}

function categoryTag(r: ReportDoc): string {
  const cat = resolveCategory(r);
  if (cat === "building") return r.fieldChanged || "Building";
  if (cat === "finance") return "Payment";
  return "Tenant";
}

function reportDesc(r: ReportDoc): string {
  const detail =
    r.oldValue && r.newValue
      ? `${r.oldValue} → ${r.newValue}`
      : (r.change ?? r.status ?? r.fieldChanged ?? r.type ?? null);
  const detailStr = detail && detail !== 'undefined' ? detail : '—';
  if (r.spaceNo) return `Space ${r.spaceNo} · ${detailStr}`;
  if (r.tenantName) return `${r.tenantName} · ${detailStr}`;
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
        ${g.items.map((r) => `<div class="item"><strong>${categoryLabel(resolveCategory(r))}</strong><p>${reportDesc(r)}</p></div>`).join("")}
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
  const [refreshing, setRefreshing] = useState(false);
  const [reports, setReports] = useState<ReportDoc[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const downloadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // After the very first successful load, refocus-triggered refetches (e.g. coming back
  // from a report's detail screen) skip the loading spinner so the FlatList never unmounts
  // — unmounting is what was resetting the scroll position back to the top on every return.
  const hasLoadedOnceRef = useRef(false);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const [toastVisible, setToastVisible] = useState(false);
  const [tourVisible, setTourVisible] = useState(false);
  const homeRef = useRef<View>(null);
  const bellRef = useRef<View>(null);
  const datePillRef = useRef<View>(null);
  const downloadRef = useRef<View>(null);
  const listRef = useRef<View>(null);

  const tourSteps: HelpStep[] = [
    { key: "home", ref: homeRef, title: "Home", description: "Takes you back to the dashboard.", edgeInset: "top", round: true },
    { key: "bell", ref: bellRef, title: "Notifications", description: "Shows admin updates waiting for your review, like payments and building changes.", edgeInset: "top", round: true },
    { key: "date", ref: datePillRef, title: "Date filter", description: "Pick a date to only download reports acknowledged on that day.", edgeInset: "top" },
    { key: "download", ref: downloadRef, title: "Download Report", description: "Saves a PDF of the reports for the selected date to your phone's Downloads folder.", edgeInset: "top" },
    { key: "list", ref: listRef, title: "Report list", description: "Every update the admin made that you've acknowledged, grouped by date. Reports are auto-deleted once they're over a month old.", edgeInset: "top", clipBottom: 90 },
  ];

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

  // Auto-opens the guided tour the first time the owner ever lands on this
  // page — never again after that, since it flips a persisted per-device
  // flag. Can still be replayed anytime via the Help button.
  useEffect(() => {
    if (checking) return;
    (async () => {
      const seen = await hasSeenPageTour("owner-daily-reports");
      if (!seen) {
        setTourVisible(true);
        await markPageTourSeen("owner-daily-reports");
      }
    })();
  }, [checking]);

  useFocusEffect(useCallback(() => { if (!checking) fetchData(); }, [checking]));

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const fetchData = async () => {
    if (!hasLoadedOnceRef.current) setLoading(true);
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
      hasLoadedOnceRef.current = true;
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
        Alert.alert("No Reports", `No acknowledged reports found for ${formatDate({ toDate: () => selectedDate })}.`);
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
    return <View style={styles.fullCenter}><ActivityIndicator color={colors.emerald} size="large" /></View>;
  }

  const groups = groupByDate(reports);

  return (
    <View style={styles.screen}>
      {/* Header */}
      <LinearGradient
        colors={[colors.emerald, colors.ink]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
          <View ref={homeRef} collapsable={false}>
            <TouchableOpacity onPress={() => router.push("/dashboard")} activeOpacity={0.7} style={styles.headerIconBtn}>
              <House size={24} color={colors.emeraldSoft} />
            </TouchableOpacity>
          </View>
          <Text style={styles.headerTitle}>RentWise</Text>
          <View style={styles.headerRight}>
            <View ref={bellRef} collapsable={false}>
              <OwnerBellIcon />
            </View>
            <TouchableOpacity onPress={() => setTourVisible(true)} activeOpacity={0.7} style={styles.headerIconBtn}>
              <HelpCircle size={24} color={colors.emeraldSoft} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Sub-header */}
        <View style={styles.subHeader}>
          <Text style={styles.pageTitle}>Daily reports</Text>
          <View ref={datePillRef} collapsable={false}>
            <TouchableOpacity style={styles.datePill} onPress={() => setShowDatePicker(true)} activeOpacity={0.7}>
              <Text style={styles.datePillText}>{formatDate({ toDate: () => selectedDate })}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </LinearGradient>

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
          ref={downloadRef}
          style={[styles.downloadBtn, downloading && styles.downloadBtnDisabled]}
          onPress={downloadPdf}
          disabled={downloading}
          activeOpacity={0.8}
        >
          {downloading ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <>
              <Download size={16} color={colors.white} style={{ marginRight: 8 }} />
              <Text style={styles.downloadBtnText}>Download Report</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }} ref={listRef} collapsable={false}>
      {loading ? (
        <ActivityIndicator color={colors.emerald} size="large" style={styles.loader} />
      ) : reports.length === 0 ? (
        <View style={styles.emptyBox}>
          <FileText size={40} color={colors.emeraldSoft} style={{ marginBottom: 10 }} />
          <Text style={styles.emptyText}>No reports for this period.</Text>
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(item) => item.date}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />
          }
          renderItem={({ item: group }) => (
            <View>
              <View style={styles.groupDateRow}>
                <View style={styles.groupDateDot} />
                <Text style={styles.groupDate}>{group.date}</Text>
                <View style={styles.groupDateLine} />
              </View>
              {group.items.map((r) => {
                const cat = resolveCategory(r);
                const CategoryIcon = cat === "archive" ? Archive : cat === "finance" ? Wallet : FileText;
                return (
                  <TouchableOpacity
                    key={r.id}
                    style={styles.reportCard}
                    activeOpacity={0.7}
                    onPress={() =>
                      router.push({
                        pathname: "/update-confirmation",
                        params: { id: r.id },
                      } as any)
                    }
                  >
                    <View style={styles.cardIcon}>
                      <CategoryIcon size={18} color={colors.emerald} />
                    </View>
                    <View style={styles.cardText}>
                      <Text style={styles.reportTitle} numberOfLines={1} ellipsizeMode="tail">{categoryLabel(cat)}</Text>
                      <Text style={styles.reportDesc} numberOfLines={1} ellipsizeMode="tail">{reportDesc(r)}</Text>
                    </View>
                    <View style={styles.tagPill}>
                      <Text style={styles.tagPillText} numberOfLines={1}>{categoryTag(r)}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        />
      )}
      </View>

      <HelpTour visible={tourVisible} steps={tourSteps} onClose={() => setTourVisible(false)} />

      {toastVisible && (
        <Animated.View
          style={[
            styles.toast,
            {
              bottom: insets.bottom + spacing.xxl,
              opacity: toastAnim,
              transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
            },
          ]}
        >
          <CheckCircle2 size={22} color={colors.emeraldSoft} style={{ marginRight: 10 }} />
          <Text style={styles.toastText}>PDF saved to Downloads.</Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.parchment },
  fullCenter: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.parchment },

  headerGradient: {
    borderBottomLeftRadius: radius.xl + 4,
    borderBottomRightRadius: radius.xl + 4,
    overflow: "hidden",
  },

  header: {
    paddingBottom: spacing.md + 2,
    paddingHorizontal: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerRight: { flexDirection: "row", alignItems: "center", gap: spacing.md + 2 },
  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
    color: colors.white,
    textAlign: "center",
  },
  downloadRow: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md + 2,
    paddingBottom: spacing.xs,
  },
  downloadBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.emerald,
    borderRadius: radius.md,
    paddingVertical: spacing.md + 1,
    ...shadow.button,
  },
  downloadBtnDisabled: { opacity: 0.4 },
  downloadBtnText: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.white },

  subHeader: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pageTitle: { fontSize: fontSize.md, fontFamily: fontFamily.semibold, color: colors.white },
  datePill: {
    backgroundColor: "rgba(255,255,255,0.16)",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  datePillText: { fontSize: fontSize.xs + 1, fontFamily: fontFamily.semibold, color: colors.emeraldSoft },

  loader: { marginTop: 60 },

  emptyBox: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  emptyText: { fontSize: fontSize.base, color: colors.textSecondary, fontFamily: fontFamily.regular, textAlign: "center" },

  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },

  groupDateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  groupDateDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.emerald },
  groupDate: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },
  groupDateLine: { flex: 1, height: 1, backgroundColor: colors.emeraldSoft },

  reportCard: {
    backgroundColor: colors.white,
    borderRadius: radius.xl + 4,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md + 2,
    marginBottom: spacing.sm + 2,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.emeraldSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  cardText: { flex: 1 },
  reportTitle: { fontSize: fontSize.sm, fontFamily: fontFamily.bold, color: colors.ink },
  reportDesc: { fontSize: fontSize.xs + 1, color: colors.textSecondary, fontFamily: fontFamily.regular, marginTop: 2 },

  tagPill: {
    backgroundColor: colors.successSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
    maxWidth: 92,
  },
  tagPillText: {
    fontSize: fontSize.xs - 1,
    fontFamily: fontFamily.bold,
    color: colors.emerald,
    textTransform: "uppercase",
  },

  toast: {
    position: "absolute",
    left: spacing.xl,
    right: spacing.xl,
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg + 2,
    flexDirection: "row",
    alignItems: "center",
    ...shadow.raised,
  },
  toastText: { fontSize: fontSize.base, fontFamily: fontFamily.medium, color: colors.white, flex: 1 },
});
