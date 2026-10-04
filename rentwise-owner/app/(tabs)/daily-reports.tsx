import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Animated,
  Easing,
  RefreshControl,
  Modal,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Print from "expo-print";
import RNBlobUtil from "react-native-blob-util";

import { House, HelpCircle, Download, FileText, Archive, Wallet, CheckCircle2, Clock, XCircle, ChevronLeft, ChevronRight } from "lucide-react-native";

import { auth } from "../../shared/services/auth";
import { db } from "../../shared/services/firestore";
import HelpTour, { HelpStep } from "../components/HelpTour";
import OwnerBellIcon from "../components/OwnerBellIcon";
import { hasSeenPageTour, markPageTourSeen } from "../../shared/services/onboardingTour";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";
import { readLocalCache, saveLocalCache } from "../../shared/services/localCache";

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
  reportCategory?: string;
  createdAt?: any;
};

type ReportPeriod = "Daily" | "Monthly" | "Annual";

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function moduleToCategory(module: string): "building" | "finance" | "archive" {
  if (module === "Building Management" || module === "Stall Management") return "building";
  if (module === "Financials") return "finance";
  return "archive";
}

function resolveCategory(r: ReportDoc): "building" | "finance" | "archive" {
  if (r.module) return moduleToCategory(r.module);
  return r.category ?? "archive";
}

function categoryLabel(cat: string): string {
  if (cat === "building") return "Stall Management Update";
  if (cat === "finance") return "Financial Change";
  return "Account Archive Update";
}

function displayCategory(r: ReportDoc): string {
  return r.reportCategory || categoryLabel(resolveCategory(r));
}

function statusLabel(r: ReportDoc): "Approved" | "Pending" | "Rejected" {
  const status = String(r.approvalStatus ?? r.status ?? "pending").toLowerCase();
  if (status === "approved" || status === "acknowledged") return "Approved";
  if (status === "rejected" || status === "failed") return "Rejected";
  return "Pending";
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

function isInPeriod(r: ReportDoc, target: Date, period: ReportPeriod): boolean {
  if (!r.createdAt) return false;
  const date: Date = r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt);
  if (period === "Annual") return date.getFullYear() === target.getFullYear();
  if (period === "Monthly") {
    return date.getFullYear() === target.getFullYear() && date.getMonth() === target.getMonth();
  }
  return isSameDay(r, target);
}

type ReportGroup = { date: string; items: ReportDoc[] };

function groupByDate(reports: ReportDoc[]): ReportGroup[] {
  const map = new Map<string, ReportDoc[]>();
  for (const r of reports) {
    const key = formatDate(r.createdAt);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return Array.from(map.entries()).map(([date, items]) => ({ date, items }));
}

function buildHtml(groups: { date: string; items: ReportDoc[] }[], period: ReportPeriod, periodLabel: string): string {
  const rows = groups
    .map(
      (g) => `
      <div class="group">
        <h3>${g.date}</h3>
        ${g.items.map((r) => `<div class="item"><strong>${displayCategory(r)}</strong><span class="status ${statusLabel(r).toLowerCase()}">${statusLabel(r)}</span><p>${reportDesc(r)}</p></div>`).join("")}
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
      .status { float: right; font-size: 11px; font-weight: bold; }
      .approved { color: #16835B; } .pending { color: #B7791F; } .rejected { color: #C53030; }
    </style>
  </head><body>
    <h1>RentWise ${period} Report</h1>
    <h2>Ka Domeng Talipapa Wet and Dry Market</h2>
    <h2>${periodLabel}</h2>
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
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>("Daily");
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [calendarDate, setCalendarDate] = useState<Date>(new Date());
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const downloadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // After the very first successful load, refocus-triggered refetches (e.g. coming back
  // from a report's detail screen) skip the loading spinner so the FlatList never unmounts
  // — unmounting is what was resetting the scroll position back to the top on every return.
  const hasLoadedOnceRef = useRef(false);
  const flatListRef = useRef<FlatList<ReportGroup>>(null);
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
    { key: "date", ref: datePillRef, title: "Report period", description: "Choose Daily, Monthly, or Annual, then select the date, month, or year to review.", edgeInset: "top" },
    { key: "download", ref: downloadRef, title: "Download Report", description: "Saves a PDF for the selected reporting period to your phone's Downloads folder.", edgeInset: "top" },
    { key: "list", ref: listRef, title: "Report list", description: "Shows admin updates grouped by date, with consistent approved, pending, and rejected statuses.", edgeInset: "top", clipBottom: 90 },
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
      const snap = await getDocs(collection(db, "updates"));
      const docs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as ReportDoc))
        .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      setReports(docs);
      await saveLocalCache("owner:reports", docs);
    } catch (err) {
      console.error("DAILY REPORTS ERROR:", err);
      const cached = await readLocalCache<ReportDoc[]>("owner:reports");
      if (cached) setReports(cached);
    } finally {
      setLoading(false);
      hasLoadedOnceRef.current = true;
    }
  };

  const openCalendar = () => {
    setCalendarDate(selectedDate);
    setCalendarMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
    setCalendarVisible(true);
  };

  const applyCalendarDate = (date: Date) => {
    setSelectedDate(date);
    setCalendarVisible(false);

    // If the picked date has a group in the (already-loaded) list, scroll
    // to it -- lets the owner jump straight to that day's reports instead
    // of hunting through the whole list by hand.
    const targetKey = formatDate({ toDate: () => date });
    const groups = groupByDate(reports);
    const index = groups.findIndex((g) => g.date === targetKey);
    if (index !== -1) {
      requestAnimationFrame(() => {
        flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0 });
      });
    }
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const displayedYear = calendarMonth.getFullYear();
  const displayedMonth = calendarMonth.getMonth();
  const daysInDisplayedMonth = new Date(displayedYear, displayedMonth + 1, 0).getDate();
  const firstWeekday = new Date(displayedYear, displayedMonth, 1).getDay();
  const calendarCells: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInDisplayedMonth }, (_, index) => index + 1),
  ];
  while (calendarCells.length % 7 !== 0) calendarCells.push(null);

  const changeCalendarMonth = (amount: number) => {
    const next = new Date(displayedYear, displayedMonth + amount, 1);
    if (next > new Date(today.getFullYear(), today.getMonth(), 1)) return;
    setCalendarMonth(next);
  };

  const changeCalendarYear = (amount: number) => {
    const nextYear = displayedYear + amount;
    if (nextYear > today.getFullYear()) return;
    const nextMonth = reportPeriod === "Daily"
      ? displayedMonth
      : nextYear === today.getFullYear()
        ? Math.min(displayedMonth, today.getMonth())
        : displayedMonth;
    const next = new Date(nextYear, nextMonth, 1);
    const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    if (next > currentMonth) return;
    setCalendarMonth(next);
  };

  const applySelectedPeriod = () => {
    if (reportPeriod === "Annual") {
      applyCalendarDate(new Date(displayedYear, 0, 1));
      return;
    }
    if (reportPeriod === "Monthly") {
      applyCalendarDate(new Date(displayedYear, displayedMonth, 1));
      return;
    }
    applyCalendarDate(calendarDate);
  };

  const downloadPdf = async () => {
    setDownloading(true);
    downloadTimeoutRef.current = setTimeout(() => {
      setDownloading(false);
      Alert.alert("Timed Out", "Download took too long. Please try again.");
    }, 15000);
    try {
      const filtered = reports.filter((r) => isInPeriod(r, selectedDate, reportPeriod));
      if (filtered.length === 0) {
        Alert.alert("No Reports", `No reports found for the selected ${reportPeriod.toLowerCase()} period.`);
        return;
      }

      const groups = groupByDate(filtered);
      const periodLabel = reportPeriod === "Annual"
        ? String(selectedDate.getFullYear())
        : reportPeriod === "Monthly"
          ? selectedDate.toLocaleDateString("en-PH", { month: "long", year: "numeric" })
          : formatDate({ toDate: () => selectedDate });
      const html = buildHtml(groups, reportPeriod, periodLabel);
      const { base64 } = await Print.printToFileAsync({ html, base64: true });

      const pad = (n: number) => String(n).padStart(2, "0");
      const periodKey = reportPeriod === "Annual"
        ? `${selectedDate.getFullYear()}`
        : reportPeriod === "Monthly"
          ? `${selectedDate.getFullYear()}-${pad(selectedDate.getMonth() + 1)}`
          : `${selectedDate.getFullYear()}-${pad(selectedDate.getMonth() + 1)}-${pad(selectedDate.getDate())}`;
      const fileName = `${reportPeriod.toLowerCase()}-reports-${periodKey}.pdf`;
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

  const visibleReports = reports.filter((r) => isInPeriod(r, selectedDate, reportPeriod));
  const groups = groupByDate(visibleReports);
  const approvedCount = visibleReports.filter((r) => statusLabel(r) === "Approved").length;
  const pendingCount = visibleReports.filter((r) => statusLabel(r) === "Pending").length;
  const rejectedCount = visibleReports.filter((r) => statusLabel(r) === "Rejected").length;
  const selectedPeriodLabel = reportPeriod === "Annual"
    ? String(selectedDate.getFullYear())
    : reportPeriod === "Monthly"
      ? selectedDate.toLocaleDateString("en-PH", { month: "short", year: "numeric" })
      : formatDate({ toDate: () => selectedDate });

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
          <Text style={styles.pageTitle}>Reports</Text>
          <View>
            <TouchableOpacity style={styles.datePill} onPress={openCalendar} activeOpacity={0.7}>
              <Text style={styles.datePillText}>{selectedPeriodLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.periodSection} ref={datePillRef} collapsable={false}>
        <View style={styles.periodTabs}>
          {(["Daily", "Monthly", "Annual"] as ReportPeriod[]).map((period) => (
            <TouchableOpacity
              key={period}
              style={[styles.periodTab, reportPeriod === period && styles.periodTabActive]}
              onPress={() => setReportPeriod(period)}
              activeOpacity={0.8}
            >
              <Text style={[styles.periodTabText, reportPeriod === period && styles.periodTabTextActive]}>{period}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.statusSummary}>
          <View style={[styles.statusSummaryCard, styles.statusApprovedCard]}>
            <CheckCircle2 size={14} color={colors.success} />
            <Text style={styles.statusApprovedText}>{approvedCount} Approved</Text>
          </View>
          <View style={[styles.statusSummaryCard, styles.statusPendingCard]}>
            <Clock size={14} color={colors.warning} />
            <Text style={styles.statusPendingText}>{pendingCount} Pending</Text>
          </View>
          <View style={[styles.statusSummaryCard, styles.statusRejectedCard]}>
            <XCircle size={14} color={colors.error} />
            <Text style={styles.statusRejectedText}>{rejectedCount} Rejected</Text>
          </View>
        </View>
      </View>

      {/* Download Report button */}
      <View style={styles.downloadRow}>
        <Pressable
          ref={downloadRef}
          style={({ pressed }) => [
            styles.downloadBtn,
            downloading && styles.downloadBtnDisabled,
            pressed && !downloading && styles.downloadBtnPressed,
          ]}
          onPress={downloadPdf}
          disabled={downloading}
        >
          {({ pressed }) =>
            downloading ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <>
                <Download size={16} color={pressed ? colors.emerald : colors.white} style={{ marginRight: 8 }} />
                <Text style={[styles.downloadBtnText, pressed && styles.downloadBtnTextPressed]}>Download Report</Text>
              </>
            )
          }
        </Pressable>
      </View>

      <View style={{ flex: 1 }} ref={listRef} collapsable={false}>
      {loading ? (
        <ActivityIndicator color={colors.emerald} size="large" style={styles.loader} />
      ) : visibleReports.length === 0 ? (
        <View style={styles.emptyBox}>
          <FileText size={40} color={colors.emeraldSoft} style={{ marginBottom: 10 }} />
          <Text style={styles.emptyText}>No reports for this period.</Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={groups}
          keyExtractor={(item) => item.date}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />
          }
          // Each group renders a variable number of report cards, so there's
          // no fixed item height for scrollToIndex to rely on up front --
          // this retries with an approximate offset once the target has
          // actually been measured, which is the standard FlatList fix.
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              flatListRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0 });
            }, 100);
          }}
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
                        params: { id: r.id, source: "reports" },
                      } as any)
                    }
                  >
                    <View style={styles.cardIcon}>
                      <CategoryIcon size={18} color={colors.emerald} />
                    </View>
                    <View style={styles.cardText}>
                      <Text style={styles.reportTitle} numberOfLines={1} ellipsizeMode="tail">{displayCategory(r)}</Text>
                      <Text style={styles.reportDesc} numberOfLines={1} ellipsizeMode="tail">{reportDesc(r)}</Text>
                    </View>
                    <View style={[
                      styles.tagPill,
                      statusLabel(r) === "Approved" ? styles.tagApproved : statusLabel(r) === "Rejected" ? styles.tagRejected : styles.tagPending,
                    ]}>
                      <Text style={[
                        styles.tagPillText,
                        statusLabel(r) === "Approved" ? styles.tagApprovedText : statusLabel(r) === "Rejected" ? styles.tagRejectedText : styles.tagPendingText,
                      ]} numberOfLines={1}>{statusLabel(r)}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        />
      )}
      </View>

      <Modal
        visible={calendarVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCalendarVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setCalendarVisible(false)}>
          <Pressable style={styles.calendarSheet} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.dateMenuTitle}>
              {reportPeriod === "Annual" ? "Choose report year" : reportPeriod === "Monthly" ? "Choose report month" : "Choose report date"}
            </Text>
            <View style={styles.calendarYearRow}>
              <TouchableOpacity style={styles.calendarYearButton} onPress={() => changeCalendarYear(-1)}>
                <Text style={styles.calendarYearButtonText}>Previous year</Text>
              </TouchableOpacity>
              <Text style={styles.calendarYearText}>{displayedYear}</Text>
              <TouchableOpacity
                style={styles.calendarYearButton}
                onPress={() => changeCalendarYear(1)}
                disabled={displayedYear >= today.getFullYear()}
              >
                <Text style={[styles.calendarYearButtonText, displayedYear >= today.getFullYear() && styles.calendarDisabledText]}>
                  Next year
                </Text>
              </TouchableOpacity>
            </View>
            {reportPeriod === "Annual" ? (
              <View style={styles.annualSelection}>
                <Text style={styles.annualSelectionYear}>{displayedYear}</Text>
                <Text style={styles.annualSelectionHint}>The report will include the full year.</Text>
              </View>
            ) : reportPeriod === "Monthly" ? (
              <View style={styles.monthSelectionGrid}>
                {Array.from({ length: 12 }, (_, month) => {
                  const disabled = displayedYear === today.getFullYear() && month > today.getMonth();
                  const selected = month === displayedMonth;
                  return (
                    <TouchableOpacity
                      key={month}
                      style={[styles.monthSelectionCell, selected && styles.monthSelectionCellSelected]}
                      disabled={disabled}
                      onPress={() => setCalendarMonth(new Date(displayedYear, month, 1))}
                    >
                      <Text style={[
                        styles.monthSelectionText,
                        disabled && styles.calendarDisabledText,
                        selected && styles.monthSelectionTextSelected,
                      ]}>
                        {new Date(displayedYear, month, 1).toLocaleDateString("en-PH", { month: "short" })}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <>
                <View style={styles.calendarMonthRow}>
                  <TouchableOpacity style={styles.calendarArrowButton} onPress={() => changeCalendarMonth(-1)}>
                    <ChevronLeft size={21} color={colors.emerald} />
                  </TouchableOpacity>
                  <Text style={styles.calendarMonthText}>
                    {calendarMonth.toLocaleDateString("en-PH", { month: "long" })}
                  </Text>
                  <TouchableOpacity
                    style={styles.calendarArrowButton}
                    onPress={() => changeCalendarMonth(1)}
                    disabled={displayedYear === today.getFullYear() && displayedMonth === today.getMonth()}
                  >
                    <ChevronRight
                      size={21}
                      color={displayedYear === today.getFullYear() && displayedMonth === today.getMonth() ? colors.textMuted : colors.emerald}
                    />
                  </TouchableOpacity>
                </View>
                <View style={styles.calendarGrid}>
                  {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
                    <Text key={`${day}-${index}`} style={styles.calendarWeekday}>{day}</Text>
                  ))}
                  {calendarCells.map((day, index) => {
                    if (!day) return <View key={`empty-${index}`} style={styles.calendarDayCell} />;
                    const cellDate = new Date(displayedYear, displayedMonth, day);
                    const disabled = cellDate > today;
                    const selected = localDateKey(cellDate) === localDateKey(calendarDate);
                    return (
                      <TouchableOpacity
                        key={`${displayedYear}-${displayedMonth}-${day}`}
                        style={[styles.calendarDayCell, selected && styles.calendarDaySelected]}
                        disabled={disabled}
                        onPress={() => setCalendarDate(cellDate)}
                      >
                        <Text style={[
                          styles.calendarDayText,
                          disabled && styles.calendarDisabledText,
                          selected && styles.calendarDaySelectedText,
                        ]}>
                          {day}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}
            <View style={styles.calendarActions}>
              <TouchableOpacity onPress={() => setCalendarVisible(false)} style={styles.calendarCancelButton}>
                <Text style={styles.calendarCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={applySelectedPeriod} style={styles.calendarApplyButton}>
                <Text style={styles.calendarApplyText}>Show Reports</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

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
  downloadBtnPressed: { backgroundColor: colors.white },
  downloadBtnText: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.white },
  downloadBtnTextPressed: { color: colors.emerald },

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

  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    padding: spacing.xl,
  },
  calendarSheet: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.md,
    ...shadow.card,
  },
  dateMenuTitle: {
    fontSize: fontSize.md,
    color: colors.ink,
    fontFamily: fontFamily.bold,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  calendarYearRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  calendarYearButton: {
    minWidth: 86,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  calendarYearButtonText: {
    fontSize: fontSize.xs,
    color: colors.emerald,
    fontFamily: fontFamily.semibold,
  },
  calendarYearText: {
    fontSize: fontSize.base,
    color: colors.ink,
    fontFamily: fontFamily.bold,
  },
  calendarMonthRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  calendarArrowButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.mist,
  },
  calendarMonthText: {
    fontSize: fontSize.md,
    color: colors.ink,
    fontFamily: fontFamily.bold,
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: spacing.sm,
  },
  calendarWeekday: {
    width: "14.2857%",
    textAlign: "center",
    paddingVertical: spacing.sm,
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontFamily: fontFamily.bold,
  },
  calendarDayCell: {
    width: "14.2857%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
  },
  calendarDaySelected: { backgroundColor: colors.emerald },
  calendarDayText: {
    color: colors.textPrimary,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
  },
  calendarDaySelectedText: { color: colors.white, fontFamily: fontFamily.bold },
  calendarDisabledText: { color: colors.textMuted },
  annualSelection: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.mist,
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    marginVertical: spacing.sm,
  },
  annualSelectionYear: {
    fontSize: fontSize.xl,
    color: colors.emerald,
    fontFamily: fontFamily.bold,
  },
  annualSelectionHint: {
    marginTop: spacing.xs,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    fontFamily: fontFamily.regular,
  },
  monthSelectionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginVertical: spacing.sm,
  },
  monthSelectionCell: {
    width: "33.3333%",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  monthSelectionCellSelected: { backgroundColor: colors.emerald },
  monthSelectionText: {
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    fontFamily: fontFamily.semibold,
  },
  monthSelectionTextSelected: { color: colors.white, fontFamily: fontFamily.bold },
  calendarActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  calendarCancelButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  calendarCancelText: {
    color: colors.textSecondary,
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.sm,
  },
  calendarApplyButton: {
    backgroundColor: colors.emerald,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  calendarApplyText: {
    color: colors.white,
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
  },

  periodSection: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  periodTabs: {
    flexDirection: "row",
    backgroundColor: colors.mist,
    borderRadius: radius.pill,
    padding: 3,
  },
  periodTab: {
    flex: 1,
    alignItems: "center",
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
  },
  periodTabActive: { backgroundColor: colors.emerald },
  periodTabText: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.textSecondary },
  periodTabTextActive: { color: colors.white },
  statusSummary: {
    flexDirection: "row",
    gap: 5,
    marginTop: spacing.sm,
  },
  statusSummaryCard: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: 7,
    paddingHorizontal: 4,
  },
  statusApprovedCard: { backgroundColor: colors.successSoft, borderColor: colors.success },
  statusPendingCard: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
  statusRejectedCard: { backgroundColor: colors.errorSoft, borderColor: colors.error },
  statusApprovedText: { flexShrink: 1, fontSize: fontSize.xs - 1, fontFamily: fontFamily.bold, color: colors.success },
  statusPendingText: { flexShrink: 1, fontSize: fontSize.xs - 1, fontFamily: fontFamily.bold, color: colors.warning },
  statusRejectedText: { flexShrink: 1, fontSize: fontSize.xs - 1, fontFamily: fontFamily.bold, color: colors.error },

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
  tagApproved: { backgroundColor: colors.successSoft },
  tagPending: { backgroundColor: colors.warningSoft },
  tagRejected: { backgroundColor: colors.errorSoft },
  tagApprovedText: { color: colors.success },
  tagPendingText: { color: colors.warning },
  tagRejectedText: { color: colors.error },

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
