import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
  Modal,
  Pressable,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, onSnapshot, orderBy, query, Timestamp, where } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { House, HelpCircle, FileText, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Check, CheckCircle2, Clock3, ArrowRight, Archive } from "lucide-react-native";

import { auth } from "../../shared/services/auth";
import { db } from "../../shared/services/firestore";
import HelpTour, { HelpStep } from "../components/HelpTour";
import HelpSupportModal from "../components/HelpSupportModal";
import { hasSeenPageTour, markPageTourSeen } from "../../shared/services/onboardingTour";
import { Card, Badge, EmptyState } from "../../shared/components/ui";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";
import { readLocalCache, saveLocalCache } from "../../shared/services/localCache";

type ReportDoc = {
  id: string;
  module?: string;
  type?: string;
  fieldChanged?: string;
  oldValue?: string;
  newValue?: string;
  spaceNo?: string;
  buildingNo?: string;
  tenantName?: string;
  approvalStatus?: string;
  createdAt?: any;
  submittedAt?: any;
  updatedAt?: any;
  date?: any;
  category?: "building" | "finance" | "archive";
};

type ReportPeriod = "Daily" | "Monthly" | "Annual" | "Range";
type ReportCategory = "all" | "building" | "finance" | "archive";

const REPORT_CATEGORIES: {key: ReportCategory; label: string}[] = [
  {key: "all", label: "All"},
  {key: "building", label: "Stalls"},
  {key: "finance", label: "Financial"},
  {key: "archive", label: "Tenants"},
];

function resolveReportCategory(report: ReportDoc): Exclude<ReportCategory, "all"> {
  if (report.category === "building" || report.category === "finance" || report.category === "archive") {
    return report.category;
  }
  const module = String(report.module ?? "").toLowerCase();
  if (module.includes("building") || module.includes("stall")) return "building";
  if (module.includes("financial") || module.includes("payment")) return "finance";
  return "archive";
}

function reportDateBounds(period: ReportPeriod, selected: Date, rangeStart: Date, rangeEnd: Date) {
  if (period === "Annual") return {
    start: new Date(selected.getFullYear(), 0, 1),
    end: new Date(selected.getFullYear(), 11, 31, 23, 59, 59, 999),
  };
  if (period === "Monthly") return {
    start: new Date(selected.getFullYear(), selected.getMonth(), 1),
    end: new Date(selected.getFullYear(), selected.getMonth() + 1, 0, 23, 59, 59, 999),
  };
  if (period === "Range") return {
    start: new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate()),
    end: new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate(), 23, 59, 59, 999),
  };
  return {
    start: new Date(selected.getFullYear(), selected.getMonth(), selected.getDate()),
    end: new Date(selected.getFullYear(), selected.getMonth(), selected.getDate(), 23, 59, 59, 999),
  };
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromOffset(daysAgo: number): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date;
}

function reportTitle(r: ReportDoc): string {
  return r.type || r.module || "Report";
}

function reportDesc(r: ReportDoc): string {
  const detail =
    r.oldValue && r.newValue ? `${r.fieldChanged ? r.fieldChanged + ": " : ""}${r.oldValue} → ${r.newValue}` : (r.fieldChanged ?? null);
  const detailStr = detail && detail !== "undefined" ? detail : "—";
  if (r.spaceNo) return `Space ${r.spaceNo} — ${detailStr}`;
  if (r.tenantName) return `${r.tenantName} — ${detailStr}`;
  return detailStr;
}

function timestampToMillis(value: any): number {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value.seconds === "number") {
    return value.seconds * 1000 + Math.floor(Number(value.nanoseconds ?? 0) / 1_000_000);
  }
  if (typeof value._seconds === "number") {
    return value._seconds * 1000 + Math.floor(Number(value._nanoseconds ?? 0) / 1_000_000);
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value < 1_000_000_000_000 ? value * 1000 : value;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function reportTimestamp(r: ReportDoc): number {
  return timestampToMillis(r.createdAt ?? r.submittedAt ?? r.updatedAt ?? r.date);
}

function formatDate(r: ReportDoc): string {
  const ms = reportTimestamp(r);
  if (!ms) return "Unknown date";
  const d = new Date(ms);
  return d.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });
}

function formatTime(r: ReportDoc): string {
  const ms = reportTimestamp(r);
  if (!ms) return "Unknown time";
  return new Date(ms).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
}

function groupByDate(reports: ReportDoc[]): { date: string; items: ReportDoc[] }[] {
  const map = new Map<string, ReportDoc[]>();
  for (const r of reports) {
    const key = formatDate(r);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return Array.from(map.entries()).map(([date, items]) => ({ date, items }));
}

function statusLabel(status?: string): string {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Pending";
}

function statusTone(status: string): "success" | "error" | "warning" {
  if (status === "Approved") return "success";
  if (status === "Rejected") return "error";
  return "warning";
}

export default function ReportsHistory() {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reports, setReports] = useState<ReportDoc[]>([]);
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>("Daily");
  const [reportCategory, setReportCategory] = useState<ReportCategory>("all");
  const [categoryMenuVisible, setCategoryMenuVisible] = useState(false);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [rangeStart, setRangeStart] = useState(new Date());
  const [rangeEnd, setRangeEnd] = useState(new Date());
  const [draftRangeStart, setDraftRangeStart] = useState(new Date());
  const [draftRangeEnd, setDraftRangeEnd] = useState(new Date());
  const [rangePicking, setRangePicking] = useState<"from" | "to">("from");
  const [calendarMonth, setCalendarMonth] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [tourVisible, setTourVisible] = useState(false);
  const [helpSupportVisible, setHelpSupportVisible] = useState(false);
  const hasLoadedOnceRef = useRef(false);

  const homeRef = useRef<View>(null);
  const helpRef = useRef<View>(null);
  const summaryRef = useRef<View>(null);
  const dateFilterRef = useRef<View>(null);
  // The list itself is unbounded height (as many cards as fit the screen),
  // which made the tour's spotlight cover a different number of cards on
  // every device. Spotlighting just the first two cards (span from
  // firstCardRef's top to secondCardRef's bottom, via HelpStep's endRef)
  // gives a fixed-size example that looks the same everywhere.
  const firstCardRef = useRef<View>(null);
  const secondCardRef = useRef<View>(null);

  const fetchData = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    if (!hasLoadedOnceRef.current) setLoading(true);
    try {
      const bounds = reportDateBounds(reportPeriod, calendarDate, rangeStart, rangeEnd);
      const snap = await getDocs(query(
        collection(db, "updates"),
        where("changedBy", "==", uid),
        where("createdAt", ">=", Timestamp.fromDate(bounds.start)),
        where("createdAt", "<=", Timestamp.fromDate(bounds.end)),
        orderBy("createdAt", "desc"),
      ));
      const docs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as ReportDoc))
        .sort((a, b) => {
          const dateDifference = reportTimestamp(b) - reportTimestamp(a);
          return dateDifference !== 0 ? dateDifference : b.id.localeCompare(a.id);
        });
      setReports(docs);
      await saveLocalCache(`admin:${uid}:reports`, docs);
    } catch (err) {
      console.error("REPORTS HISTORY ERROR:", err);
      const cached = await readLocalCache<ReportDoc[]>(`admin:${uid}:reports`);
      if (cached) setReports(cached);
    } finally {
      setLoading(false);
      hasLoadedOnceRef.current = true;
    }
  };

  useFocusEffect(
    useCallback(() => {
      let unsubscribeReports: (() => void) | undefined;
      const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
        if (!user) {
          router.replace("/");
          return;
        }
        setChecking(false);
        const bounds = reportDateBounds(reportPeriod, calendarDate, rangeStart, rangeEnd);
        unsubscribeReports = onSnapshot(
          query(
            collection(db, "updates"),
            where("changedBy", "==", user.uid),
            where("createdAt", ">=", Timestamp.fromDate(bounds.start)),
            where("createdAt", "<=", Timestamp.fromDate(bounds.end)),
            orderBy("createdAt", "desc"),
          ),
          (snapshot) => {
            const docs = snapshot.docs
              .map((d) => ({ id: d.id, ...d.data() } as ReportDoc))
              .sort((a, b) => {
                const dateDifference = reportTimestamp(b) - reportTimestamp(a);
                return dateDifference !== 0 ? dateDifference : b.id.localeCompare(a.id);
              });
            setReports(docs);
            setLoading(false);
            hasLoadedOnceRef.current = true;
          },
          (error) => {
            console.error("REPORTS HISTORY LISTENER ERROR:", error);
            setLoading(false);
          },
        );
      });
      return () => {
        unsubscribeAuth();
        unsubscribeReports?.();
      };
    }, [reportPeriod, calendarDate, rangeStart, rangeEnd]),
  );

  // Auto-opens the guided tour the first time the admin ever lands on this
  // page — never again after that, since it flips a persisted per-device
  // flag. Can still be replayed anytime via the Help button.
  useEffect(() => {
    if (checking) return;
    (async () => {
      const seen = await hasSeenPageTour("reports-history");
      if (!seen) {
        setTourVisible(true);
        await markPageTourSeen("reports-history");
      }
    })();
  }, [checking]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  if (checking) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator color={colors.emerald} size="large" />
      </View>
    );
  }

  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const endOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime();
  const visibleReports = reports.filter((report) => {
    if (reportCategory !== "all" && resolveReportCategory(report) !== reportCategory) return false;
    const timestamp = reportTimestamp(report);
    if (!timestamp) return false;
    const reportDate = new Date(timestamp);
    if (reportPeriod === "Annual") return reportDate.getFullYear() === calendarDate.getFullYear();
    if (reportPeriod === "Monthly") return reportDate.getFullYear() === calendarDate.getFullYear() && reportDate.getMonth() === calendarDate.getMonth();
    if (reportPeriod === "Range") return timestamp >= startOfDay(rangeStart) && timestamp <= endOfDay(rangeEnd);
    return localDateKey(reportDate) === localDateKey(calendarDate);
  });
  const groups = groupByDate(visibleReports);

  const selectedDateLabel = reportPeriod === "Annual"
    ? String(calendarDate.getFullYear())
    : reportPeriod === "Monthly"
      ? calendarDate.toLocaleDateString("en-PH", { month: "long", year: "numeric" })
      : reportPeriod === "Range"
        ? `${rangeStart.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })} – ${rangeEnd.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}`
        : calendarDate.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });

  const openCalendar = () => {
    const startingDate = reportPeriod === "Range" ? rangeStart : calendarDate;
    setCalendarDate(startingDate);
    setCalendarMonth(new Date(startingDate.getFullYear(), startingDate.getMonth(), 1));
    setDraftRangeStart(rangeStart);
    setDraftRangeEnd(rangeEnd);
    setRangePicking("from");
    setCalendarVisible(true);
  };

  const applyCalendarDate = () => {
    if (reportPeriod === "Range") {
      setRangeStart(draftRangeStart);
      setRangeEnd(draftRangeEnd);
    }
    setCalendarVisible(false);
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
    const next = new Date(displayedYear + amount, displayedMonth, 1);
    const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    if (next > currentMonth) return;
    setCalendarMonth(next);
  };

  const pendingCount = visibleReports.filter((r) => statusLabel(r.approvalStatus) === "Pending").length;
  const acknowledgedCount = visibleReports.filter((r) => statusLabel(r.approvalStatus) === "Approved").length;

  const tourSteps: HelpStep[] = [
    { key: "home", ref: homeRef, title: "Home", description: "Takes you back to the dashboard.", edgeInset: "top", round: true },
    { key: "summary", ref: summaryRef, title: "Pending / Approved", description: "How many of your submitted reports are still pending the owner's review, and how many were approved this week.", edgeInset: "top", insetXPercent: 0.03, heightTrimPercent: 0.108, nudgeYPercent: 0.018 },
    { key: "date", ref: dateFilterRef, title: "Date picker", description: "Reports start on Today. Tap this button to open the calendar, move through months or years, or choose Last 7 Days and All Reports.", edgeInset: "top" },
    { key: "list", ref: firstCardRef, endRef: secondCardRef, title: "Report history", description: "Every update report you've submitted to the owner, grouped by date, with its current approval status.", edgeInset: "top", hideDebug: true },
  ];

  return (
    <View style={styles.screen}>
      {/* HEADER */}
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
          <View ref={helpRef} collapsable={false}>
            <TouchableOpacity onPress={() => setHelpSupportVisible(true)} activeOpacity={0.7} style={styles.headerIconBtn}>
              <HelpCircle size={22} color={colors.emeraldSoft} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Sub-header */}
        <View style={styles.subHeader}>
          <Text style={styles.pageTitle}>Reports History</Text>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{visibleReports.length} Reports</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.periodTabs} ref={dateFilterRef} collapsable={false}>
        {(["Daily", "Monthly", "Annual", "Range"] as ReportPeriod[]).map((period) => {
          const active = reportPeriod === period;
          return <TouchableOpacity key={period} style={[styles.periodTab, active && styles.periodTabActive]} onPress={() => { setReportPeriod(period); if (period === "Range") { setDraftRangeStart(rangeStart); setDraftRangeEnd(rangeEnd); setRangePicking("from"); setCalendarMonth(new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1)); setCalendarVisible(true); } }} activeOpacity={0.75}>
            {period === "Daily" ? <CalendarDays size={14} color={active ? colors.emerald : colors.textSecondary} /> : null}
            <Text style={[styles.periodTabText, active && styles.periodTabTextActive]}>{period}</Text>
          </TouchableOpacity>;
        })}
      </View>

      <View style={styles.filterToolbarLayer}>
        <View style={styles.filterToolbar}>
          <TouchableOpacity style={styles.categoryPicker} onPress={() => setCategoryMenuVisible((visible) => !visible)} activeOpacity={0.75}>
            <Text style={styles.categoryPickerText}>{REPORT_CATEGORIES.find((item) => item.key === reportCategory)?.label}</Text>
            <ChevronDown size={15} color={colors.emerald} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.selectedPeriodButton} onPress={openCalendar} activeOpacity={0.75}>
            <CalendarDays size={13} color={colors.emerald} /><Text style={styles.selectedPeriodText} numberOfLines={1}>{selectedDateLabel}</Text><ChevronDown size={14} color={colors.emerald} />
          </TouchableOpacity>
        </View>
        {categoryMenuVisible && <View style={styles.categoryMenu}>
          {REPORT_CATEGORIES.map(({key, label}) => <TouchableOpacity key={key} style={[styles.categoryMenuItem, reportCategory === key && styles.categoryMenuItemActive]} onPress={() => { setReportCategory(key); setCategoryMenuVisible(false); }} activeOpacity={0.75}>
            <Text style={[styles.categoryMenuItemText, reportCategory === key && styles.categoryMenuItemTextActive]}>{label}</Text>
            {reportCategory === key && <Check size={15} color={colors.emerald} />}
          </TouchableOpacity>)}
        </View>}
      </View>

      <View style={styles.auditSummaryCard} ref={summaryRef} collapsable={false}>
        <Text style={styles.auditSummaryTitle}>{reportPeriod.toUpperCase()} · {REPORT_CATEGORIES.find((item) => item.key === reportCategory)?.label.toUpperCase()} AUDIT DISPOSITION</Text>
        <View style={styles.auditMetricsRow}>
          <View style={styles.auditMetric}><View style={styles.auditValueRow}><Text style={styles.auditValue}>{acknowledgedCount.toString().padStart(2, "0")}</Text><CheckCircle2 size={18} color="#16B987" /></View><Text style={styles.auditAcknowledged}>Acknowledged</Text></View>
          <View style={styles.auditDivider} />
          <View style={styles.auditMetric}><View style={styles.auditValueRow}><Text style={styles.auditValue}>{pendingCount.toString().padStart(2, "0")}</Text><Clock3 size={18} color={colors.error} /></View><Text style={styles.auditPending}>Pending Review</Text></View>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.emerald} size="large" style={styles.loader} />
      ) : visibleReports.length === 0 ? (
        <EmptyState
          icon={<FileText size={28} color={colors.textMuted} />}
          title={`No reports for ${selectedDateLabel.toLowerCase()}.`}
        />
      ) : (
        <View style={{ flex: 1 }}>
        <FlatList
          data={groups}
          keyExtractor={(item) => item.date}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />}
          renderItem={({ item: group, index: groupIndex }) => (
            <View>
              <Text style={styles.groupDate}>{group.date}</Text>
              {group.items.map((r, itemIndex) => {
                const status = statusLabel(r.approvalStatus);
                // Flat position of this card across ALL groups (not just
                // this one) -- used to tag only the very first two cards
                // for the HelpTour spotlight, see firstCardRef/secondCardRef.
                const globalIndex =
                  groups.slice(0, groupIndex).reduce((sum, g) => sum + g.items.length, 0) + itemIndex;
                const cardRef = globalIndex === 0 ? firstCardRef : globalIndex === 1 ? secondCardRef : undefined;
                return (
                  <View key={r.id} ref={cardRef} collapsable={false}>
                    <View style={styles.reportCard}>
                      <View style={styles.reportAccent} />
                      <View style={styles.reportHeaderRow}>
                        <View style={styles.cardIcon}>{(r.module || "").toLowerCase().includes("archive") ? <Archive size={16} color={colors.emerald} /> : <FileText size={16} color={colors.emerald} />}</View>
                        <View style={styles.reportHeadingText}>
                          <Text style={styles.reportModule}>{(r.module || "REPORT").toUpperCase()}</Text>
                          <Text style={styles.reportTitle} numberOfLines={2}>{reportTitle(r)}</Text>
                        </View>
                        <View style={[styles.reportStatusPill, status === "Approved" ? styles.reportStatusApproved : status === "Rejected" ? styles.reportStatusRejected : styles.reportStatusPending]}>
                          {status === "Approved" ? <CheckCircle2 size={12} color={colors.emerald} /> : <Clock3 size={12} color={status === "Rejected" ? colors.error : "#D66B3F"} />}
                          <Text style={[styles.reportStatusText, status === "Approved" ? styles.reportStatusTextApproved : styles.reportStatusTextPending]}>{status}</Text>
                        </View>
                      </View>
                      <View style={styles.reportDetailBox}>
                        <Text style={styles.reportTenant}>{r.tenantName || reportDesc(r)}</Text>
                        {r.tenantName ? <Text style={styles.reportChange} numberOfLines={1}>{reportDesc(r)}</Text> : null}
                        <Text style={styles.reportMeta}>Ref #{r.id.slice(-6).toUpperCase()} · {formatTime(r)} · Admin</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        />
        </View>
      )}

      <Modal
        visible={calendarVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCalendarVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setCalendarVisible(false)}>
          <Pressable style={styles.calendarSheet} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.dateMenuTitle}>{reportPeriod === "Range" ? "Choose Date Range" : `Choose Report ${reportPeriod === "Annual" ? "Year" : reportPeriod === "Monthly" ? "Month" : "Date"}`}</Text>
            {reportPeriod === "Range" ? <View style={styles.rangeSelectionRow}>
              <TouchableOpacity style={[styles.rangeSelectionButton, rangePicking === "from" && styles.rangeSelectionButtonActive]} onPress={() => setRangePicking("from")}><Text style={styles.rangeSelectionLabel}>FROM</Text><Text style={styles.rangeSelectionValue}>{draftRangeStart.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</Text></TouchableOpacity>
              <ArrowRight size={15} color={colors.textMuted} />
              <TouchableOpacity style={[styles.rangeSelectionButton, rangePicking === "to" && styles.rangeSelectionButtonActive]} onPress={() => setRangePicking("to")}><Text style={styles.rangeSelectionLabel}>TO</Text><Text style={styles.rangeSelectionValue}>{draftRangeEnd.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</Text></TouchableOpacity>
            </View> : null}
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
                const selected = reportPeriod === "Range"
                  ? localDateKey(cellDate) === localDateKey(rangePicking === "from" ? draftRangeStart : draftRangeEnd)
                  : localDateKey(cellDate) === localDateKey(calendarDate);
                const inSelectedRange = reportPeriod === "Range" && cellDate >= new Date(draftRangeStart.getFullYear(), draftRangeStart.getMonth(), draftRangeStart.getDate()) && cellDate <= new Date(draftRangeEnd.getFullYear(), draftRangeEnd.getMonth(), draftRangeEnd.getDate());
                return (
                  <TouchableOpacity
                    key={`${displayedYear}-${displayedMonth}-${day}`}
                    style={styles.calendarDayCell}
                    disabled={disabled}
                    onPress={() => {
                      if (reportPeriod === "Range") {
                        if (rangePicking === "from") { setDraftRangeStart(cellDate); if (cellDate > draftRangeEnd) setDraftRangeEnd(cellDate); setRangePicking("to"); }
                        else { if (cellDate < draftRangeStart) { setDraftRangeStart(cellDate); setDraftRangeEnd(cellDate); } else setDraftRangeEnd(cellDate); }
                      } else setCalendarDate(cellDate);
                    }}
                  >
                    <View style={[styles.calendarDayIndicator, inSelectedRange && styles.calendarDayInRange, selected && styles.calendarDaySelected]}>
                      <Text style={[
                        styles.calendarDayText,
                        disabled && styles.calendarDisabledText,
                        selected && styles.calendarDaySelectedText,
                      ]}>
                        {day}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.calendarActions}>
              <TouchableOpacity onPress={() => setCalendarVisible(false)} style={styles.calendarCancelButton}>
                <Text style={styles.calendarCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={applyCalendarDate} style={styles.calendarApplyButton}>
                <Text style={styles.calendarApplyText}>Show Reports</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <HelpTour visible={tourVisible} steps={tourSteps} onClose={() => setTourVisible(false)} />
      <HelpSupportModal visible={helpSupportVisible} steps={tourSteps} onClose={() => setHelpSupportVisible(false)} onReplayTour={() => setTourVisible(true)} />
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
  headerTitle: {
    flex: 1,
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
    color: colors.white,
    textAlign: "center",
  },
  subHeader: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pageTitle: { fontSize: fontSize.md, fontFamily: fontFamily.semibold, color: colors.white },
  countPill: {
    backgroundColor: "rgba(255,255,255,0.16)",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  countPillText: { fontSize: fontSize.xs + 1, fontFamily: fontFamily.semibold, color: colors.emeraldSoft },
  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },

  loader: { marginTop: 60 },

  list: { paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: 20 },

  periodTabs: {
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.mist,
    borderRadius: 11,
    padding: 3,
  },
  periodTab: { flex: 1, minHeight: 38, borderRadius: 9, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  periodTabActive: { backgroundColor: colors.white, borderWidth: 1, borderColor: "#DCE3DF", ...shadow.subtle },
  periodTabText: { fontSize: 12, fontFamily: fontFamily.medium, color: colors.textSecondary },
  periodTabTextActive: { color: colors.emerald, fontFamily: fontFamily.semibold },
  filterToolbarLayer: { position: "relative", zIndex: 20, elevation: 20 },
  filterToolbar: { marginHorizontal: spacing.md, marginTop: 9, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  categoryPicker: { minWidth: 118, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: spacing.md, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, ...shadow.subtle },
  categoryPickerText: { fontSize: 11, fontFamily: fontFamily.semibold, color: colors.ink },
  categoryMenu: { position: "absolute", top: 51, left: spacing.md, width: 170, zIndex: 30, elevation: 30, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, padding: 5, ...shadow.card },
  categoryMenuItem: { minHeight: 36, paddingHorizontal: 10, borderRadius: 7, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  categoryMenuItemActive: { backgroundColor: colors.mist },
  categoryMenuItemText: { fontSize: 11, fontFamily: fontFamily.medium, color: colors.textSecondary },
  categoryMenuItemTextActive: { color: colors.emerald, fontFamily: fontFamily.semibold },
  selectedPeriodButton: { flexShrink: 1, maxWidth: "62%", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.mist },
  selectedPeriodText: { maxWidth: "82%", fontSize: 11, fontFamily: fontFamily.semibold, color: colors.emerald },
  auditSummaryCard: { marginHorizontal: spacing.md, marginTop: 5, backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: "#E8EAE8", paddingHorizontal: 14, paddingVertical: 13, ...shadow.subtle },
  auditSummaryTitle: { fontSize: 9, fontFamily: fontFamily.medium, color: colors.ink, marginBottom: 9 },
  auditMetricsRow: { flexDirection: "row", alignItems: "center" },
  auditMetric: { flex: 1, alignItems: "center" },
  auditValueRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  auditValue: { fontSize: 27, lineHeight: 31, fontFamily: fontFamily.bold, color: colors.ink },
  auditAcknowledged: { fontSize: 11, fontFamily: fontFamily.medium, color: colors.ink },
  auditPending: { fontSize: 11, fontFamily: fontFamily.medium, color: colors.error },
  auditDivider: { width: 1, height: 42, backgroundColor: "#E8EAE8" },

  summaryRow: {
    flexDirection: "row",
    gap: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },
  summaryCard: {
    flex: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg - 2,
  },
  summaryCardPending: { backgroundColor: colors.emerald },
  summaryCardApproved: { backgroundColor: colors.emeraldSoft },
  summaryLabelPending: {
    fontSize: fontSize.xs - 1,
    fontFamily: fontFamily.semibold,
    color: colors.emeraldSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  summaryLabelApproved: {
    fontSize: fontSize.xs - 1,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  summaryValuePending: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.extrabold,
    color: colors.white,
    marginTop: 2,
  },
  summaryValueApproved: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.extrabold,
    color: colors.emerald,
    marginTop: 2,
  },

  dateFilterRow: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  dateFilterLabel: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontFamily: fontFamily.semibold,
  },
  dateFilterButton: {
    minWidth: 154,
    maxWidth: "72%",
    minHeight: 42,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.emeraldSoft,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  dateFilterButtonText: {
    flexShrink: 1,
    fontSize: fontSize.sm,
    color: colors.emerald,
    fontFamily: fontFamily.semibold,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    padding: spacing.xl,
  },
  dateMenu: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.md,
    ...shadow.card,
  },
  calendarSheet: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.md,
    ...shadow.card,
  },
  rangeSelectionRow: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: spacing.sm, marginBottom: spacing.sm },
  rangeSelectionButton: { flex: 1, borderRadius: 9, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.mist, paddingHorizontal: 10, paddingVertical: 8 },
  rangeSelectionButtonActive: { borderColor: colors.emerald, backgroundColor: colors.emeraldSoft },
  rangeSelectionLabel: { fontSize: 8, fontFamily: fontFamily.semibold, color: colors.textMuted },
  rangeSelectionValue: { fontSize: 10, fontFamily: fontFamily.medium, color: colors.ink, marginTop: 2 },
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
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  calendarDayIndicator: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    overflow: "hidden",
  },
  calendarDayInRange: { backgroundColor: colors.emeraldSoft },
  calendarDaySelected: { backgroundColor: colors.emerald, borderRadius: 20 },
  calendarDayText: {
    color: colors.textPrimary,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    lineHeight: 20,
    includeFontPadding: false,
    fontVariant: ["tabular-nums"],
    textAlign: "center",
    textAlignVertical: "center",
  },
  calendarDaySelectedText: { color: colors.white },
  calendarDisabledText: { color: colors.textMuted },
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
  dateMenuTitle: {
    fontSize: fontSize.md,
    color: colors.ink,
    fontFamily: fontFamily.bold,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  dateOption: {
    minHeight: 44,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dateOptionSelected: { backgroundColor: colors.emeraldSoft },
  dateOptionText: {
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    fontFamily: fontFamily.regular,
  },
  dateOptionTextSelected: {
    color: colors.emerald,
    fontFamily: fontFamily.semibold,
  },

  groupDate: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.textPrimary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },

  reportCard: {
    position: "relative",
    overflow: "hidden",
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 12,
    paddingLeft: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E7E9E6",
    ...shadow.subtle,
  },
  reportAccent: { position: "absolute", top: 0, bottom: 0, left: 0, width: 4, backgroundColor: colors.emerald },
  reportHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  cardIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.emeraldSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  reportHeadingText: { flex: 1, minWidth: 0 },
  reportModule: { fontSize: 8, fontFamily: fontFamily.semibold, color: colors.emerald, marginBottom: 2 },
  reportTitle: { fontSize: 13, lineHeight: 16, fontFamily: fontFamily.bold, color: colors.ink },
  reportStatusPill: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 6 },
  reportStatusPending: { backgroundColor: "#FCEBDD" },
  reportStatusApproved: { backgroundColor: "#DDF8EE" },
  reportStatusRejected: { backgroundColor: colors.errorSoft },
  reportStatusText: { fontSize: 9, fontFamily: fontFamily.semibold },
  reportStatusTextPending: { color: colors.error },
  reportStatusTextApproved: { color: colors.emerald },
  reportDetailBox: { backgroundColor: colors.mist, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, marginTop: 10 },
  reportTenant: { fontSize: 11, fontFamily: fontFamily.medium, color: colors.ink },
  reportChange: { fontSize: 9, fontFamily: fontFamily.regular, color: colors.textSecondary, marginTop: 2 },
  reportMeta: { fontSize: 8, fontFamily: fontFamily.regular, color: colors.textSecondary, marginTop: 6 },
});
