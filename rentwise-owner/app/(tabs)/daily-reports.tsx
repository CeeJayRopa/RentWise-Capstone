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
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, onSnapshot, orderBy, query, Timestamp, where } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Print from "expo-print";
import RNBlobUtil from "react-native-blob-util";

import { House, HelpCircle, Download, FileText, Archive, Wallet, CheckCircle2, Clock, ChevronLeft, ChevronRight, ChevronDown, Check, CalendarDays, FileDown, X } from "lucide-react-native";

import { auth } from "../../shared/services/auth";
import { db } from "../../shared/services/firestore";
import HelpTour, { HelpStep } from "../components/HelpTour";
import HelpSupportModal from "../components/HelpSupportModal";
import OwnerBellIcon from "../components/OwnerBellIcon";
import { hasSeenPageTour, markPageTourSeen } from "../../shared/services/onboardingTour";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";
import { readLocalCache, saveLocalCache } from "../../shared/services/localCache";
import {
  getSavedReceiptDirectory,
  requestReceiptDirectoryAccess,
  saveBase64PdfToReceiptDirectory,
} from "../../shared/services/receiptStorage";

async function confirmReportFolderAccess(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  if (await getSavedReceiptDirectory()) return true;

  const approved = await new Promise<boolean>((resolve) => {
    Alert.alert(
      "Allow report storage?",
      "RentWise needs access to a folder you choose so it can save report soft copies. RentWise can only access the folder you select.",
      [
        { text: "Not now", style: "cancel", onPress: () => resolve(false) },
        { text: "Choose folder", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });

  if (!approved) return false;
  return Boolean(await requestReceiptDirectoryAccess());
}

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
  paymentAmount?: number;
  amount?: number;
  payment?: number;
  paymentMethod?: string;
  approvalStatus?: string;
  reportCategory?: string;
  createdAt?: any;
  submittedAt?: any;
  approvedAt?: any;
  paidAt?: any;
};

function reportDateBounds(period: ReportPeriod, selected: Date, rangeStart: Date, rangeEnd: Date) {
  let start: Date;
  let end: Date;
  if (period === "Annual") {
    start = new Date(selected.getFullYear(), 0, 1);
    end = new Date(selected.getFullYear(), 11, 31, 23, 59, 59, 999);
  } else if (period === "Monthly") {
    start = new Date(selected.getFullYear(), selected.getMonth(), 1);
    end = new Date(selected.getFullYear(), selected.getMonth() + 1, 0, 23, 59, 59, 999);
  } else if (period === "Range") {
    start = new Date(rangeStart); start.setHours(0, 0, 0, 0);
    end = new Date(rangeEnd); end.setHours(23, 59, 59, 999);
  } else {
    start = new Date(selected); start.setHours(0, 0, 0, 0);
    end = new Date(selected); end.setHours(23, 59, 59, 999);
  }
  return {start, end};
}

type ReportPeriod = "Daily" | "Monthly" | "Annual" | "Range";
type ReportCategoryFilter = "all" | "building" | "finance" | "archive";

const REPORT_CATEGORY_FILTERS: {key: ReportCategoryFilter; label: string}[] = [
  {key: "all", label: "All"},
  {key: "building", label: "Stalls"},
  {key: "finance", label: "Financial"},
  {key: "archive", label: "Tenants"},
];

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

function statusLabel(r: ReportDoc): "Acknowledged" | "Pending" {
  const status = String(r.approvalStatus ?? r.status ?? "pending").toLowerCase();
  if (status === "approved" || status === "acknowledged") return "Acknowledged";
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
  const amount = resolveCategory(r) === "finance" ? reportAmount(r) : null;
  const amountText = amount == null ? "" : ` · ${formatPeso(amount)}`;
  if (r.spaceNo) return `Space ${r.spaceNo} · ${detailStr}${amountText}`;
  if (r.tenantName) return `${r.tenantName} · ${detailStr}${amountText}`;
  return `${detailStr}${amountText}`;
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

function formatDateTime(ts: any): string {
  if (!ts) return "Not available";
  const date: Date = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatReportTime(ts: any): string {
  if (!ts) return "Time unavailable";
  const date: Date = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return date.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function reportAmount(r: ReportDoc): number | null {
  const amount = r.paymentAmount ?? r.amount ?? r.payment;
  if (amount == null || !Number.isFinite(Number(amount))) return null;
  return Number(amount);
}

function formatPeso(amount: number): string {
  return `₱${amount.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function isInPeriod(r: ReportDoc, target: Date, period: ReportPeriod, rangeStart?: Date, rangeEnd?: Date): boolean {
  if (!r.createdAt) return false;
  const date: Date = r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt);
  if (period === "Range") {
    if (!rangeStart || !rangeEnd) return false;
    const key = localDateKey(date);
    return key >= localDateKey(rangeStart) && key <= localDateKey(rangeEnd);
  }
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
  const orderedCategories: Array<"finance" | "building" | "archive"> = ["finance", "building", "archive"];
  const categoryNames = { finance: "Financials", building: "Stall Management", archive: "Tenant Management" };
  const rows = orderedCategories.map((category) => {
    const categoryGroups = groups.map((group) => ({
      date: group.date,
      items: group.items.filter((item) => resolveCategory(item) === category),
    })).filter((group) => group.items.length > 0);
    if (categoryGroups.length === 0) return "";
    return `<section><h3>${categoryNames[category]}</h3>${categoryGroups
    .map(
      (g) => `
      <div class="group">
        <h4>${escapeHtml(g.date)}</h4>
        ${g.items.map((r) => {
          const amount = reportAmount(r);
          const transactionTime = r.paidAt ?? r.approvedAt ?? r.submittedAt ?? r.createdAt;
          return `<div class="item">
            <div class="item-head">
              <strong>${escapeHtml(displayCategory(r))}</strong>
              <span class="status ${statusLabel(r).toLowerCase()}">${statusLabel(r)}</span>
            </div>
            <div class="details">
              <div><span>Tenant</span><b>${escapeHtml(r.tenantName || "N/A")}</b></div>
              <div><span>Stall</span><b>${escapeHtml(r.spaceNo || "N/A")}</b></div>
              <div><span>Amount</span><b>${amount == null ? "N/A" : escapeHtml(formatPeso(amount))}</b></div>
              <div><span>Transaction</span><b>${escapeHtml(formatDateTime(transactionTime))}</b></div>
              <div><span>Method</span><b>${escapeHtml(r.paymentMethod || "N/A")}</b></div>
            </div>
            <p>${escapeHtml(reportDesc(r))}</p>
          </div>`;
        }).join("")}
      </div>`,
    )
    .join("")}</section>`;
  }).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
    <style>
      @page { size: 80mm 200mm; margin: 0; }
      * { box-sizing: border-box; }
      body { width: 80mm; margin: 0; padding: 8mm 6mm; font-family: Arial, sans-serif; color: #0B2B22; background: #FFFFFF; }
      h1 { color: #0E6B54; font-size: 18px; text-align: center; margin: 0 0 3px; }
      h2 { color: #5B6B63; font-size: 10px; font-weight: normal; text-align: center; margin: 2px 0; }
      h3 { color: #0E6B54; border-bottom: 1px dashed #CFCABC; padding-bottom: 5px; margin: 14px 0 7px; font-size: 11px; }
      h4 { color: #5B6B63; margin: 9px 0 5px; font-size: 9px; }
      section { margin-bottom: 12px; }
      .item { border: 1px solid #DCEFE7; border-radius: 7px; padding: 8px; margin-bottom: 8px; break-inside: avoid; page-break-inside: avoid; }
      .item-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; }
      .item-head strong { font-size: 11px; max-width: 70%; }
      .item p { font-size: 9px; color: #5B6B63; margin: 7px 0 0; padding-top: 6px; border-top: 1px solid #EEF3F0; line-height: 1.35; }
      .details { margin-top: 7px; }
      .details div { display: flex; justify-content: space-between; gap: 8px; margin: 3px 0; font-size: 9px; line-height: 1.35; }
      .details span { color: #5B6B63; flex: 0 0 35%; }
      .details b { color: #0B2B22; text-align: right; overflow-wrap: anywhere; }
      .status { flex-shrink: 0; font-size: 8px; font-weight: bold; text-transform: uppercase; }
      .acknowledged { color: #16835B; } .pending { color: #B7791F; }
    </style>
  </head><body>
    <h1>RentWise ${period} Report</h1>
    <h2>Ka Domeng Talipapa Wet and Dry Market</h2>
    <h2>${escapeHtml(periodLabel)}</h2>
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
  const [rangeStart, setRangeStart] = useState<Date>(new Date());
  const [rangeEnd, setRangeEnd] = useState<Date>(new Date());
  const [draftRangeStart, setDraftRangeStart] = useState<Date>(new Date());
  const [draftRangeEnd, setDraftRangeEnd] = useState<Date>(new Date());
  const [rangePicking, setRangePicking] = useState<"from" | "to">("from");
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>("Daily");
  const [reportCategory, setReportCategory] = useState<ReportCategoryFilter>("all");
  const [categoryMenuVisible, setCategoryMenuVisible] = useState(false);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [calendarDate, setCalendarDate] = useState<Date>(new Date());
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  // After the very first successful load, refocus-triggered refetches (e.g. coming back
  // from a report's detail screen) skip the loading spinner so the FlatList never unmounts
  // — unmounting is what was resetting the scroll position back to the top on every return.
  const hasLoadedOnceRef = useRef(false);
  const flatListRef = useRef<FlatList<ReportGroup>>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const [toastVisible, setToastVisible] = useState(false);
  const [tourVisible, setTourVisible] = useState(false);
  const [helpSupportVisible, setHelpSupportVisible] = useState(false);
  const homeRef = useRef<View>(null);
  const bellRef = useRef<View>(null);
  const datePillRef = useRef<View>(null);
  const downloadRef = useRef<View>(null);
  const listRef = useRef<View>(null);

  const tourSteps: HelpStep[] = [
    { key: "home", ref: homeRef, title: "Home", description: "Takes you back to the dashboard.", edgeInset: "top", round: true },
    { key: "bell", ref: bellRef, title: "Notifications", description: "Shows admin updates waiting for your review, like payments and building changes.", edgeInset: "top", round: true },
    { key: "date", ref: datePillRef, title: "Report period", description: "Choose Daily, Monthly, Annual, or a From–To date range to review.", edgeInset: "top" },
    { key: "download", ref: downloadRef, title: "Download Report", description: "Saves a PDF for the selected reporting period to your phone's Downloads folder.", edgeInset: "top" },
    { key: "list", ref: listRef, title: "Report list", description: "Shows admin updates grouped by date using only acknowledged and pending statuses.", edgeInset: "top", clipBottom: 90 },
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

  useEffect(() => {
    if (checking) return;
    if (!hasLoadedOnceRef.current) setLoading(true);
    const bounds = reportDateBounds(reportPeriod, selectedDate, rangeStart, rangeEnd);
    const reportsQuery = query(
      collection(db, "updates"),
      where("createdAt", ">=", Timestamp.fromDate(bounds.start)),
      where("createdAt", "<=", Timestamp.fromDate(bounds.end)),
      orderBy("createdAt", "desc"),
    );
    const cacheKey = `owner:reports:${reportPeriod}:${localDateKey(bounds.start)}:${localDateKey(bounds.end)}`;

    const unsubscribe = onSnapshot(
      reportsQuery,
      (snapshot) => {
        const docs = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() } as ReportDoc))
          .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        setReports(docs);
        setLoading(false);
        hasLoadedOnceRef.current = true;
        void saveLocalCache(cacheKey, docs);
      },
      (error) => {
        if (!auth.currentUser) return;
        console.error("REPORTS REALTIME ERROR:", error);
        void (async () => {
          const cached = await readLocalCache<ReportDoc[]>(cacheKey);
          if (cached) setReports(cached);
          setLoading(false);
          hasLoadedOnceRef.current = true;
        })();
      },
    );

    return unsubscribe;
  }, [checking, reportPeriod, selectedDate, rangeStart, rangeEnd]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const fetchData = async () => {
    if (!hasLoadedOnceRef.current) setLoading(true);
    try {
      const bounds = reportDateBounds(reportPeriod, selectedDate, rangeStart, rangeEnd);
      const cacheKey = `owner:reports:${reportPeriod}:${localDateKey(bounds.start)}:${localDateKey(bounds.end)}`;
      const snap = await getDocs(query(
        collection(db, "updates"),
        where("createdAt", ">=", Timestamp.fromDate(bounds.start)),
        where("createdAt", "<=", Timestamp.fromDate(bounds.end)),
        orderBy("createdAt", "desc"),
      ));
      const docs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as ReportDoc))
        .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      setReports(docs);
      await saveLocalCache(cacheKey, docs);
    } catch (err) {
      console.error("DAILY REPORTS ERROR:", err);
      const bounds = reportDateBounds(reportPeriod, selectedDate, rangeStart, rangeEnd);
      const cacheKey = `owner:reports:${reportPeriod}:${localDateKey(bounds.start)}:${localDateKey(bounds.end)}`;
      const cached = await readLocalCache<ReportDoc[]>(cacheKey);
      if (cached) setReports(cached);
    } finally {
      setLoading(false);
      hasLoadedOnceRef.current = true;
    }
  };

  const openCalendar = () => {
    setDraftRangeStart(rangeStart);
    setDraftRangeEnd(rangeEnd);
    setRangePicking("from");
    setCalendarDate(selectedDate);
    const referenceDate = reportPeriod === "Range" ? rangeStart : selectedDate;
    setCalendarMonth(new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1));
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
    if (reportPeriod === "Range") {
      if (draftRangeStart > draftRangeEnd) {
        Alert.alert("Invalid date range", "The From date must be on or before the To date.");
        return;
      }
      setRangeStart(draftRangeStart);
      setRangeEnd(draftRangeEnd);
      setCalendarVisible(false);
      return;
    }
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
    try {
      const filtered = reports.filter((r) =>
        isInPeriod(r, selectedDate, reportPeriod, rangeStart, rangeEnd) &&
        (reportCategory === "all" || resolveCategory(r) === reportCategory),
      );
      if (filtered.length === 0) {
        Alert.alert("No Reports", `No reports found for the selected ${reportPeriod.toLowerCase()} period.`);
        return;
      }

      if (!(await confirmReportFolderAccess())) return;

      const groups = groupByDate(filtered);
      const periodLabel = reportPeriod === "Annual"
        ? String(selectedDate.getFullYear())
        : reportPeriod === "Monthly"
          ? selectedDate.toLocaleDateString("en-PH", { month: "long", year: "numeric" })
          : reportPeriod === "Range"
            ? `${formatDate({ toDate: () => rangeStart })} to ${formatDate({ toDate: () => rangeEnd })}`
            : formatDate({ toDate: () => selectedDate });
      const html = buildHtml(groups, reportPeriod, periodLabel);
      const { base64 } = await Print.printToFileAsync({
        html,
        base64: true,
        width: 227,
        height: 567,
        textZoom: 100,
      });

      const pad = (n: number) => String(n).padStart(2, "0");
      const periodKey = reportPeriod === "Annual"
        ? `${selectedDate.getFullYear()}`
        : reportPeriod === "Monthly"
          ? `${selectedDate.getFullYear()}-${pad(selectedDate.getMonth() + 1)}`
          : reportPeriod === "Range"
            ? `${localDateKey(rangeStart)}-to-${localDateKey(rangeEnd)}`
            : `${selectedDate.getFullYear()}-${pad(selectedDate.getMonth() + 1)}-${pad(selectedDate.getDate())}`;
      const categoryKey = reportCategory === "all" ? "all" : reportCategory;
      const fileName = `${reportPeriod.toLowerCase()}-${categoryKey}-reports-${periodKey}.pdf`;
      if (Platform.OS === "android") {
        const saved = await saveBase64PdfToReceiptDirectory(base64!, fileName);
        if (!saved) {
          Alert.alert("Folder needed", "Choose a folder to save your report.");
          return;
        }
        showToast();
        return;
      }

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
      setDownloading(false);
    }
  };

  if (checking) {
    return <View style={styles.fullCenter}><ActivityIndicator color={colors.emerald} size="large" /></View>;
  }

  const visibleReports = reports.filter((r) =>
    isInPeriod(r, selectedDate, reportPeriod, rangeStart, rangeEnd) &&
    (reportCategory === "all" || resolveCategory(r) === reportCategory),
  );
  const groups = groupByDate(visibleReports);
  const acknowledgedCount = visibleReports.filter((r) => statusLabel(r) === "Acknowledged").length;
  const pendingCount = visibleReports.filter((r) => statusLabel(r) === "Pending").length;
  const selectedPeriodLabel = reportPeriod === "Annual"
    ? String(selectedDate.getFullYear())
    : reportPeriod === "Monthly"
      ? selectedDate.toLocaleDateString("en-PH", { month: "short", year: "numeric" })
      : reportPeriod === "Range"
        ? `${rangeStart.toLocaleDateString("en-PH", { month: "short", day: "numeric" })} – ${rangeEnd.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}`
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
            <TouchableOpacity onPress={() => setHelpSupportVisible(true)} activeOpacity={0.7} style={styles.headerIconBtn}>
              <HelpCircle size={24} color={colors.emeraldSoft} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Sub-header */}
        <View style={styles.subHeader}>
          <Text style={styles.pageTitle}>Reports</Text>
        </View>
      </LinearGradient>

      <View style={styles.periodSection} ref={datePillRef} collapsable={false}>
        <View style={styles.periodTabs}>
          {(["Daily", "Monthly", "Annual", "Range"] as ReportPeriod[]).map((period) => (
            <TouchableOpacity
              key={period}
              style={[styles.periodTab, reportPeriod === period && styles.periodTabActive]}
              onPress={() => setReportPeriod(period)}
              activeOpacity={0.8}
            >
              {reportPeriod === period && <CalendarDays size={14} color={colors.emerald} />}
              <Text style={[styles.periodTabText, reportPeriod === period && styles.periodTabTextActive]}>{period}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.filterToolbarLayer}>
          <View style={styles.filterToolbar}>
            <TouchableOpacity style={styles.categoryPicker} onPress={() => setCategoryMenuVisible((visible) => !visible)} activeOpacity={0.8}>
              <Text style={styles.categoryPickerText}>{REPORT_CATEGORY_FILTERS.find((item) => item.key === reportCategory)?.label}</Text>
              <ChevronDown size={15} color={colors.emerald} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.datePill} onPress={openCalendar} activeOpacity={0.7}>
              <CalendarDays size={13} color={colors.emerald} />
              <Text style={styles.datePillText}>{selectedPeriodLabel}</Text>
              <ChevronDown size={13} color={colors.emerald} />
            </TouchableOpacity>
          </View>
          {categoryMenuVisible && <View style={styles.categoryMenu}>
            {REPORT_CATEGORY_FILTERS.map(({key, label}) => <TouchableOpacity key={key} style={[styles.categoryMenuItem, reportCategory === key && styles.categoryMenuItemActive]} onPress={() => { setReportCategory(key); setCategoryMenuVisible(false); }} activeOpacity={0.8}>
              <Text style={[styles.categoryMenuItemText, reportCategory === key && styles.categoryMenuItemTextActive]}>{label}</Text>
              {reportCategory === key && <Check size={15} color={colors.emerald} />}
            </TouchableOpacity>)}
          </View>}
        </View>
        <View style={styles.auditSummaryCard}>
          <View style={styles.auditSummaryHeader}>
            <Text style={styles.auditSummaryTitle}>{reportPeriod.toUpperCase()} · {REPORT_CATEGORY_FILTERS.find((item) => item.key === reportCategory)?.label.toUpperCase()} AUDIT DISPOSITION</Text>
          </View>
          <View style={styles.auditMetricsRow}>
            <View style={styles.auditMetric}>
              <View style={styles.auditMetricValueRow}>
                <Text style={styles.auditMetricValue}>{String(acknowledgedCount).padStart(2, "0")}</Text>
                <CheckCircle2 size={17} color={colors.success} />
              </View>
              <Text style={styles.auditMetricLabel}>Acknowledged</Text>
            </View>
            <View style={styles.auditMetricDivider} />
            <View style={styles.auditMetric}>
              <View style={styles.auditMetricValueRow}>
                <Text style={styles.auditMetricValue}>{String(pendingCount).padStart(2, "0")}</Text>
                <Clock size={17} color={colors.error} />
              </View>
              <Text style={[styles.auditMetricLabel, styles.pendingMetricLabel]}>Pending Review</Text>
            </View>
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
              <View style={styles.downloadBtnContent}>
                <View style={styles.downloadFileIcon}><FileDown size={18} color={colors.emerald} /></View>
                <View style={styles.downloadCopy}>
                  <Text style={[styles.downloadBtnText, pressed && styles.downloadBtnTextPressed]}>Download Report</Text>
                </View>
                <View style={styles.downloadIconCircle}><Download size={17} color={colors.emeraldSoft} /></View>
              </View>
            )
          }
        </Pressable>
      </View>

      <View style={{ flex: 1 }} ref={listRef} collapsable={false}>
      {loading ? (
        <ActivityIndicator color={colors.emerald} size="large" style={styles.loader} />
      ) : visibleReports.length === 0 ? (
        <FlatList
          data={[]}
          renderItem={() => null}
          contentContainerStyle={styles.emptyListContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />}
          ListEmptyComponent={<View style={styles.emptyBox}>
          <View style={styles.emptyIllustration}><FileText size={46} color={colors.emerald} /></View>
          <Text style={styles.emptyTitle}>No reports for this period</Text>
          <Text style={styles.emptyText}>Administrative filings for {selectedPeriodLabel} will appear here in chronological order.</Text>
          <View style={styles.emptyRefreshPill}>
            <Download size={13} color={colors.emerald} />
            <Text style={styles.emptyRefreshText}>{refreshing ? "Syncing reports…" : "Pull down to reload reports"}</Text>
          </View>
        </View>}
        />
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
                <CalendarDays size={14} color={colors.ink} />
                <Text style={styles.groupDate}>{group.date.toUpperCase()}</Text>
                <Text style={styles.groupCount}>{group.items.length} {group.items.length === 1 ? "entry" : "entries"}</Text>
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
                    <View style={styles.reportCardTop}>
                      <View style={styles.cardIcon}><CategoryIcon size={17} color={colors.emerald} /></View>
                      <View style={styles.cardText}>
                        <Text style={styles.reportEyebrow}>{displayCategory(r).toUpperCase()}</Text>
                        <Text style={styles.reportTitle} numberOfLines={2} ellipsizeMode="tail">{reportDesc(r)}</Text>
                      </View>
                      <View style={[styles.tagPill, statusLabel(r) === "Acknowledged" ? styles.tagApproved : styles.tagPending]}>
                        {statusLabel(r) === "Acknowledged" ? <CheckCircle2 size={11} color={colors.success} /> : <Clock size={11} color={colors.error} />}
                        <Text style={[styles.tagPillText, statusLabel(r) === "Acknowledged" ? styles.tagApprovedText : styles.tagPendingText]} numberOfLines={1}>{statusLabel(r)}</Text>
                      </View>
                    </View>
                    <View style={styles.reportDataPanel}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.reportDataMain} numberOfLines={2}>{r.tenantName || r.change || r.type || "Administrative update"}</Text>
                        <Text style={styles.reportMeta} numberOfLines={1}>Ref #{r.id.slice(-6).toUpperCase()}  •  {formatReportTime(r.createdAt)}  •  Admin</Text>
                      </View>
                      {!!r.paymentMethod && <Text style={styles.reportMethod}>{r.paymentMethod}</Text>}
                    </View>
                    <View style={styles.reportCardFooter}>
                      <Text style={styles.reportFooterLink}>{resolveCategory(r) === "finance" ? "View Full Voucher" : "View Full Record"} ›</Text>
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
            <View style={styles.calendarTitleRow}>
              <Text style={styles.dateMenuTitle}>
                {reportPeriod === "Annual" ? "Choose Report Year" : reportPeriod === "Monthly" ? "Choose Report Month" : reportPeriod === "Range" ? "Choose Date Range" : "Choose Report Date"}
              </Text>
              <TouchableOpacity style={styles.calendarCloseButton} onPress={() => setCalendarVisible(false)}><X size={19} color={colors.ink} /></TouchableOpacity>
            </View>
            {reportPeriod === "Range" && (
              <View style={styles.rangeQuickRow}>
                {[
                  { label: "Today", days: 0 },
                  { label: "Last 7D", days: 6 },
                  { label: "Last 30D", days: 29 },
                ].map((preset) => (
                  <TouchableOpacity key={preset.label} style={styles.rangeQuickButton} onPress={() => {
                    const end = new Date();
                    const start = new Date();
                    start.setDate(start.getDate() - preset.days);
                    setDraftRangeStart(start); setDraftRangeEnd(end); setCalendarMonth(new Date(end.getFullYear(), end.getMonth(), 1));
                  }}><Text style={styles.rangeQuickText}>{preset.label}</Text></TouchableOpacity>
                ))}
                <TouchableOpacity style={[styles.rangeQuickButton, styles.rangeQuickButtonActive]} onPress={() => {
                  const end = new Date();
                  const start = new Date(end.getFullYear(), end.getMonth(), 1);
                  setDraftRangeStart(start); setDraftRangeEnd(end); setCalendarMonth(start);
                }}><Text style={styles.rangeQuickTextActive}>✓ This Month</Text></TouchableOpacity>
              </View>
            )}
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
                {reportPeriod === "Range" && (
                  <View style={styles.rangeSelectionRow}>
                    <TouchableOpacity style={[styles.rangeSelectionButton, rangePicking === "from" && styles.rangeSelectionButtonActive]} onPress={() => setRangePicking("from")}>
                      <Text style={styles.rangeSelectionLabel}>From</Text>
                      <Text style={styles.rangeSelectionValue}>{formatDate({ toDate: () => draftRangeStart })}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.rangeSelectionButton, rangePicking === "to" && styles.rangeSelectionButtonActive]} onPress={() => setRangePicking("to")}>
                      <Text style={styles.rangeSelectionLabel}>To</Text>
                      <Text style={styles.rangeSelectionValue}>{formatDate({ toDate: () => draftRangeEnd })}</Text>
                    </TouchableOpacity>
                  </View>
                )}
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
                    return (
                      <TouchableOpacity
                        key={`${displayedYear}-${displayedMonth}-${day}`}
                        style={styles.calendarDayCell}
                        disabled={disabled}
                        onPress={() => {
                          if (reportPeriod === "Range") {
                            if (rangePicking === "from") {
                              setDraftRangeStart(cellDate);
                              if (cellDate > draftRangeEnd) setDraftRangeEnd(cellDate);
                              setRangePicking("to");
                            } else {
                              setDraftRangeEnd(cellDate);
                            }
                          } else {
                            setCalendarDate(cellDate);
                          }
                        }}
                      >
                        <View style={[styles.calendarDayCircle, selected && styles.calendarDaySelected]}>
                          <Text style={[
                            styles.calendarDayText,
                            disabled && styles.calendarDisabledText,
                            selected && styles.calendarDaySelectedText,
                          ]}>{day}</Text>
                        </View>
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
      <HelpSupportModal visible={helpSupportVisible} steps={tourSteps} onClose={() => setHelpSupportVisible(false)} onReplayTour={() => setTourVisible(true)} />

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
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  downloadBtn: {
    backgroundColor: colors.ink,
    borderRadius: 12,
    padding: 0,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.button,
  },
  downloadBtnDisabled: { opacity: 0.4 },
  downloadBtnPressed: { backgroundColor: colors.white },
  downloadBtnContent: { width: "100%", height: 46, flexDirection: "row", alignItems: "center", paddingHorizontal: 9, gap: 8 },
  downloadFileIcon: { width: 30, height: 30, borderRadius: 7, backgroundColor: "#91F0D0", alignItems: "center", justifyContent: "center" },
  downloadCopy: { flex: 1 },
  downloadBtnText: { fontSize: 12, fontFamily: fontFamily.bold, color: colors.white },
  downloadIconCircle: { width: 29, height: 29, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.10)", borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  downloadBtnTextPressed: { color: colors.emerald },

  subHeader: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  subHeaderActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  reloadButton: {
    width: 31,
    height: 31,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  pageTitle: { fontSize: fontSize.md, fontFamily: fontFamily.semibold, color: colors.white },
  datePill: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.mist,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  datePillText: { fontSize: fontSize.xs + 1, fontFamily: fontFamily.semibold, color: colors.emerald },

  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    padding: spacing.xl,
  },
  calendarSheet: {
    backgroundColor: colors.white,
    borderRadius: 18,
    padding: 14,
    ...shadow.card,
  },
  calendarTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  calendarCloseButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  dateMenuTitle: {
    flex: 1,
    fontSize: 18,
    color: colors.ink,
    fontFamily: fontFamily.bold,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rangeQuickRow: { flexDirection: "row", gap: 7, marginVertical: 10 },
  rangeQuickButton: { flex: 1, minHeight: 34, borderRadius: radius.pill, backgroundColor: colors.mist, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  rangeQuickButtonActive: { flex: 1.35, backgroundColor: colors.ink },
  rangeQuickText: { fontSize: 10, color: colors.textSecondary, fontFamily: fontFamily.semibold },
  rangeQuickTextActive: { fontSize: 10, color: colors.white, fontFamily: fontFamily.semibold },
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
  calendarDayCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  calendarDaySelected: { backgroundColor: colors.emerald, borderRadius: 20 },
  rangeSelectionRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  rangeSelectionButton: { flex: 1, minHeight: 64, padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.white },
  rangeSelectionButtonActive: { borderColor: colors.emerald, backgroundColor: colors.white },
  rangeSelectionLabel: { color: colors.textSecondary, fontFamily: fontFamily.medium, fontSize: fontSize.xs },
  rangeSelectionValue: { color: colors.ink, fontFamily: fontFamily.semibold, fontSize: fontSize.xs },
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
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  calendarCancelButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 10,
    backgroundColor: colors.mist,
    alignItems: "center",
    justifyContent: "center",
  },
  calendarCancelText: {
    color: colors.textSecondary,
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.sm,
  },
  calendarApplyButton: {
    flex: 1,
    minHeight: 48,
    backgroundColor: colors.ink,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
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
    borderRadius: 11,
    padding: 3,
  },
  periodTab: {
    flex: 1,
    flexDirection: "row",
    gap: 5,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    paddingVertical: 7,
  },
  periodTabActive: { backgroundColor: colors.white, ...shadow.card },
  periodTabText: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.textSecondary },
  periodTabTextActive: { color: colors.emerald, fontFamily: fontFamily.bold },
  filterToolbarLayer: { position: "relative", zIndex: 20, elevation: 20 },
  filterToolbar: { marginTop: 9, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  categoryPicker: { minWidth: 118, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: spacing.md, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, ...shadow.card },
  categoryPickerText: { fontSize: 11, fontFamily: fontFamily.semibold, color: colors.ink },
  categoryMenu: { position: "absolute", top: 51, left: 0, width: 170, zIndex: 30, elevation: 30, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, padding: 5, ...shadow.card },
  categoryMenuItem: { minHeight: 36, paddingHorizontal: 10, borderRadius: 7, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  categoryMenuItemActive: { backgroundColor: colors.mist },
  categoryMenuItemText: { fontSize: 11, fontFamily: fontFamily.medium, color: colors.textSecondary },
  categoryMenuItemTextActive: { color: colors.emerald, fontFamily: fontFamily.bold },
  auditSummaryCard: { backgroundColor: colors.white, borderRadius: 12, marginTop: 11, padding: 12, ...shadow.card },
  auditSummaryHeader: { flexDirection: "row", alignItems: "center", marginBottom: 7 },
  auditSummaryTitle: { fontSize: 9, fontFamily: fontFamily.semibold, color: colors.ink, letterSpacing: 0.35 },
  auditMetricsRow: { flexDirection: "row", alignItems: "center" },
  auditMetric: { flex: 1, alignItems: "center" },
  auditMetricDivider: { height: 36, width: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  auditMetricValueRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  auditMetricValue: { fontSize: 25, lineHeight: 29, fontFamily: fontFamily.extrabold, color: colors.ink },
  auditMetricLabel: { fontSize: 10, fontFamily: fontFamily.semibold, color: colors.ink },
  pendingMetricLabel: { color: colors.error },
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
  statusApprovedText: { flexShrink: 1, fontSize: fontSize.xs - 1, fontFamily: fontFamily.bold, color: colors.success },
  statusPendingText: { flexShrink: 1, fontSize: fontSize.xs - 1, fontFamily: fontFamily.bold, color: colors.warning },

  loader: { marginTop: 60 },

  emptyBox: { flex: 1, alignItems: "center", justifyContent: "center", margin: spacing.lg, marginTop: 14, paddingHorizontal: 30, backgroundColor: colors.white, borderRadius: 12 },
  emptyListContent: { flexGrow: 1 },
  emptyIllustration: { width: 92, height: 92, borderRadius: 46, backgroundColor: colors.emeraldSoft, alignItems: "center", justifyContent: "center", marginBottom: 20 },
  emptyTitle: { fontSize: 18, color: colors.ink, fontFamily: fontFamily.bold, textAlign: "center" },
  emptyText: { fontSize: 12, lineHeight: 20, color: colors.textSecondary, fontFamily: fontFamily.regular, textAlign: "center", marginTop: 10 },
  emptyRefreshPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.mist, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7, marginTop: 18 },
  emptyRefreshText: { fontSize: 10, color: colors.emerald, fontFamily: fontFamily.semibold },

  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },

  groupDateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  groupDate: {
    flex: 1,
    fontSize: 10,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
    letterSpacing: 0.3,
  },
  groupCount: { fontSize: 9, color: colors.ink, fontFamily: fontFamily.medium },

  reportCard: {
    backgroundColor: colors.white,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: colors.emerald,
    padding: 11,
    marginBottom: 10,
    ...shadow.card,
  },
  reportCardTop: { flexDirection: "row", alignItems: "center", gap: 9 },
  cardIcon: {
    width: 31,
    height: 31,
    borderRadius: 7,
    backgroundColor: colors.emeraldSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  cardText: { flex: 1 },
  reportEyebrow: { fontSize: 8, fontFamily: fontFamily.bold, color: colors.emerald, letterSpacing: 0.35 },
  reportTitle: { fontSize: 13, lineHeight: 16, fontFamily: fontFamily.bold, color: colors.ink, marginTop: 2 },
  reportDataPanel: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: colors.mist, borderRadius: 7, padding: 9, marginTop: 10 },
  reportDataMain: { fontSize: 11, lineHeight: 15, color: colors.ink, fontFamily: fontFamily.medium },
  reportMeta: { fontSize: 8, color: colors.ink, fontFamily: fontFamily.regular, marginTop: 5 },
  reportMethod: { fontSize: 9, lineHeight: 13, color: colors.emerald, fontFamily: fontFamily.bold, textAlign: "right", maxWidth: 62 },
  reportCardFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 9 },
  reportFooterLink: { marginLeft: "auto", fontSize: 9, color: colors.emerald, fontFamily: fontFamily.semibold },

  tagPill: {
    backgroundColor: colors.successSoft,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: 100,
  },
  tagPillText: {
    fontSize: fontSize.xs - 1,
    fontFamily: fontFamily.bold,
    color: colors.emerald,
  },
  tagApproved: { backgroundColor: colors.successSoft },
  tagPending: { backgroundColor: colors.warningSoft },
  tagApprovedText: { color: colors.success },
  tagPendingText: { color: colors.error },

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
