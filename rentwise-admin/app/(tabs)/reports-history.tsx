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
import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { House, HelpCircle, FileText, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Check } from "lucide-react-native";

import { auth } from "../../shared/services/auth";
import { db } from "../../shared/services/firestore";
import HelpTour, { HelpStep } from "../components/HelpTour";
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
};

type DateFilter = "today" | "last7" | "all" | `day:${string}`;

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
  const [dateFilter, setDateFilter] = useState<DateFilter>("today");
  const [dateMenuVisible, setDateMenuVisible] = useState(false);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [calendarMonth, setCalendarMonth] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [tourVisible, setTourVisible] = useState(false);
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
      const snap = await getDocs(
        query(collection(db, "updates"), where("changedBy", "==", uid)),
      );
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
        unsubscribeReports = onSnapshot(
          query(collection(db, "updates"), where("changedBy", "==", user.uid)),
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
    }, []),
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

  const selectedDayKey = dateFilter.startsWith("day:") ? dateFilter.slice(4) : null;
  const todayKey = localDateKey(new Date());
  const last7Start = dateFromOffset(6).getTime();
  const visibleReports = reports.filter((report) => {
    const timestamp = reportTimestamp(report);
    if (!timestamp) return dateFilter === "all";
    if (dateFilter === "all") return true;
    if (dateFilter === "last7") return timestamp >= last7Start;
    const reportKey = localDateKey(new Date(timestamp));
    return reportKey === (selectedDayKey ?? todayKey);
  });
  const groups = groupByDate(visibleReports);

  const dateOptions = [
    { value: "today" as DateFilter, label: "Today" },
    { value: "last7" as DateFilter, label: "Last 7 Days" },
    { value: "all" as DateFilter, label: "All Reports" },
  ];
  const selectedDateLabel = selectedDayKey
    ? new Date(`${selectedDayKey}T00:00:00`).toLocaleDateString("en-PH", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : dateOptions.find((option) => option.value === dateFilter)?.label ?? "Today";

  const openCalendar = () => {
    const startingDate = selectedDayKey ? new Date(`${selectedDayKey}T00:00:00`) : new Date();
    setCalendarDate(startingDate);
    setCalendarMonth(new Date(startingDate.getFullYear(), startingDate.getMonth(), 1));
    setDateMenuVisible(false);
    setCalendarVisible(true);
  };

  const applyCalendarDate = (date: Date) => {
    setCalendarDate(date);
    setDateFilter(`day:${localDateKey(date)}`);
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
  const weekAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const approvedThisWeekCount = reports.filter((r) => {
    if (statusLabel(r.approvalStatus) !== "Approved") return false;
    return reportTimestamp(r) >= weekAgoMs;
  }).length;

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
            <TouchableOpacity onPress={() => setTourVisible(true)} activeOpacity={0.7} style={styles.headerIconBtn}>
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

      <View style={styles.summaryRow} ref={summaryRef} collapsable={false}>
        <View style={[styles.summaryCard, styles.summaryCardPending]}>
          <Text style={styles.summaryLabelPending}>Pending</Text>
          <Text style={styles.summaryValuePending}>{pendingCount}</Text>
        </View>
        <View style={[styles.summaryCard, styles.summaryCardApproved]}>
          <Text style={styles.summaryLabelApproved}>Approved this week</Text>
          <Text style={styles.summaryValueApproved}>{approvedThisWeekCount}</Text>
        </View>
      </View>

      <View style={styles.dateFilterRow}>
        <Text style={styles.dateFilterLabel}>Showing</Text>
        <View ref={dateFilterRef} collapsable={false}>
          <TouchableOpacity
            style={styles.dateFilterButton}
            activeOpacity={0.75}
            onPress={() => setDateMenuVisible(true)}
          >
            <CalendarDays size={17} color={colors.emerald} />
            <Text style={styles.dateFilterButtonText} numberOfLines={1}>{selectedDateLabel}</Text>
            <ChevronDown size={16} color={colors.emerald} />
          </TouchableOpacity>
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
                    <Card style={styles.reportCard}>
                      <View style={styles.reportRow}>
                        <View style={styles.cardIcon}>
                          <FileText size={16} color={colors.emerald} />
                        </View>
                        <Text style={styles.reportTitle} numberOfLines={1}>
                          {reportTitle(r)}
                        </Text>
                        <Badge label={status} tone={statusTone(status)} />
                      </View>
                      <Text style={styles.reportDesc} numberOfLines={1}>
                        {reportDesc(r)}
                      </Text>
                    </Card>
                  </View>
                );
              })}
            </View>
          )}
        />
        </View>
      )}

      <Modal
        visible={dateMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDateMenuVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setDateMenuVisible(false)}>
          <Pressable style={styles.dateMenu} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.dateMenuTitle}>Select report date</Text>
            <TouchableOpacity
              style={styles.dateOption}
              activeOpacity={0.75}
              onPress={openCalendar}
            >
              <Text style={styles.dateOptionText}>Choose any date</Text>
              <CalendarDays size={18} color={colors.emerald} />
            </TouchableOpacity>
            {dateOptions.map((option) => {
              const selected = option.value === dateFilter;
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.dateOption, selected && styles.dateOptionSelected]}
                  activeOpacity={0.75}
                  onPress={() => {
                    setDateFilter(option.value);
                    setDateMenuVisible(false);
                  }}
                >
                  <Text style={[styles.dateOptionText, selected && styles.dateOptionTextSelected]}>
                    {option.label}
                  </Text>
                  {selected && <Check size={18} color={colors.emerald} />}
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={calendarVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCalendarVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setCalendarVisible(false)}>
          <Pressable style={styles.calendarSheet} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.dateMenuTitle}>Choose report date</Text>
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
            <View style={styles.calendarActions}>
              <TouchableOpacity onPress={() => setCalendarVisible(false)} style={styles.calendarCancelButton}>
                <Text style={styles.calendarCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => applyCalendarDate(calendarDate)} style={styles.calendarApplyButton}>
                <Text style={styles.calendarApplyText}>Show Reports</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <HelpTour visible={tourVisible} steps={tourSteps} onClose={() => setTourVisible(false)} />
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
    marginBottom: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reportRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
  },
  cardIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.emeraldSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  reportTitle: { flex: 1, fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.textPrimary },
  reportDesc: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginLeft: 34 + spacing.sm + 2,
    fontFamily: fontFamily.regular,
  },
});
