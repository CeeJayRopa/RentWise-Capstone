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
  getDocs,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";

import { db } from "../shared/services/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, Bell, Check, FileText, Info, TrendingUp, CalendarClock, HelpCircle } from "lucide-react-native";
import { Card, Badge, Avatar, Button } from "../shared/components/ui";
import HelpTour, { HelpStep } from "./components/HelpTour";
import { hasSeenPageTour, markPageTourSeen } from "../shared/services/onboardingTour";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../shared/theme";

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
function computePeriodCharge(dailyRate: number, schedule: string, date: Date): number {
  if (schedule === "daily") return dailyRate;
  if (schedule === "weekly") return dailyRate * 7;
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  if (schedule === "semi-monthly") {
    const daysInHalf = date.getDate() <= 15 ? 15 : daysInMonth - 15;
    return dailyRate * daysInHalf;
  }
  return dailyRate * daysInMonth; // monthly
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
  if (schedule === "daily") {
    return `Daily Rent (${date.toLocaleDateString("en-US", { month: "long", day: "numeric" })})`;
  }
  if (schedule === "weekly") {
    return `Weekly Rent (week of ${date.toLocaleDateString("en-US", { month: "long", day: "numeric" })})`;
  }
  if (schedule === "semi-monthly") {
    const half = date.getDate() <= 15 ? "1st half" : "2nd half";
    return `Rent – ${half} of ${date.toLocaleDateString("en-US", { month: "long" })}`;
  }
  return `Monthly Rent (${date.toLocaleDateString("en-US", { month: "long", year: "numeric" })})`;
}

// Older receipts (and admin-recorded cash payments) never stored a
// `breakdown` array — only the lump `rentAmount`. Reconstructs the same
// itemized, date-listed breakdown by working out how many consecutive
// periods that lump sum represents. Mirrors ReceiptCardContent.tsx exactly.
function synthesizeBreakdown(data: any, stall: any): { label: string; amount: number }[] {
  const schedule = stall?.paymentSchedule;
  const dailyRate = Number(stall?.price || 0);
  const rentAmount = Number(data?.rentAmount || 0);
  if (!schedule || dailyRate <= 0 || rentAmount <= 0) return [];

  const receiptDate = data.date ? new Date(data.date) : new Date();
  const onePeriodCharge = computePeriodCharge(dailyRate, schedule, receiptDate);
  if (onePeriodCharge <= 0) return [];

  const periodsCount = Math.max(1, Math.round(rentAmount / onePeriodCharge));
  return consecutivePeriodsEnding(dailyRate, schedule, receiptDate, periodsCount).map((p) => ({
    label: periodLabel(schedule, p.date),
    amount: p.amount,
  }));
}

export default function TenantPreview() {
  const insets = useSafeAreaInsets();

  const { tenantId } = useLocalSearchParams<{
    tenantId: string;
  }>();

  const [tenant, setTenant] = useState<any>(null);
  const [stall, setStall] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [generatingReceipt, setGeneratingReceipt] = useState(false);
  const [imageViewerUrl, setImageViewerUrl] = useState<string | null>(null);
  const [digitalReceipt, setDigitalReceipt] = useState<any>(null);

  const [tourVisible, setTourVisible] = useState(false);
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

      const q = query(
        collection(db, "payments"),
        where("userId", "==", tenantId),
      );

      const snap = await getDocs(q);

      const list: any[] = [];

      snap.forEach((d) => {
        list.push({
          id: d.id,
          ...d.data(),
        });
      });

      // Latest payment first — Firestore doesn't guarantee doc order, and
      // sorting client-side avoids needing a composite index for the
      // userId + date query.
      list.sort((a, b) => {
        const aMs = a.date?.toMillis ? a.date.toMillis() : 0;
        const bMs = b.date?.toMillis ? b.date.toMillis() : 0;
        return bMs - aMs;
      });

      setPayments(list);
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
      const html = `
        <html><body style="font-family:Arial;padding:30px;">
          <h1 style="text-align:center;">RentWise</h1>
          <h2 style="text-align:center;">Online Payment Receipt</h2>
          <hr/>
          <p><b>Receipt No:</b> ${rd.receiptNo ?? ""}</p>
          <p><b>Tenant Name:</b> ${rd.tenantName ?? ""}</p>
          <p><b>Building Number:</b> ${rd.buildingNumber ?? ""}</p>
          <p><b>Space ID:</b> ${rd.spaceId ?? ""}</p>
          <p><b>Date:</b> ${rd.date ? new Date(rd.date).toLocaleDateString() : ""}</p>
          <p><b>Payment Method:</b> ${rd.paymentMethod ?? ""}</p>
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
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
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
  const dailyRate = Number(stall?.price || 0);
  const paymentSchedule = stall?.paymentSchedule ?? "monthly";
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthTotalCharge = dailyRate * daysInMonth;

  const paidThisMonth = payments.reduce((sum, p) => {
    if (p.status !== "approved") return sum;
    const d = p.date?.toDate ? p.date.toDate() : p.date ? new Date(p.date) : null;
    if (!d || d.getFullYear() !== year || d.getMonth() !== month) return sum;
    return sum + Number(p.amount || 0);
  }, 0);

  const remainingBill = monthTotalCharge - paidThisMonth;
  const chargedToDate = chargedSinceMonthStart(dailyRate, paymentSchedule, today);
  const paymentDue = chargedToDate - paidThisMonth;

  const periodCharge = computePeriodCharge(dailyRate, paymentSchedule, today);
  const periodsOwed =
    paymentDue > 0 && periodCharge > 0 ? Math.max(1, Math.round(paymentDue / periodCharge)) : 0;
  const missedDuesText =
    periodsOwed > 0
      ? `Missed ${periodsOwed} ${paymentSchedule} due${periodsOwed !== 1 ? "s" : ""}`
      : "You're all caught up";
  const monthLabel = `${MONTHS[month]} ${year}`;
  const progressPct = Math.max(0, Math.min(100, (paidThisMonth / Math.max(monthTotalCharge, 1)) * 100));
  const scheduleLabel = paymentSchedule
    ? paymentSchedule.charAt(0).toUpperCase() + paymentSchedule.slice(1)
    : "—";

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

  // For the digital receipt modal's Breakdown section — `data.payment` is
  // what the tenant tendered (includes any change owed back for cash), so
  // the real amount paid is that minus the change. Mirrors
  // ReceiptCardContent.tsx exactly.
  const receiptBreakdown = digitalReceipt ? synthesizeBreakdown(digitalReceipt, stall) : [];
  const receiptAmountPaid = digitalReceipt
    ? Number(digitalReceipt.payment ?? 0) - Number(digitalReceipt.change ?? 0)
    : 0;

  const NOTIFY_MESSAGE =
    "The Market Administrator sent you a reminder regarding your rental account. Please check your payment status or contact the market office if you have any questions.";

  const handleNotifyTenant = async () => {
    if (!tenantId) return;
    setSending(true);
    try {
      // Create in-app notification (Cloud Function trigger sends the push)
      await addDoc(collection(db, "notifications"), {
        userId: tenantId,
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
                {sending ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <>
                    <Bell size={14} color={colors.white} style={{ marginRight: 6 }} />
                    <Text style={styles.notifyBtnText}>Notify</Text>
                  </>
                )}
              </Pressable>
            </View>

            <View ref={helpRef} collapsable={false}>
              <TouchableOpacity onPress={() => setTourVisible(true)} activeOpacity={0.7} style={styles.headerIconBtn}>
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
          <Avatar name={`${tenant?.firstName ?? ""} ${tenant?.lastName ?? ""}`} size={54} />
          <View style={styles.bannerTextWrap}>
            <Text style={styles.bannerWelcome}>Welcome, tenant!</Text>
            <Text style={styles.bannerName}>
              {tenant?.firstName} {tenant?.lastName}
            </Text>
            <Text style={styles.bannerContact}>
              {tenant?.contactNo ? `+63 ${tenant.contactNo}` : ""}
            </Text>
            {!!(tenant?.personalEmail || tenant?.email) && (
              <View style={styles.bannerEmailRow}>
                <Text style={styles.bannerEmail} numberOfLines={1}>
                  {tenant.personalEmail || tenant.email}
                </Text>
                <Badge
                  label={tenant?.emailVerified ? "Verified" : "Unverified"}
                  tone={tenant?.emailVerified ? "success" : "warning"}
                />
              </View>
            )}
          </View>
        </View>

        {/* CARD 1 — RENTAL PAYMENT */}
        <View ref={paymentCardRef} collapsable={false}>
        <Card style={styles.cardOverride} noPadding>
          <View style={styles.rpHeaderRow}>
            <Text style={styles.cardTitle}>Rental Payment</Text>
            <View style={styles.rpMonthBadge}>
              <Text style={styles.rpMonthBadgeText}>{monthLabel}</Text>
            </View>
          </View>

          <View style={styles.rpRemainingBox}>
            <View style={styles.rpRemainingLabelRow}>
              <Info size={13} color={colors.textSecondary} />
              <Text style={styles.rpRemainingLabel}>Remaining Bill</Text>
            </View>
            <Text style={styles.rpRemainingAmount}>₱{remainingBill.toLocaleString()}</Text>

            <View style={styles.rpProgressTrack}>
              <Animated.View
                style={[
                  styles.rpProgressFill,
                  {
                    width: progressAnim.interpolate({
                      inputRange: [0, 100],
                      outputRange: ["0%", "100%"],
                      extrapolate: "clamp",
                    }),
                  },
                ]}
              />
            </View>

            <View style={styles.rpProgressLabels}>
              <Text style={styles.rpFooterText}>
                <Text style={styles.rpFooterStrong}>₱{paidThisMonth.toLocaleString()}</Text> paid
              </Text>
              <Text style={styles.rpFooterText}>of ₱{monthTotalCharge.toLocaleString()}</Text>
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
            payments.map((item) => {
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
                            : setDigitalReceipt(item.receiptData),
                        activeOpacity: 0.7,
                      }
                    : {})}
                >
                  <View style={styles.rowIconCircle}>
                    <FileText size={18} color={colors.emerald} />
                  </View>

                  <View style={styles.rowInfo}>
                    <Text style={styles.rowAmount}>₱{Number(item.amount || 0).toLocaleString()}</Text>
                    <Text style={styles.rowDate}>
                      {formatDateShort(item.date)}
                      {item.receiptNo ? ` · #${item.receiptNo}` : ""}
                    </Text>
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
                    <Text style={styles.rowMethod}>via {methodLabel(item)}</Text>
                  </View>
                </Row>
              );
            })
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
            <View style={styles.receiptHeaderRow}>
              <View style={styles.receiptBadge}>
                <FileText size={20} color={colors.emerald} />
              </View>
              <View>
                <Text style={styles.receiptEyebrow}>Tenant's</Text>
                <Text style={styles.receiptTitle}>Digital Receipt</Text>
              </View>
            </View>

            <View style={styles.receiptDetailsBox}>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Receipt No.</Text>
                <Text style={styles.receiptDetailValue}>{digitalReceipt?.receiptNo ?? ""}</Text>
              </View>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Tenant</Text>
                <Text style={styles.receiptDetailValue}>{digitalReceipt?.tenantName ?? ""}</Text>
              </View>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Building</Text>
                <Text style={styles.receiptDetailValue}>{digitalReceipt?.buildingNumber ?? ""}</Text>
              </View>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Space ID</Text>
                <Text style={styles.receiptDetailValue}>{digitalReceipt?.spaceId ?? ""}</Text>
              </View>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Date</Text>
                <Text style={styles.receiptDetailValue}>
                  {digitalReceipt?.date ? new Date(digitalReceipt.date).toLocaleDateString() : ""}
                </Text>
              </View>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Method</Text>
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
                <Text style={styles.receiptDetailLabel}>Rent</Text>
                <Text style={styles.receiptDetailValue}>₱{digitalReceipt?.rentAmount ?? 0}</Text>
              </View>
              {digitalReceipt?.change > 0 && (
                <View style={styles.receiptDetailRow}>
                  <Text style={styles.receiptDetailLabel}>Change</Text>
                  <Text style={styles.receiptDetailValue}>₱{digitalReceipt.change}</Text>
                </View>
              )}

              <View style={styles.receiptStatusPill}>
                {String(digitalReceipt?.status ?? "").toLowerCase() === "approved" && (
                  <Check size={14} color={colors.emerald} style={{ marginRight: 6 }} />
                )}
                <Text style={styles.receiptStatusPillText}>
                  {String(digitalReceipt?.status ?? "").toUpperCase()}
                </Text>
              </View>
            </View>

            {receiptBreakdown.length > 0 && (
              <View style={styles.breakdownSection}>
                <Text style={styles.breakdownTitle}>Breakdown</Text>
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
              </View>
            )}

            <View style={styles.modalButtons}>
              <Button
                label="Close"
                variant="secondary"
                fullWidth={false}
                onPress={() => setDigitalReceipt(null)}
                style={styles.receiptCloseBtn}
              />

              <Button
                label="Download Receipt"
                variant="primary"
                fullWidth={false}
                loading={generatingReceipt}
                onPress={() => downloadOnlineReceipt(digitalReceipt)}
                style={styles.receiptDownloadBtn}
              />
            </View>
          </View>
        </View>
      </Modal>

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
    backgroundColor: "rgba(255,255,255,0.28)",
  },

  notifyBtnDisabled: {
    opacity: 0.6,
  },

  notifyBtnText: {
    color: colors.white,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
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

  bannerWelcome: {
    color: colors.emeraldSoft,
    fontSize: fontSize.xs,
    fontFamily: fontFamily.medium,
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

  bannerEmailRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.xs + 2,
    marginTop: 4,
  },

  bannerEmail: {
    color: colors.emeraldSoft,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    flexShrink: 1,
  },

  // ── Card ─────────────────────────────────────────────────────────────────────

  cardOverride: {
    flexDirection: "column",
    padding: spacing.lg + 2,
    ...shadow.card,
  },

  cardTitle: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginBottom: spacing.md + 2,
  },

  // ── Rental Payment card (Card 1) — mirrors rentwise-tenant/app/dashboard.tsx exactly ──

  rpHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md + 2,
  },
  rpMonthBadge: {
    backgroundColor: colors.emeraldSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  rpMonthBadgeText: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },

  rpRemainingBox: {
    backgroundColor: colors.mist,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  rpRemainingLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rpRemainingLabel: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  rpRemainingAmount: {
    fontSize: fontSize.display,
    fontFamily: fontFamily.extrabold,
    color: colors.error,
    marginTop: 4,
    marginBottom: spacing.md,
  },
  rpProgressTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    overflow: "hidden",
    marginBottom: spacing.sm,
  },
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
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  rpStatRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  rpStatCard: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing.md + 2,
  },
  rpStatLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: spacing.sm,
  },
  rpStatLabel: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
  },
  rpStatValue: {
    fontSize: fontSize.lg,
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
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md + 2,
    marginBottom: spacing.md,
  },

  rowIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.emeraldSoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },

  rowInfo: {
    flex: 1,
  },

  rowAmount: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  rowDate: {
    fontSize: fontSize.xs + 1,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    marginTop: 2,
  },

  rowRight: {
    alignItems: "flex-end",
  },

  rowMethod: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.regular,
    color: colors.textMuted,
    marginTop: 4,
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
    width: "88%",
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.xl,
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
    gap: spacing.md,
    marginBottom: spacing.lg,
  },

  receiptBadge: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.emeraldSoft,
    alignItems: "center",
    justifyContent: "center",
  },

  receiptEyebrow: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },

  receiptTitle: {
    fontSize: fontSize.lg,
    fontFamily: fontFamily.extrabold,
    color: colors.ink,
  },

  receiptDetailsBox: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    backgroundColor: colors.mist,
    padding: spacing.lg,
  },

  receiptDetailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.xs + 2,
  },

  receiptDetailLabel: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
  },

  receiptDetailValue: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

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

  receiptStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.successSoft,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm + 2,
    marginTop: spacing.md,
  },

  receiptStatusPillText: {
    fontSize: fontSize.xs + 1,
    fontFamily: fontFamily.bold,
    color: colors.emerald,
    letterSpacing: 0.4,
  },

  breakdownSection: {
    marginTop: spacing.lg,
  },

  breakdownTitle: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginBottom: spacing.sm,
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
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
  },

  receiptDownloadBtn: {
    flex: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
  },
});
