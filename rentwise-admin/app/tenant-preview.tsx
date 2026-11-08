import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Modal,
  Image,
  Alert,
  RefreshControl,
  Animated,
  Easing,
  Platform,
} from "react-native";
import * as Print from "expo-print";
import RNBlobUtil from "react-native-blob-util";
import { LinearGradient } from "expo-linear-gradient";

import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams, router } from "expo-router";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";

import { db } from "../shared/services/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, Bell, FileText, TrendingUp, CalendarClock, HelpCircle, ChevronUp, ChevronDown, ChevronRight, Banknote, X, BadgeCheck, Download, Calculator } from "lucide-react-native";
import { Card, Badge, Avatar } from "../shared/components/ui";
import HelpTour, { HelpStep } from "./components/HelpTour";
import HelpSupportModal from "./components/HelpSupportModal";
import { hasSeenPageTour, markPageTourSeen } from "../shared/services/onboardingTour";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../shared/theme";
import { rentalCycleProgress } from "../shared/services/financeServices";
import {
  getSavedReceiptDirectory,
  requestReceiptDirectoryAccess,
  saveBase64PdfToReceiptDirectory,
} from "../shared/services/receiptStorage";

async function confirmReceiptFolderAccess(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  if (await getSavedReceiptDirectory()) return true;

  const approved = await new Promise<boolean>((resolve) => {
    Alert.alert(
      "Allow receipt storage?",
      "RentWise needs access to a folder you choose so it can save receipt soft copies. RentWise can only access the folder you select.",
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

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// The admin always enters the stall's DAILY rate. Every schedule's period
// charge is derived by multiplying that daily rate by however many days
// fall in the period containing `date`. Mirrors financials.tsx exactly.
function scheduleIntervalDays(schedule: string): number {
  if (schedule === "daily") return 1;
  if (schedule === "weekly") return 7;
  if (schedule === "semi-monthly") return 15;
  return 30;
}

function scheduleDayLabel(schedule: string): string {
  const days = scheduleIntervalDays(schedule);
  if (days === 1) return "Daily";
  return `${days} days`;
}

function computePeriodCharge(dailyRate: number, schedule: string, date: Date): number {
  return dailyRate * scheduleIntervalDays(schedule);
}

// Advances `d` to the start of the next billing period for `schedule`.
function nextPeriodStart(schedule: string, d: Date): Date {
  const n = new Date(d);
  if (schedule === "daily") {
    n.setDate(n.getDate() + 1);
    return n;
  }
  if (schedule === "weekly") {
    n.setDate(n.getDate() + 7);
    return n;
  }
  if (schedule === "semi-monthly") {
    if (n.getDate() <= 15) {
      n.setDate(16);
      return n;
    }
    return new Date(n.getFullYear(), n.getMonth() + 1, 1);
  }
  return new Date(n.getFullYear(), n.getMonth() + 1, 1); // monthly
}

// Sums each billing period's charge for every period from day 1 of the
// month through today's period, inclusive — a period counts in full the
// moment it starts (not prorated by day), and the trailing period is capped
// at the month's last day so the total never overshoots the month's full
// charge (dailyRate × daysInMonth). Mirrors rentwise-tenant/app/dashboard.tsx.
function chargedSinceMonthStart(dailyRate: number, schedule: string, today: Date): number {
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEndExclusive = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  let total = 0;
  let cursor = monthStart;
  let guard = 0;
  while (cursor <= today && guard < 31) {
    const periodEnd = nextPeriodStart(schedule, cursor);
    const cappedEnd = periodEnd < monthEndExclusive ? periodEnd : monthEndExclusive;
    const daysInChunk = Math.round((cappedEnd.getTime() - cursor.getTime()) / 86400000);
    total += dailyRate * daysInChunk;
    cursor = periodEnd;
    guard++;
  }
  return total;
}

// Steps `d` back to the start of the previous billing period for `schedule`
// — the inverse of nextPeriodStart. Mirrors billingSchedule.ts exactly.
function previousPeriodStart(schedule: string, d: Date): Date {
  const n = new Date(d);
  if (schedule === "daily") {
    n.setDate(n.getDate() - 1);
    return n;
  }
  if (schedule === "weekly") {
    n.setDate(n.getDate() - 7);
    return n;
  }
  if (schedule === "semi-monthly") {
    if (n.getDate() > 15) {
      n.setDate(1);
      return n;
    }
    n.setMonth(n.getMonth() - 1);
    const daysInPrevMonth = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
    n.setDate(Math.min(16, daysInPrevMonth));
    return n;
  }
  n.setMonth(n.getMonth() - 1);
  n.setDate(1);
  return n;
}

// Returns the `count` consecutive billing periods ending with the one
// containing `endDate` (oldest first), each paired with that period's
// charge. Mirrors billingSchedule.ts's consecutivePeriodsEnding exactly.
function consecutivePeriodsEnding(
  dailyRate: number,
  schedule: string,
  endDate: Date,
  count: number,
): { date: Date; amount: number }[] {
  const periods: { date: Date; amount: number }[] = [];
  let cursor = new Date(endDate);
  for (let i = 0; i < Math.max(count, 0); i++) {
    periods.push({ date: new Date(cursor), amount: computePeriodCharge(dailyRate, schedule, cursor) });
    cursor = previousPeriodStart(schedule, cursor);
  }
  return periods.reverse();
}

// Human-readable label for a single billing period's start date. Mirrors
// billingSchedule.ts's periodLabel exactly.
function periodLabel(schedule: string, date: Date): string {
  return `${scheduleDayLabel(schedule)} rent from ${date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
}

// Older receipts (and admin-recorded cash payments) never stored a
// `breakdown` array — only the lump `rentAmount`. Reconstructs the same
// itemized, date-listed breakdown by working out how many consecutive
// periods that lump sum represents. Mirrors ReceiptCardContent.tsx exactly.
function synthesizeBreakdown(data: any, tenant: any): { label: string; amount: number }[] {
  const schedule = tenant?.paymentSchedule;
  const dailyRate = Number(tenant?.price || 0);
  const totalPaid = getReceiptAmountPaid(data);
  const stored = Array.isArray(data?.breakdown) ? data.breakdown.filter((line: any) =>
    line && typeof line.label === "string" && Number.isFinite(Number(line.amount)) && Number(line.amount) >= 0,
  ).map((line: any) => ({label: line.label, amount: Number(line.amount)})) : [];
  const storedTotal = stored.reduce((sum: number, line: any) => sum + line.amount, 0);
  if (stored.length > 0 && Math.abs(storedTotal - totalPaid) < 0.01) return stored;
  if (!schedule || dailyRate <= 0 || totalPaid <= 0) return stored;

  const receiptDate = data.date ? new Date(data.date) : new Date();
  const onePeriodCharge = computePeriodCharge(dailyRate, schedule, receiptDate);
  if (onePeriodCharge <= 0) return [];

  const storedPeriods = Number(data?.periodsCovered ?? 0);
  const periodsCount = storedPeriods > 0
    ? Math.max(1, Math.round(storedPeriods))
    : Math.max(1, Math.round(totalPaid / onePeriodCharge));
  if (Math.abs(periodsCount * onePeriodCharge - totalPaid) >= 0.01) {
    return stored.length > 0
      ? [...stored, {label: "Additional rent coverage", amount: Math.max(0, totalPaid - storedTotal)}]
      : [{label: "Rent coverage", amount: totalPaid}];
  }
  return consecutivePeriodsEnding(dailyRate, schedule, receiptDate, periodsCount).map((p) => ({
    label: periodLabel(schedule, p.date),
    amount: p.amount,
  }));
}

function getReceiptAmountPaid(data: any): number {
  const numeric = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : null;
  };
  const change = Math.max(0, numeric(data?.change) ?? 0);
  const tendered = numeric(data?.cashTendered ?? data?.cashReceived);
  if (tendered !== null) return Math.max(0, numeric(data?.amountPaid) ?? tendered - change);

  const payment = numeric(data?.payment);
  if (change > 0 && payment !== null && payment > change) return Math.max(0, payment - change);
  // `rentAmount` is one schedule-period charge on current online receipts;
  // `payment`/`amount` is the full submitted transaction (possibly several
  // periods). Never let the period rate replace the actual receipt total.
  return Math.max(0, numeric(data?.amountPaid ?? data?.amount) ?? payment ?? numeric(data?.rentAmount) ?? 0);
}

export default function TenantPreview() {
  const insets = useSafeAreaInsets();

  const { tenantId } = useLocalSearchParams<{
    tenantId: string;
  }>();

  const [tenant, setTenant] = useState<any>(null);
  const [stall, setStall] = useState<any>(null);
  const [assignedReceiptStalls, setAssignedReceiptStalls] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [generatingReceipt, setGeneratingReceipt] = useState(false);
  const [imageViewerUrl, setImageViewerUrl] = useState<string | null>(null);
  const [digitalReceipt, setDigitalReceipt] = useState<any>(null);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [showAllPayments, setShowAllPayments] = useState(false);

  const [tourVisible, setTourVisible] = useState(false);
  const [helpSupportVisible, setHelpSupportVisible] = useState(false);
  const helpRef = useRef<View>(null);
  const notifyRef = useRef<View>(null);
  const paymentCardRef = useRef<View>(null);
  const historyCardRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Scrolls a given section into view and gives the ScrollView time to
  // settle before HelpTour measures it — otherwise a section below the
  // fold would measure to its stale, off-screen position, and its
  // spotlight would bleed past the visible screen edge.
  const scrollSectionIntoView = (targetRef: React.RefObject<View | null>) =>
    new Promise<void>((resolve) => {
      const scrollNode = scrollRef.current?.getNativeScrollRef?.();
      if (!scrollNode || !targetRef.current) { resolve(); return; }
      targetRef.current.measureLayout(
        scrollNode as any,
        (_x: number, y: number) => {
          scrollRef.current?.scrollTo({ y: Math.max(0, y - 100), animated: true });
          setTimeout(resolve, 400);
        },
        () => resolve(),
      );
    });

  useEffect(() => {
    loadTenant();
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    const paymentsQuery = query(
      collection(db, "payments"),
      where("userId", "==", tenantId),
    );

    return onSnapshot(
      paymentsQuery,
      (snapshot) => {
        const list = snapshot.docs.map((paymentDoc) => ({
          id: paymentDoc.id,
          ...paymentDoc.data(),
        }));
        list.sort((a: any, b: any) => {
          const aMs = a.date?.toMillis ? a.date.toMillis() : 0;
          const bMs = b.date?.toMillis ? b.date.toMillis() : 0;
          return bMs - aMs;
        });
        setPayments(list);
      },
      (error) => console.log("TENANT PAYMENT HISTORY LISTENER ERROR:", error),
    );
  }, [tenantId]);

  useEffect(() => {
    setShowAllPayments(false);
  }, [tenantId]);

  // Collapse the Breakdown dropdown again each time a different receipt is
  // opened, so it doesn't stay expanded from whatever the last one left it at.
  useEffect(() => {
    setBreakdownOpen(false);
  }, [digitalReceipt]);

  // Auto-opens the guided tour the first time the admin ever lands on this
  // page — never again after that, since it flips a persisted per-device
  // flag. Can still be replayed anytime via the Help button.
  useEffect(() => {
    if (loading) return;
    (async () => {
      const seen = await hasSeenPageTour("admin-tenant-preview");
      if (!seen) {
        setTourVisible(true);
        await markPageTourSeen("admin-tenant-preview");
      }
    })();
  }, [loading]);

  async function onRefresh() {
    setRefreshing(true);
    await loadTenant();
    setRefreshing(false);
  }

  async function loadTenant() {
    try {
      if (!tenantId) return;

      // GET USER

      // GET USER

      const userSnap = await getDoc(doc(db, "users", tenantId));

      if (userSnap.exists()) {
        const userData = userSnap.data();

        setTenant({
          id: userSnap.id,
          ...userData,
        });

        const assignedIds = [...new Set([
          ...(Array.isArray(userData.stallIds) ? userData.stallIds.map(String) : []),
          String(userData.primaryStallId ?? userData.stallId ?? ""),
        ].filter(Boolean))].slice(0, 3);
        const assignedSnapshots = await Promise.all(
          assignedIds.map((id) => getDoc(doc(db, "stalls", id))),
        );
        setAssignedReceiptStalls(assignedSnapshots.filter((snap) => snap.exists()).map((snap) => ({
          stallId: snap.id,
          buildingNumber: String(snap.data()?.buildingNumber ?? ""),
          spaceId: String(snap.data()?.spaceId ?? snap.id),
          dailyRate: Number(snap.data()?.price ?? 0),
        })));

        // GET STALL

        if (userData.stallId) {
          const stallSnap = await getDoc(doc(db, "stalls", userData.stallId));

          if (stallSnap.exists()) {
            setStall({
              id: stallSnap.id,
              ...stallSnap.data(),
            });
          }
        }
      }

      // GET PAYMENTS


      // Latest payment first — Firestore doesn't guarantee doc order, and
      // sorting client-side avoids needing a composite index for the
      // userId + date query.
    } catch (error) {
      console.log(error);
    } finally {
      setLoading(false);
    }
  }

  async function downloadOnlineReceipt(rd: any) {
    if (generatingReceipt || !rd) return;
    setGeneratingReceipt(true);
    try {
      if (!(await confirmReceiptFolderAccess())) return;

      const pdfStalls = Array.isArray(rd.stalls) && rd.stalls.length > 0 ? rd.stalls : assignedReceiptStalls;
      const premisesHtml = pdfStalls.length > 0
        ? pdfStalls.map((item: any) => `Building ${item.buildingNumber} · Space ${item.spaceId}`).join("<br/>")
        : `Building ${rd.buildingNumber || "N/A"} · Space ${rd.spaceId || "N/A"}`;
      const html = `
        <html><body style="font-family:Arial;padding:30px;">
          <h1 style="text-align:center;">RentWise</h1>
          <h2 style="text-align:center;">Online Payment Receipt</h2>
          <hr/>
          <p><b>Receipt No:</b> ${rd.receiptNo || "N/A"}</p>
          <p><b>Tenant Name:</b> ${rd.tenantName || "N/A"}</p>
          <p><b>Stalls Covered:</b><br/>${premisesHtml}</p>
          <p><b>Date:</b> ${rd.date ? new Date(rd.date).toLocaleDateString() : ""}</p>
          <p><b>Payment Method:</b> ${rd.paymentMethod || "N/A"}</p>
          <p><b>Rent Amount:</b> ₱${rd.rentAmount ?? 0}</p>
          <p><b>Amount Paid:</b> ₱${rd.payment ?? 0}</p>
          ${rd.change > 0 ? `<p><b>Change:</b> ₱${rd.change}</p>` : ""}
          <p><b>Approval Status:</b> ${rd.status ?? ""}</p>
          <hr/>
          <h3 style="text-align:center;">Pending Admin Approval</h3>
        </body></html>
      `;

      const { base64 } = await Print.printToFileAsync({ html, base64: true });
      const fileName = `online-receipt-${rd.receiptNo ?? Date.now()}.pdf`;
      if (Platform.OS === "android") {
        const saved = await saveBase64PdfToReceiptDirectory(base64!, fileName);
        if (!saved) {
          Alert.alert("Folder needed", "Choose a folder to save your receipt.");
          return;
        }
        Alert.alert("Downloaded", "Receipt saved to your chosen folder.");
        return;
      }

      const cachePath = `${RNBlobUtil.fs.dirs.CacheDir}/${fileName}`;
      await RNBlobUtil.fs.writeFile(cachePath, base64!, "base64");
      await RNBlobUtil.MediaCollection.copyToMediaStore(
        { name: fileName, parentFolder: "", mimeType: "application/pdf" },
        "Download",
        cachePath,
      );
      RNBlobUtil.fs.unlink(cachePath).catch(() => {});

      Alert.alert("Downloaded", "Receipt saved to your Downloads folder.");
    } catch (err) {
      console.log("ONLINE RECEIPT ERROR", err);
      Alert.alert("Error", "Failed to generate receipt.");
    } finally {
      setGeneratingReceipt(false);
    }
  }

  function formatDateShort(date: any) {
    if (!date) return "-";
    const d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "2-digit", year: "numeric" });
  }

  // Mirrors rentwise-tenant/app/payment-history.tsx's methodLabel exactly.
  function methodLabel(item: any): string {
    const m = String(item.paymentMethod ?? "");
    if (m.toLowerCase().includes("gcash") && !m.toLowerCase().includes("maya")) return "GCash";
    if (m.toLowerCase().includes("maya")) return "Maya";
    if (item.method === "online") return "Online";
    return "Cash";
  }

  // Mirrors ReceiptCardContent.tsx's methodBadge — returns a logo image for
  // wallet-based methods, or null for cash (no icon needed there).
  function methodIcon(paymentMethod: string | undefined) {
    const m = String(paymentMethod ?? "").toLowerCase();
    if (m.includes("gcash")) return require("../assets/gcash.png");
    if (m.includes("maya")) return require("../assets/maya-icon.png");
    return null;
  }

  // Month-scoped balance — mirrors rentwise-tenant/app/dashboard.tsx exactly,
  // so the admin sees the same numbers the tenant sees on their own screen.
  // Billing terms live on the tenant, not the stall, so they travel with
  // the tenant if relocated instead of reflecting whoever's stall this is.
  const dailyRate = Number(tenant?.price || 0);
  const paymentSchedule = tenant?.paymentSchedule ?? "monthly";
  const today = new Date();
  const rawBillingStart = tenant?.billingStartedAt ?? tenant?.createdAt;
  const billingStartedAt = rawBillingStart?.toDate?.() ?? (rawBillingStart ? new Date(rawBillingStart) : null);
  const rawNextDue = tenant?.nextDueAt ?? tenant?.billingStartedAt ?? tenant?.createdAt;
  const nextDueAt = rawNextDue?.toDate ? rawNextDue.toDate() : null;
  const cycleProgress = rentalCycleProgress(dailyRate, billingStartedAt, nextDueAt, today);
  const cycleEndInclusive = new Date(cycleProgress.cycleEndExclusive);
  cycleEndInclusive.setDate(cycleEndInclusive.getDate() - 1);
  const cycleLabel = `${cycleProgress.cycleStart.toLocaleDateString("en-PH", { month: "short", day: "numeric" })}–${cycleEndInclusive.toLocaleDateString("en-PH", { month: "short", day: "numeric" })}`.toUpperCase();
  const monthTotalCharge = cycleProgress.totalBill;
  const paidThisMonth = cycleProgress.settled;
  const remainingBill = cycleProgress.remaining;
  const intervalDays = scheduleIntervalDays(paymentSchedule);
  const periodsDue = nextDueAt && today >= nextDueAt
    ? Math.floor((today.getTime() - nextDueAt.getTime()) / (intervalDays * 86400000)) + 1
    : 0;
  const paymentDue = dailyRate * intervalDays * periodsDue;

  const periodCharge = computePeriodCharge(dailyRate, paymentSchedule, today);
  const periodsOwed =
    paymentDue > 0 && periodCharge > 0 ? Math.max(1, Math.round(paymentDue / periodCharge)) : 0;
  const missedDuesText =
    periodsOwed > 0
      ? `Missed ${periodsOwed} × ${scheduleDayLabel(paymentSchedule)} due${periodsOwed !== 1 ? "s" : ""}`
      : "You're all caught up";
  const progressPct = cycleProgress.percent;
  const scheduleLabel = paymentSchedule ? scheduleDayLabel(paymentSchedule) : "—";

  // Resets to 0 and animates back up whenever the underlying totals change
  // (including the first time real data arrives), instead of the fill just
  // snapping straight to the new percentage.
  useEffect(() => {
    Animated.sequence([
      Animated.timing(progressAnim, {
        toValue: 0,
        duration: 250,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(progressAnim, {
        toValue: progressPct,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progressPct]);

  const tourSteps: HelpStep[] = [
    { key: "notify", ref: notifyRef, title: "Notify", description: "Sends this tenant a reminder notification about their payment status.", edgeInset: "top" },
    { key: "payment", ref: paymentCardRef, title: "Rental payment", description: "This tenant's remaining bill this month, how much they've paid, and their current payment status.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(paymentCardRef) },
    { key: "history", ref: historyCardRef, title: "Monthly payment history", description: "Every payment this tenant has made. Tap one with a receipt to view it.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(historyCardRef) },
  ];

  const receiptBreakdown = digitalReceipt ? synthesizeBreakdown(digitalReceipt, tenant) : [];
  const receiptAmountPaid = digitalReceipt ? getReceiptAmountPaid(digitalReceipt) : 0;
  const receiptStalls = digitalReceipt && Array.isArray(digitalReceipt.stalls) && digitalReceipt.stalls.length > 0
    ? digitalReceipt.stalls
    : assignedReceiptStalls;
  const receiptPremises = receiptStalls.length > 0
    ? receiptStalls.map((item: any) => `Building ${item.buildingNumber} · Space ${item.spaceId}`).join("\n")
    : `Building ${digitalReceipt?.buildingNumber ?? ""} · Space ${digitalReceipt?.spaceId ?? ""}`;

  const NOTIFY_MESSAGE =
    "The Market Administrator sent you a reminder regarding your rental account. Please check your payment status or contact the market office if you have any questions.";

  const handleNotifyTenant = async () => {
    if (!tenantId) return;
    setSending(true);
    try {
      // Create in-app notification (Cloud Function trigger sends the push)
      await addDoc(collection(db, "notifications"), {
        userId: tenantId,
        type: "payment_reminder",
        category: "payment",
        route: "/(tabs)/payments",
        message: NOTIFY_MESSAGE,
        read: false,
        createdAt: serverTimestamp(),
      });

      Alert.alert("Success", "Notification sent successfully.");
    } catch (err) {
      console.error("[PUSH FAILED]", err);
      Alert.alert("Error", "Failed to send notification. Please try again.");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.emerald} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* HEADER */}
      <LinearGradient
        colors={[colors.emerald, colors.ink]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
          <View style={styles.headerLeftAnchor}>
            <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} hitSlop={8}>
              <ArrowLeft size={22} color={colors.emeraldSoft} />
            </TouchableOpacity>
          </View>

          <Text style={styles.headerTitle}>Tenant Preview</Text>

          <View style={styles.headerRightGroup}>
            <View ref={notifyRef} collapsable={false}>
              <Pressable
                style={({ pressed }) => [
                  styles.notifyBtn,
                  sending && styles.notifyBtnDisabled,
                  pressed && !sending && styles.notifyBtnPressed,
                ]}
                onPress={handleNotifyTenant}
                disabled={sending}
              >
                {({ pressed }) =>
                  sending ? (
                    <ActivityIndicator color={colors.white} size="small" />
                  ) : (
                    <>
                      <Bell size={14} color={pressed ? colors.emerald : colors.white} style={{ marginRight: 6 }} />
                      <Text style={[styles.notifyBtnText, pressed && styles.notifyBtnTextPressed]}>Notify</Text>
                    </>
                  )
                }
              </Pressable>
            </View>

            <View ref={helpRef} collapsable={false}>
              <TouchableOpacity onPress={() => setHelpSupportVisible(true)} activeOpacity={0.7} style={styles.headerIconBtn}>
                <HelpCircle size={22} color={colors.white} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </LinearGradient>

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.body,
          { paddingBottom: insets.bottom + 32 },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />
        }
      >
        {/* PROFILE BANNER */}
        <View style={styles.banner}>
          <Avatar name={[tenant?.firstName, tenant?.middleName, tenant?.lastName].filter(Boolean).join(" ")} size={54} />
          <View style={styles.bannerTextWrap}>
            <Text style={styles.bannerName}>
              {[tenant?.firstName, tenant?.middleName, tenant?.lastName].filter(Boolean).join(" ")}
            </Text>
            <Text style={styles.bannerContact}>
              {tenant?.contactNo ? `+63 ${tenant.contactNo}` : ""}
            </Text>
          </View>
        </View>

        {/* CARD 1 — RENTAL PAYMENT */}
        <View ref={paymentCardRef} collapsable={false}>
        <Card style={styles.rentalCardOverride} noPadding>
          <View style={styles.rpRemainingBox}>
            <View style={styles.rpRemainingLabelRow}>
              <Text style={styles.rpRemainingLabel}>Remaining Bill</Text>
              <Text style={styles.rpMonthBadgeText}>{cycleLabel}</Text>
            </View>
            <Text style={styles.rpRemainingAmount}>₱{remainingBill.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>

            <View style={styles.rpProgressTrack}>
              {Array.from({ length: 10 }, (_, index) => (
                <View key={index} style={styles.rpProgressSegment}>
                  <Animated.View
                    style={[
                      styles.rpProgressFill,
                      {
                        width: progressAnim.interpolate({
                          inputRange: [index * 10, (index + 1) * 10],
                          outputRange: ["0%", "100%"],
                          extrapolate: "clamp",
                        }),
                      },
                    ]}
                  />
                </View>
              ))}
            </View>

            <View style={styles.rpProgressLabels}>
              <View><Text style={styles.rpFooterText}>Settled</Text><Text style={styles.rpFooterStrong}>● ₱{paidThisMonth.toLocaleString()}</Text></View>
              <View style={styles.rpTotalWrap}><Text style={styles.rpFooterText}>Total Bill</Text><Text style={styles.rpFooterTotal}>₱{monthTotalCharge.toLocaleString()} ●</Text></View>
            </View>
          </View>

          <View style={styles.rpStatRow}>
            <View style={styles.rpStatCard}>
              <View style={styles.rpStatLabelRow}>
                <TrendingUp size={13} color={colors.textSecondary} />
                <Text style={styles.rpStatLabel}>Payment</Text>
              </View>
              <Text style={styles.rpStatValue}>
                {paymentDue < 0 ? "-" : ""}₱{Math.abs(paymentDue).toLocaleString()}
              </Text>
              <Text style={styles.rpStatSub}>{missedDuesText}</Text>
            </View>

            <View style={styles.rpStatCard}>
              <View style={styles.rpStatLabelRow}>
                <CalendarClock size={13} color={colors.textSecondary} />
                <Text style={styles.rpStatLabel}>Schedule</Text>
              </View>
              <Text style={styles.rpStatValue}>{scheduleLabel}</Text>
              <Text style={styles.rpStatSub}>₱{dailyRate.toLocaleString()}/day</Text>
            </View>
          </View>
        </Card>
        </View>

        {/* CARD 2 — MONTHLY PAYMENT HISTORY */}
        <View ref={historyCardRef} collapsable={false}>
        <Card style={styles.cardOverride} noPadding>
          <Text style={styles.cardTitle}>Monthly Payment History</Text>

          {payments.length === 0 ? (
            <Text style={styles.empty}>No payments yet.</Text>
          ) : (
            (showAllPayments ? payments : payments.slice(0, 10)).map((item) => {
              const hasReceipt = !!(item.receipt || item.receiptData);
              const Row = hasReceipt ? TouchableOpacity : View;
              return (
                <Row
                  key={item.id}
                  style={styles.txCard}
                  {...(hasReceipt
                    ? {
                        onPress: () =>
                          item.receipt
                            ? setImageViewerUrl(item.receipt)
                            : setDigitalReceipt({
                                ...item.receiptData,
                                periodsCovered: item.periodsCovered,
                                periodsAdvance: item.periodsAdvance,
                                stalls: item.receiptData?.stalls ?? item.stalls,
                              }),
                        activeOpacity: 0.7,
                      }
                    : {})}
                >
                  <View style={styles.rowInfo}>
                    <View style={styles.rowAmountLine}>
                      <Text style={styles.rowAmount}>₱{Number(item.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                      {!!item.receiptNo && <Text style={styles.receiptNoChip}>{item.receiptNo}</Text>}
                    </View>
                    <Text style={styles.rowDate}>{formatDateShort(item.date)}</Text>
                  </View>

                  <View style={styles.rowRight}>
                    <Badge
                      label={item.status === "approved" ? "PAID" : (item.status?.toUpperCase() ?? "")}
                      tone={
                        item.status === "approved"
                          ? "success"
                          : item.status === "pending"
                            ? "warning"
                            : "error"
                      }
                    />
                    <View style={styles.rowMethodLine}>
                      <Banknote size={12} color={colors.ink} />
                      <Text style={styles.rowMethod}>{methodLabel(item)}</Text>
                    </View>
                  </View>
                  <ChevronRight size={18} color={colors.borderStrong} style={styles.rowChevron} />
                </Row>
              );
            })
          )}
          {!showAllPayments && payments.length > 10 && (
            <View style={styles.viewAllPaymentsWrap}>
              <TouchableOpacity
                style={styles.viewAllPaymentsButton}
                activeOpacity={0.75}
                onPress={() => setShowAllPayments(true)}
              >
                <Text style={styles.viewAllPaymentsText}>View all</Text>
              </TouchableOpacity>
            </View>
          )}
        </Card>
        </View>
      </ScrollView>

      {/* CASH RECEIPT IMAGE VIEWER */}
      <Modal visible={!!imageViewerUrl} transparent animationType="fade">
        <Pressable
          style={styles.imageViewerBg}
          onPress={() => setImageViewerUrl(null)}
        >
          {imageViewerUrl && (
            <Image
              source={{ uri: imageViewerUrl }}
              style={styles.imageViewerImage}
              resizeMode="contain"
            />
          )}
        </Pressable>
      </Modal>

      {/* ONLINE PAYMENT DIGITAL RECEIPT */}
      <Modal visible={!!digitalReceipt} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.modalBox}>
            <View style={styles.receiptHandle} />
            <View style={styles.receiptHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.receiptEyebrow}>Tenant's</Text>
                <View style={styles.receiptTitleRow}>
                  <Text style={styles.receiptTitle}>Digital Receipt</Text>
                  <BadgeCheck size={18} color={colors.emerald} />
                </View>
              </View>
              <TouchableOpacity style={styles.receiptCloseIcon} onPress={() => setDigitalReceipt(null)} activeOpacity={0.7}>
                <X size={18} color={colors.ink} />
              </TouchableOpacity>
            </View>

            <View style={styles.receiptNumberBox}>
              <Text style={styles.receiptNumberLabel}>Receipt No.</Text>
              <Text style={styles.receiptNumberValue}>{digitalReceipt?.receiptNo ?? ""}</Text>
            </View>

            <View style={styles.receiptAmountBox}>
              <Text style={styles.receiptAmountLabel}>
                {String(digitalReceipt?.status ?? "").toLowerCase() === "pending" ? "Payment Submitted" : "Total Settled Rent"}
              </Text>
              <Text style={styles.receiptAmountValue}>₱{receiptAmountPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
            </View>

            <View style={styles.receiptDetailsBox}>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Tenant Name</Text>
                <Text style={styles.receiptDetailValue}>{digitalReceipt?.tenantName ?? ""}</Text>
              </View>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Stalls Covered</Text>
                <Text style={styles.receiptDetailValue}>{receiptPremises}</Text>
              </View>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Settlement Date</Text>
                <Text style={styles.receiptDetailValue}>
                  {digitalReceipt?.date ? new Date(digitalReceipt.date).toLocaleDateString() : ""}
                </Text>
              </View>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Payment Method</Text>
                <View style={styles.receiptMethodValueRow}>
                  {methodIcon(digitalReceipt?.paymentMethod) && (
                    <Image
                      source={methodIcon(digitalReceipt?.paymentMethod)}
                      style={styles.receiptMethodIcon}
                      resizeMode="contain"
                    />
                  )}
                  <Text style={styles.receiptDetailValue}>{digitalReceipt?.paymentMethod ?? ""}</Text>
                </View>
              </View>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Rent Settled</Text>
                <Text style={[styles.receiptDetailValue, styles.receiptSettledValue]}>₱{receiptAmountPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
              </View>
              {digitalReceipt?.change > 0 && (
                <View style={styles.receiptDetailRow}>
                  <Text style={styles.receiptDetailLabel}>Change</Text>
                  <Text style={styles.receiptDetailValue}>₱{digitalReceipt.change}</Text>
                </View>
              )}

            </View>

            {receiptBreakdown.length > 0 && (
              <View style={styles.breakdownSection}>
                <TouchableOpacity
                  style={styles.breakdownHeader}
                  onPress={() => setBreakdownOpen((v) => !v)}
                  activeOpacity={0.7}
                >
                  <View style={styles.breakdownTitleRow}>
                    <Calculator size={14} color={colors.emerald} />
                    <Text style={styles.breakdownTitle}>Breakdown (Rent Interval Summary)</Text>
                  </View>
                  {breakdownOpen ? (
                    <ChevronUp size={16} color={colors.emerald} />
                  ) : (
                    <ChevronDown size={16} color={colors.emerald} />
                  )}
                </TouchableOpacity>

                {breakdownOpen && (
                  <ScrollView style={styles.breakdownScroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                    {receiptBreakdown.map((line, i) => (
                      <View key={i} style={styles.breakdownRow}>
                        <Text style={styles.breakdownLabel}>{line.label}</Text>
                        <Text style={styles.breakdownValue}>₱{line.amount.toLocaleString()}</Text>
                      </View>
                    ))}
                    <View style={styles.breakdownDivider} />
                    <View style={styles.breakdownRow}>
                      <Text style={styles.breakdownTotalLabel}>Total</Text>
                      <Text style={styles.breakdownTotalValue}>₱{receiptAmountPaid.toLocaleString()}</Text>
                    </View>
                  </ScrollView>
                )}
              </View>
            )}

            <View style={styles.modalButtons}>
              <Pressable style={({ pressed }) => [styles.receiptCloseBtn, pressed && styles.receiptButtonPressed]} onPress={() => setDigitalReceipt(null)}>
                <Text style={styles.receiptCloseBtnText}>Close</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.receiptDownloadBtn, pressed && styles.receiptButtonPressed]} onPress={() => downloadOnlineReceipt(digitalReceipt)} disabled={generatingReceipt}>
                {generatingReceipt ? <ActivityIndicator color={colors.white} size="small" /> : <><Download size={15} color={colors.white} /><Text style={styles.receiptDownloadBtnText}>Download Receipt</Text></>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <HelpSupportModal visible={helpSupportVisible} steps={tourSteps} onClose={() => setHelpSupportVisible(false)} onReplayTour={() => setTourVisible(true)} />
      <HelpTour
        visible={tourVisible}
        steps={tourSteps}
        onClose={() => {
          setTourVisible(false);
          scrollRef.current?.scrollTo({ y: 0, animated: true });
        }}
      />
    </View>
  );
}


const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.parchment,
  },

  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.parchment,
  },

  // ── Header ────────────────────────────────────────────────────────────────────

  headerGradient: {
    borderBottomLeftRadius: radius.xl + 4,
    borderBottomRightRadius: radius.xl + 4,
    overflow: "hidden",
  },

  header: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md + 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  headerTitle: {
    color: colors.white,
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
    flex: 1,
    textAlign: "center",
  },

  headerRightGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },

  // Matches headerIconBtn's width so the centered headerTitle has a
  // consistent left anchor -- the right side's Notify pill is inherently
  // variable-width (text vs. loading spinner), so this narrows but doesn't
  // eliminate the residual optical drift; matches the same tradeoff already
  // accepted elsewhere in this codebase (e.g. tenant payment-history.tsx).
  headerLeftAnchor: {
    width: 40,
  },

  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },

  notifyBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.4)",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm - 1,
    minWidth: 84,
  },

  notifyBtnPressed: {
    backgroundColor: colors.white,
    borderColor: colors.white,
  },

  notifyBtnDisabled: {
    opacity: 0.6,
  },

  notifyBtnText: {
    color: colors.white,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
  },

  notifyBtnTextPressed: {
    color: colors.emerald,
  },

  // ── Body ─────────────────────────────────────────────────────────────────────

  body: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl,
    gap: spacing.lg,
  },

  // ── Profile banner ────────────────────────────────────────────────────────────

  banner: {
    backgroundColor: colors.emerald,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg + 2,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md + 2,
    ...shadow.card,
  },

  bannerTextWrap: {
    flex: 1,
  },

  bannerName: {
    color: colors.white,
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
    marginTop: 2,
  },

  bannerContact: {
    color: colors.emeraldSoft,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    marginTop: 2,
  },

  // ── Card ─────────────────────────────────────────────────────────────────────

  cardOverride: {
    flexDirection: "column",
    padding: spacing.lg + 2,
    ...shadow.card,
  },

  rentalCardOverride: {
    flexDirection: "column",
    padding: spacing.md + 2,
    ...shadow.card,
  },

  cardTitle: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginBottom: spacing.md + 2,
  },

  // ── Rental Payment card (Card 1) — mirrors rentwise-tenant/app/dashboard.tsx exactly ──

  rpMonthBadgeText: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },

  rpRemainingBox: {
    backgroundColor: "#FBFFFD",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "#B9DED1",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  rpRemainingLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rpRemainingLabel: {
    fontSize: fontSize.xs + 1,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  rpRemainingAmount: {
    fontSize: 38,
    fontFamily: fontFamily.extrabold,
    color: colors.ink,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  rpProgressTrack: {
    flexDirection: "row",
    gap: 6,
    marginBottom: spacing.sm + 2,
  },
  rpProgressSegment: { flex: 1, height: 8, borderRadius: radius.pill, backgroundColor: "#E1E5E3", overflow: "hidden" },
  rpProgressFill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.emerald,
  },
  rpProgressLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  rpFooterText: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
  },
  rpFooterStrong: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    color: colors.emerald,
    marginTop: spacing.sm,
  },
  rpFooterTotal: { fontSize: fontSize.md, fontFamily: fontFamily.bold, color: colors.emerald, marginTop: spacing.sm },
  rpTotalWrap: { alignItems: "flex-end" },

  rpStatRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.md,
  },
  rpStatCard: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing.md,
    minHeight: 92,
  },
  rpStatLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: spacing.xs + 2,
  },
  rpStatLabel: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
  },
  rpStatValue: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginBottom: 2,
  },
  rpStatSub: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.regular,
    color: colors.textMuted,
  },

  // ── Payment history transaction cards (Card 2) — mirrors
  // rentwise-tenant/app/payment-history.tsx's txCard exactly ──────────────────

  txCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: spacing.md,
  },

  rowInfo: {
    flex: 1,
  },

  rowAmountLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },

  rowAmount: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  receiptNoChip: {
    fontSize: 9,
    fontFamily: fontFamily.medium,
    color: colors.ink,
    backgroundColor: colors.mist,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },

  rowDate: {
    fontSize: fontSize.xs + 1,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    marginTop: 2,
  },

  rowRight: {
    alignItems: "flex-end",
    marginLeft: spacing.sm,
  },

  rowMethodLine: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },

  rowMethod: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.regular,
    color: colors.ink,
  },

  rowChevron: { marginLeft: spacing.sm },

  viewAllPaymentsWrap: {
    alignItems: "center",
    paddingTop: spacing.lg,
  },
  viewAllPaymentsButton: {
    minWidth: 112,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  viewAllPaymentsText: {
    color: colors.white,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
  },

  // Empty state

  empty: {
    paddingVertical: spacing.xxl,
    textAlign: "center",
    fontSize: fontSize.base,
    color: colors.textMuted,
    fontFamily: fontFamily.regular,
  },

  // ── Receipt viewers ──────────────────────────────────────────────────────────

  imageViewerBg: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    alignItems: "center",
  },

  imageViewerImage: {
    width: "100%",
    height: "80%",
  },

  modalBg: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    alignItems: "center",
  },

  modalBox: {
    width: "92%",
    maxWidth: 390,
    maxHeight: "92%",
    backgroundColor: colors.white,
    borderRadius: 24,
    padding: spacing.lg,
    ...shadow.raised,
  },

  modalButtons: {
    flexDirection: "row",
    marginTop: spacing.lg,
    gap: spacing.sm + 2,
  },

  // ── Digital receipt modal ────────────────────────────────────────────────────

  receiptHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
  },

  receiptHandle: { width: 36, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center", marginBottom: spacing.md },
  receiptTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  receiptCloseIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.mist, alignItems: "center", justifyContent: "center" },

  receiptEyebrow: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },

  receiptTitle: {
    fontSize: fontSize.lg,
    fontFamily: fontFamily.extrabold,
    color: colors.ink,
  },

  receiptNumberBox: { backgroundColor: "#F7F9FA", borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  receiptNumberLabel: { fontSize: 9, fontFamily: fontFamily.semibold, color: colors.textMuted, textTransform: "uppercase" },
  receiptNumberValue: { fontSize: fontSize.xs, fontFamily: fontFamily.bold, color: colors.ink, marginTop: 2 },
  receiptAmountBox: { minHeight: 105, backgroundColor: "#FBFCFD", borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  receiptAmountLabel: { fontSize: 10, fontFamily: fontFamily.semibold, color: colors.textMuted, textTransform: "uppercase" },
  receiptAmountValue: { fontSize: 30, fontFamily: fontFamily.extrabold, color: colors.ink, marginTop: spacing.sm },

  receiptDetailsBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },

  receiptDetailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },

  receiptDetailLabel: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
  },

  receiptDetailValue: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },
  receiptSettledValue: { color: colors.emerald },

  receiptMethodValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  receiptMethodIcon: {
    width: 16,
    height: 16,
    borderRadius: 4,
  },

  breakdownSection: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: "#F8FAFA",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },

  breakdownHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  breakdownTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },

  breakdownTitle: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  // Caps the list to roughly 3 rows tall (each row is ~28px) so a long
  // breakdown scrolls inside its own area instead of pushing the rest of
  // the modal (buttons included) further down the screen.
  breakdownScroll: {
    maxHeight: 90,
    marginTop: spacing.sm,
  },

  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
  },

  breakdownLabel: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    color: colors.emeraldBright,
    flexShrink: 1,
    paddingRight: spacing.sm,
  },

  breakdownValue: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.emeraldBright,
  },

  breakdownDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },

  breakdownTotalLabel: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  breakdownTotalValue: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.emerald,
  },

  receiptCloseBtn: {
    minWidth: 78,
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.emerald,
    alignItems: "center",
    justifyContent: "center",
  },
  receiptCloseBtnText: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.ink },

  receiptDownloadBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  receiptDownloadBtnText: { fontSize: fontSize.sm, fontFamily: fontFamily.bold, color: colors.white },
  receiptButtonPressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
});
