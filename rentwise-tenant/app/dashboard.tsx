import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  FlatList,
  TextInput,
  Alert,
  ScrollView,
  Image,
  StatusBar,
  Animated,
  Easing,
  Linking,
  RefreshControl,
} from "react-native";
import { WebView } from "react-native-webview";
import { captureRef } from "react-native-view-shot";

import BellIcon from "./components/BellIcon";

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { updatePassword } from "firebase/auth";

import { db } from "../shared/services/firestore";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback, useEffect, useRef, useState } from "react";

import { auth } from "../shared/firebaseConfig";
import { getTenantData } from "../services/tenantService";
import { createOnlinePayment, createPayment, notifyAdminsOfOnlinePayment } from "../services/paymentService";
import { uploadReceiptImage } from "../services/storageService";
import {
  setPendingCheckoutSession,
  getPendingCheckoutSession,
  clearPendingCheckoutSession,
} from "../services/pendingPayment";

import { logoutUser } from "../services/authService";

import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

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
// fall in the period containing `date` (weekly is always 7 days; monthly
// and semi-monthly vary with the actual calendar, e.g. Feb vs. Jan).
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
// month through today's period, inclusive. A period counts in full the
// moment it starts — it isn't prorated by how many days into it "today" is
// — so a weekly tenant on day 3 (still inside week 1) owes exactly one
// week's rent (₱1,169), not a 3-day fraction. For "daily" this naturally
// reduces to dailyRate × day-of-month, since each day is its own period.
// The trailing period is capped at the month's last day (e.g. a weekly
// tenant's 5th "week" of a 31-day month is really only 3 days) so the
// running total never overshoots — and stays equal to — the month's total
// charge (dailyRate × daysInMonth) once every period has started.
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

// True if `a` and `b` fall within the same billing period for `schedule` —
// used only to block a duplicate "Pay Online" submission for a period
// that's already been paid, separate from the month-wide running balance.
function isSamePeriod(schedule: string, a: Date, b: Date): boolean {
  if (schedule === "daily") {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }
  if (schedule === "weekly") {
    const startA = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    startA.setDate(startA.getDate() - startA.getDay());
    const startB = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    startB.setDate(startB.getDate() - startB.getDay());
    return startA.getTime() === startB.getTime();
  }
  if (schedule === "semi-monthly") {
    const halfOf = (d: Date) => (d.getDate() <= 15 ? 0 : 1);
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      halfOf(a) === halfOf(b)
    );
  }
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth(); // monthly
}

function ReceiptCardContent({ data }: { data: any }) {
  return (
    <View style={styles.receiptFields}>
      <View style={styles.receiptFieldRow}>
        <Text style={styles.receiptFieldLabel}>Receipt No</Text>
        <Text style={styles.receiptFieldValue}>{data.receiptNo}</Text>
      </View>
      <View style={styles.receiptFieldRow}>
        <Text style={styles.receiptFieldLabel}>Tenant Name</Text>
        <Text style={styles.receiptFieldValue}>{data.tenantName}</Text>
      </View>
      <View style={styles.receiptFieldRow}>
        <Text style={styles.receiptFieldLabel}>Building No</Text>
        <Text style={styles.receiptFieldValue}>{data.buildingNumber}</Text>
      </View>
      <View style={styles.receiptFieldRow}>
        <Text style={styles.receiptFieldLabel}>Space ID</Text>
        <Text style={styles.receiptFieldValue}>{data.spaceId}</Text>
      </View>
      {data.paymentMethod && (
        <View style={styles.receiptFieldRow}>
          <Text style={styles.receiptFieldLabel}>Payment Method</Text>
          <Text style={styles.receiptFieldValue}>{data.paymentMethod}</Text>
        </View>
      )}
      <View style={styles.receiptFieldRow}>
        <Text style={styles.receiptFieldLabel}>Date</Text>
        <Text style={styles.receiptFieldValue}>
          {new Date(data.date).toLocaleDateString()}
        </Text>
      </View>
      <View style={styles.receiptFieldRow}>
        <Text style={styles.receiptFieldLabel}>Rent Amount</Text>
        <Text style={styles.receiptFieldValue}>₱{data.rentAmount}</Text>
      </View>
      <View style={styles.receiptFieldRow}>
        <Text style={styles.receiptFieldLabel}>Payment</Text>
        <Text style={styles.receiptFieldValue}>₱{data.payment}</Text>
      </View>
      <View style={styles.receiptFieldRow}>
        <Text style={styles.receiptFieldLabel}>Change</Text>
        <Text style={styles.receiptFieldValue}>₱{data.change}</Text>
      </View>
      <View style={styles.receiptFieldRow}>
        <Text style={styles.receiptFieldLabel}>Status</Text>
        <Text style={[styles.receiptFieldValue, styles.textApproved]}>
          {data.status}
        </Text>
      </View>
    </View>
  );
}

export default function Dashboard() {
  const insets = useSafeAreaInsets();

  const topInset =
    insets.top > 0 ? insets.top : (StatusBar.currentHeight ?? 24);

  const [tenant, setTenant] = useState<any>(null);
  const [stall, setStall] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(
    MONTHS[new Date().getMonth()],
  );
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showPayModal, setShowPayModal] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<any>(null);
  const [payAmount, setPayAmount] = useState("");
  const [selectedMethod, setSelectedMethod] = useState<"gcash" | "paymaya" | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [dropdownTop, setDropdownTop] = useState(0);
  const [dropdownLeft, setDropdownLeft] = useState(0);
  const [showWebView, setShowWebView] = useState(false);
  const [webViewUrl, setWebViewUrl] = useState("");
  const [webViewLoading, setWebViewLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const [showToast, setShowToast] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;

  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
  const [changePwError, setChangePwError] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const [captureReceipt, setCaptureReceipt] = useState<{
    paymentId: string;
    data: any;
  } | null>(null);
  const receiptShotRef = useRef<View>(null);

  const monthPillRef = useRef<View>(null);

  // The stall's rate for whatever schedule is currently selected (daily,
  // weekly, semi-monthly, or monthly) — admin enters this as the direct
  // per-period amount, not a monthly total to be divided down.
  const periodRate = Number(stall?.price || 0);

  // Renders the digital receipt off-screen, snapshots it as an image, and
  // attaches the uploaded image URL to the payment doc so admins can view it
  // in the "Tenant's Online Receipt" confirmation modal.
  useEffect(() => {
    if (!captureReceipt) return;

    let cancelled = false;

    (async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      try {
        const uri = await captureRef(receiptShotRef, {
          format: "jpg",
          quality: 0.9,
          result: "base64",
        });
        const imageUrl = await uploadReceiptImage(uri);
        if (!cancelled) {
          await updateDoc(doc(db, "payments", captureReceipt.paymentId), {
            receipt: imageUrl,
          });
        }
      } catch (err) {
        console.log("[receipt capture/upload] error:", err);
      } finally {
        if (!cancelled) setCaptureReceipt(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [captureReceipt]);

  useFocusEffect(
    useCallback(() => {
      const user = auth.currentUser;
      if (!user) return;

      loadTenantProfile(user.uid);

      const q = query(
        collection(db, "payments"),
        where("userId", "==", user.uid),
      );

      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const newPayments = snapshot.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }));
          setPayments(newPayments);
          setLoading(false);
        },
        (error) => {
          console.log("PAYMENTS LISTENER ERROR:", error);
          setLoading(false);
        },
      );

      return unsubscribe;
    }, []),
  );

  async function loadTenantProfile(uid: string) {
    try {
      const tenantData = await getTenantData(uid);
      if (!tenantData) return;
      setTenant(tenantData);
      setMustChangePassword(!!tenantData.mustChangePassword);
      if (tenantData.stallId) {
        const stallSnap = await getDoc(doc(db, "stalls", tenantData.stallId));
        if (stallSnap.exists()) {
          setStall({ id: stallSnap.id, ...stallSnap.data() });
        }
      }
    } catch (error) {
      console.log("PROFILE ERROR:", error);
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    const user = auth.currentUser;
    if (user) await loadTenantProfile(user.uid);
    setRefreshing(false);
  }

  function triggerToast(msg: string) {
    setToastMsg(msg);
    toastOpacity.setValue(0);
    setShowToast(true);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 350, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.delay(1800),
      Animated.timing(toastOpacity, { toValue: 0, duration: 350, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(() => setShowToast(false));
  }

  async function handlePaymentSuccess(amountCentavos: number) {
    setShowWebView(false);
    try {
      const user = auth.currentUser;
      if (!user) return;
      const paymentAmount = amountCentavos / 100;
      const sessionId = getPendingCheckoutSession();
      clearPendingCheckoutSession();
      const receiptNo = "RW-ONLINE-" + Date.now().toString().slice(-8);
      const tenantName = tenant ? `${tenant.firstName} ${tenant.lastName}` : "";
      const scheduleRent = computePeriodCharge(
        stall?.price ?? 0,
        stall?.paymentSchedule ?? "monthly",
        new Date(),
      );
      // Paying more than one period's rent in a single transaction counts as
      // an advance payment covering that many future periods.
      const periodsCovered =
        scheduleRent > 0 ? Math.max(1, Math.round(paymentAmount / scheduleRent)) : 1;
      const receiptData = {
        receiptNo,
        tenantName,
        buildingNumber: stall?.buildingNumber ?? "",
        spaceId: stall?.spaceId ?? "",
        paymentMethod: "GCash/Maya",
        date: new Date().toISOString(),
        rentAmount: scheduleRent,
        payment: paymentAmount,
        change: 0,
        status: "PENDING",
      };
      const paymentId = await createPayment({
        userId: user.uid,
        amount: paymentAmount,
        rentAmount: scheduleRent,
        periodsCovered,
        method: "online",
        status: "pending",
        tenantName,
        buildingNumber: stall?.buildingNumber ?? "",
        spaceId: stall?.spaceId ?? "",
        stallId: tenant?.stallId ?? "",
        receiptNo,
        checkoutSessionId: sessionId ?? null,
        paymentMethod: "GCash/Maya",
        receiptData,
        receipt: null,
        paymentId: null,
        cashReceived: null,
        change: 0,
      });
      notifyAdminsOfOnlinePayment(tenantName, paymentAmount, stall?.spaceId ?? "").catch((err) => {
        console.log("[notifyAdminsOfOnlinePayment] error:", err);
      });
      setCaptureReceipt({ paymentId, data: receiptData });
      triggerToast("Payment submitted successfully!");
    } catch (err) {
      console.log("[handlePaymentSuccess] error:", err);
      Alert.alert("Error", "Payment received but could not be recorded. Contact support.");
    }
  }

  function handlePaymentCancel() {
    setShowWebView(false);
    triggerToast("Payment cancelled.");
  }

  async function handleForcedPasswordChange() {
    const pwRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]).{8,12}$/;
    if (!pwRegex.test(newPassword)) {
      setChangePwError("8–12 characters with letters, numbers, and special characters.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setChangePwError("Passwords do not match.");
      return;
    }
    const user = auth.currentUser;
    if (!user) return;
    setChangingPassword(true);
    setChangePwError("");
    try {
      await updatePassword(user, newPassword);
      await updateDoc(doc(db, "users", user.uid), { mustChangePassword: false });
      setMustChangePassword(false);
      setNewPassword("");
      setConfirmNewPassword("");
      triggerToast("Password updated!");
    } catch (err: any) {
      if (err?.code === "auth/requires-recent-login") {
        setChangePwError("Please log out and log in again, then try changing your password.");
      } else {
        setChangePwError("Failed to update password. Please try again.");
      }
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleSignOut() {
    setShowMenu(false);
    await logoutUser();
    router.replace("/login");
  }

  function openMonthPicker() {
    monthPillRef.current?.measure((_x, _y, _w, height, pageX, pageY) => {
      setDropdownTop(pageY + height + 4);
      setDropdownLeft(pageX);
      setShowMonthPicker(true);
    });
  }

  async function handlePayNow() {
    if (!payAmount || Number(payAmount) <= 0) {
      Alert.alert("Error", "Please enter a valid amount");
      return;
    }
    if (!selectedMethod) {
      Alert.alert("Error", "Please choose GCash or Maya");
      return;
    }
    const user = auth.currentUser;
    if (!user) return;

    try {
      setRedirecting(true);
      const tenantName = tenant ? `${tenant.firstName} ${tenant.lastName}` : "";
      const tenantEmail = tenant?.email || auth.currentUser?.email || "";
      const { paymentIntentId, redirectUrl } = await createOnlinePayment(
        Number(payAmount),
        selectedMethod,
        { name: tenantName, email: tenantEmail },
      );
      setPendingCheckoutSession(paymentIntentId);
      setShowPayModal(false);
      setPayAmount("");
      setSelectedMethod(null);
      setWebViewUrl(redirectUrl);
      setShowWebView(true);
    } catch (error) {
      console.log("PAYMONGO ERROR:", error);
      Alert.alert("Error", "Unable to start payment. Please try again.");
    } finally {
      setRedirecting(false);
    }
  }

  function formatDate(date: any) {
    if (!date) return "-";
    const d = date.toDate ? date.toDate() : new Date(date);
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  }

  const successfulPayments = payments.filter((p) => p.status === "approved");

  const paymentHistory = payments.filter(
    (p) =>
      p.status === "approved" ||
      p.status === "pending" ||
      p.status === "rejected",
  );

  const pendingPayments = payments.filter((p) => p.status === "pending");

  const pendingPayment = pendingPayments.reduce(
    (sum, p) => sum + Number(p.amount || 0),
    0,
  );

  const paymentSchedule = stall?.paymentSchedule ?? "monthly";
  const today = new Date();

  // "Remaining Bill": the whole calendar month's total rent (daily rate ×
  // days in month, the same "₱167 × 31 = ₱5,177" total regardless of
  // schedule) minus everything actually paid (approved only) so far *this
  // month*. Resets to a fresh balance every new month.
  const year = today.getFullYear();
  const month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthTotalCharge = periodRate * daysInMonth;

  const paidThisMonth = successfulPayments.reduce((sum, p) => {
    const d = p.date?.toDate ? p.date.toDate() : p.date ? new Date(p.date) : null;
    if (!d || d.getFullYear() !== year || d.getMonth() !== month) return sum;
    return sum + Number(p.amount || 0);
  }, 0);

  const balance = monthTotalCharge - paidThisMonth;
  const remainingBill = balance;

  // "Payment": pacing against the schedule's own periods, so it reflects
  // exactly where the tenant stands as of today — negative (credit) if
  // they're ahead, positive if behind. This is intentionally separate from
  // "Remaining Bill" (the month-total left): paying today immediately shows
  // a same-day credit here, which the month-total figure can't show since
  // it's always measured against the full month.
  const chargedToDate = chargedSinceMonthStart(periodRate, paymentSchedule, today);
  const paymentDue = chargedToDate - paidThisMonth;

  // Blocks re-paying once this month's balance is settled (or ahead), while
  // a payment made this month is still pending admin approval, or if a
  // payment already exists for today's specific period — prevents an
  // accidental duplicate payment for the same day/week/etc. even while the
  // month's overall balance still has room left.
  const hasPendingThisMonth = pendingPayments.some((p) => {
    const d = p.date?.toDate ? p.date.toDate() : p.date ? new Date(p.date) : null;
    if (!d) return false;
    return d.getFullYear() === year && d.getMonth() === month;
  });
  const hasPaidForCurrentSpecificPeriod = payments.some((p) => {
    if (p.status !== "approved" && p.status !== "pending") return false;
    const d = p.date?.toDate ? p.date.toDate() : p.date ? new Date(p.date) : null;
    if (!d) return false;
    return isSamePeriod(paymentSchedule, d, today);
  });
  const hasPaidCurrentPeriod =
    balance <= 0 || hasPendingThisMonth || hasPaidForCurrentSpecificPeriod;

  const history = paymentHistory
    .filter((p) => {
      if (!p.date) return false;
      const d = p.date.toDate ? p.date.toDate() : new Date(p.date);
      return MONTHS[d.getMonth()] === selectedMonth;
    })
    .sort(
      (a, b) =>
        new Date(b.date?.toDate ? b.date.toDate() : b.date).getTime() -
        new Date(a.date?.toDate ? a.date.toDate() : a.date).getTime(),
    );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0F6E56" />
      </View>
    );
  }

  function openReceipt(payment: any) {
    setSelectedPayment(payment);
    setShowReceiptModal(true);
  }

  return (
    <View style={styles.root}>
      <StatusBar
        barStyle="light-content"
        backgroundColor="transparent"
        translucent
      />

      {/* HEADER */}
      <View style={[styles.header, { paddingTop: topInset + 14 }]}>
        <Text style={styles.headerTitle}>RentWise</Text>
        <BellIcon />
      </View>

      {/* PROFILE BANNER */}
      <View style={styles.banner}>
        <View style={styles.bannerInfo}>
          <Text style={styles.bannerWelcome}>Welcome, tenant!</Text>
          <Text style={styles.bannerName}>
            {tenant?.firstName} {tenant?.lastName}
          </Text>
        </View>
        <TouchableOpacity style={styles.menuBtn} onPress={() => setShowMenu(true)}>
          <Ionicons name="ellipsis-horizontal" size={20} color="#E1F5EE" />
        </TouchableOpacity>
      </View>

      {/* BODY */}
      <ScrollView
        style={styles.body}
        contentContainerStyle={[
          styles.bodyContent,
          { paddingBottom: insets.bottom + 16 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* CARD 1 — Rental payment information */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Rental payment information</Text>

          <View style={[styles.infoRow, styles.infoRowBorder]}>
            <Text style={styles.infoLabel}>Payment</Text>
            <Text style={styles.infoValue}>
              {paymentDue < 0 ? "-" : ""}₱{Math.abs(paymentDue).toLocaleString()}
            </Text>
          </View>

          <View style={[styles.infoRow, styles.infoRowBorder]}>
            <Text style={styles.infoLabel}>Payment Schedule</Text>
            <Text style={styles.infoValue}>
              {stall?.paymentSchedule
                ? stall.paymentSchedule.charAt(0).toUpperCase() + stall.paymentSchedule.slice(1)
                : "—"}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Remaining Bill</Text>
            <Text style={[styles.infoValue, styles.remaining]}>
              ₱{remainingBill.toLocaleString()}
            </Text>
          </View>
        </View>

        {/* CARD 2 — Monthly payment history */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Monthly payment history</Text>

          <View ref={monthPillRef} collapsable={false} style={styles.monthPickerWrapper}>
            <TouchableOpacity
              style={styles.monthPill}
              onPress={openMonthPicker}
            >
              <Text style={styles.monthPillText}>Month: {selectedMonth}</Text>
              <Ionicons
                name={showMonthPicker ? "chevron-up" : "chevron-down"}
                size={14}
                color="#0F6E56"
              />
            </TouchableOpacity>
          </View>

          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Date</Text>
            <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Status</Text>
            <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: "right" }]}>
              Receipt
            </Text>
          </View>

          {history.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>
                No payments for {selectedMonth}
              </Text>
            </View>
          ) : (
            <FlatList
              data={history}
              keyExtractor={(item, index) => item.id || index.toString()}
              scrollEnabled={false}
              renderItem={({ item, index }) => (
                <View
                  style={[
                    styles.tableRow,
                    index === history.length - 1 && { borderBottomWidth: 0 },
                  ]}
                >
                  <Text style={[styles.dateCell, { flex: 2 }]}>
                    {formatDate(item.date)}
                  </Text>

                  <View style={{ flex: 2 }}>
                    <View
                      style={[
                        styles.statusBadge,
                        item.status === "approved"
                          ? styles.badgeApproved
                          : item.status === "rejected"
                            ? styles.badgeRejected
                            : styles.badgePending,
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusBadgeText,
                          item.status === "approved"
                            ? styles.textApproved
                            : item.status === "rejected"
                              ? styles.textRejected
                              : styles.textPending,
                        ]}
                      >
                        {item.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>

                  <View style={{ flex: 1, alignItems: "flex-end" }}>
                    {item.receiptData || item.receipt ? (
                      <TouchableOpacity onPress={() => openReceipt(item)}>
                        <Ionicons name="receipt-outline" size={20} color="#1D9E75" />
                      </TouchableOpacity>
                    ) : (
                      <Text style={styles.noReceipt}>—</Text>
                    )}
                  </View>
                </View>
              )}
            />
          )}
        </View>
      </ScrollView>

      {/* FORCED PASSWORD CHANGE MODAL */}
      <Modal visible={mustChangePassword} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={styles.payOverlay}>
          <View style={styles.payCard}>
            <Text style={styles.payTitle}>Set a new password</Text>
            <Text style={styles.payHint}>
              Your account is using the default password. Please set a new
              password to continue.
            </Text>

            <Text style={styles.payLabel}>New Password</Text>
            <View style={styles.pwRow}>
              <TextInput
                style={styles.pwRowInput}
                value={newPassword}
                onChangeText={(t) => { setNewPassword(t); setChangePwError(""); }}
                secureTextEntry={!showNewPassword}
                placeholder="New password"
                placeholderTextColor="#B4B2A9"
                autoCapitalize="none"
                maxLength={12}
                editable={!changingPassword}
              />
              <TouchableOpacity onPress={() => setShowNewPassword((v) => !v)}>
                <Ionicons name={showNewPassword ? "eye-outline" : "eye-off-outline"} size={18} color="#1D9E75" />
              </TouchableOpacity>
            </View>

            <Text style={styles.payLabel}>Confirm Password</Text>
            <View style={styles.pwRow}>
              <TextInput
                style={styles.pwRowInput}
                value={confirmNewPassword}
                onChangeText={(t) => { setConfirmNewPassword(t); setChangePwError(""); }}
                secureTextEntry={!showConfirmNewPassword}
                placeholder="Confirm new password"
                placeholderTextColor="#B4B2A9"
                autoCapitalize="none"
                maxLength={12}
                editable={!changingPassword}
              />
              <TouchableOpacity onPress={() => setShowConfirmNewPassword((v) => !v)}>
                <Ionicons name={showConfirmNewPassword ? "eye-outline" : "eye-off-outline"} size={18} color="#1D9E75" />
              </TouchableOpacity>
            </View>

            {changePwError ? (
              <Text style={styles.pwErrorText}>{changePwError}</Text>
            ) : null}

            <TouchableOpacity
              style={[styles.payNowBtn, changingPassword && styles.payNowBtnDisabled]}
              disabled={changingPassword}
              onPress={handleForcedPasswordChange}
            >
              {changingPassword ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.payNowText}>Change Password</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MENU MODAL */}
      <Modal visible={showMenu} transparent animationType="fade">
        <TouchableOpacity
          style={styles.menuOverlay}
          activeOpacity={1}
          onPress={() => setShowMenu(false)}
        >
          <View style={[styles.menuCard, { top: insets.top + 60, right: 16 }]}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setShowMenu(false);
                router.push("/profile");
              }}
            >
              <Text style={styles.menuItemText}>Manage Profile</Text>
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setShowMenu(false);
                if (hasPaidCurrentPeriod) {
                  Alert.alert(
                    "Already Paid",
                    "You've already paid or have a pending payment for this period.",
                  );
                  return;
                }
                setShowPayModal(true);
              }}
            >
              <Text
                style={[
                  styles.menuItemText,
                  hasPaidCurrentPeriod && styles.menuItemTextDisabled,
                ]}
              >
                Pay Online
              </Text>
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity style={styles.menuItem} onPress={handleSignOut}>
              <Text style={[styles.menuItemText, styles.signOutText]}>
                Sign Out
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* PAY ONLINE MODAL */}
      <Modal visible={showPayModal} transparent animationType="fade">
        <View style={styles.payOverlay}>
          <View style={styles.payCard}>
            <Text style={styles.payTitle}>Pay Online</Text>

            <Text style={styles.payLabel}>Amount</Text>

            <TextInput
              style={styles.payInput}
              placeholder="Enter amount"
              keyboardType="numeric"
              value={payAmount}
              onChangeText={setPayAmount}
            />

            <Text style={styles.payLabel}>Payment Method</Text>
            <View style={styles.methodRow}>
              <TouchableOpacity
                style={[
                  styles.methodOption,
                  selectedMethod === "gcash" && styles.methodOptionSelected,
                ]}
                onPress={() => setSelectedMethod("gcash")}
              >
                <Text
                  style={[
                    styles.methodOptionText,
                    selectedMethod === "gcash" && styles.methodOptionTextSelected,
                  ]}
                >
                  GCash
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.methodOption,
                  selectedMethod === "paymaya" && styles.methodOptionSelected,
                ]}
                onPress={() => setSelectedMethod("paymaya")}
              >
                <Text
                  style={[
                    styles.methodOptionText,
                    selectedMethod === "paymaya" && styles.methodOptionTextSelected,
                  ]}
                >
                  Maya
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[
                styles.payNowBtn,
                (redirecting || !selectedMethod) && styles.payNowBtnDisabled,
              ]}
              disabled={redirecting || !selectedMethod}
              onPress={handlePayNow}
            >
              <Text style={styles.payNowText}>
                {redirecting ? "Opening payment..." : "Pay Now"}
              </Text>
            </TouchableOpacity>

            <Text style={styles.payHint}>
              Complete your payment via GCash or Maya in the secure payment
              page. A receipt will be generated automatically after successful
              payment.
            </Text>

            <TouchableOpacity
              style={[styles.cancelBtn, { marginTop: 8 }]}
              onPress={() => {
                setShowPayModal(false);
                setPayAmount("");
                setSelectedMethod(null);
              }}
            >
              <Text style={styles.cancelBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* RECEIPT PREVIEW MODAL */}
      <Modal visible={showReceiptModal} transparent animationType="fade">
        <View style={styles.receiptOverlay}>
          <View style={styles.receiptPreviewCard}>
            <Text style={styles.payTitle}>Payment Receipt</Text>

            <ScrollView
              style={styles.receiptScrollArea}
              showsVerticalScrollIndicator={false}
            >
              {selectedPayment?.receiptData ? (
                <ReceiptCardContent data={selectedPayment.receiptData} />
              ) : selectedPayment?.receipt ? (
                <Image
                  source={{ uri: selectedPayment.receipt }}
                  style={styles.receiptImage}
                />
              ) : null}
            </ScrollView>

            <TouchableOpacity
              style={styles.receiptCloseBtn}
              onPress={() => {
                setShowReceiptModal(false);
                setSelectedPayment(null);
              }}
            >
              <Text style={styles.receiptCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* WEBVIEW PAYMENT MODAL */}
      <Modal visible={showWebView} animationType="slide" onRequestClose={handlePaymentCancel}>
        <View style={styles.webViewContainer}>
          <View style={[styles.webViewHeader, { paddingTop: insets.top + 6 }]}>
            <Text style={styles.webViewTitle}>Pay Online</Text>
            <TouchableOpacity style={styles.webViewClose} onPress={handlePaymentCancel} activeOpacity={0.7}>
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
          <WebView
            source={{ uri: webViewUrl }}
            style={{ flex: 1 }}
            onLoadStart={() => setWebViewLoading(true)}
            onLoadEnd={() => setWebViewLoading(false)}
            onShouldStartLoadWithRequest={(req) => {
              const url = req.url;
              if (url.startsWith("rentwise://")) {
                if (url.includes("payment-success")) {
                  const match = url.match(/[?&]amount=(\d+)/);
                  const centavos = match ? parseInt(match[1], 10) : 0;
                  handlePaymentSuccess(centavos);
                } else {
                  handlePaymentCancel();
                }
                return false;
              }
              // GCash hands off to its own app via a gcash:// scheme URL when
              // installed — a WebView can't load that directly, so open it
              // via the OS instead (PayMongo's documented fix for this).
              if (!url.startsWith("http://") && !url.startsWith("https://")) {
                Linking.openURL(url).catch(() => {
                  Alert.alert(
                    "App not found",
                    "Please install the GCash or Maya app, or complete payment using the web option shown on the page.",
                  );
                });
                return false;
              }
              return true;
            }}
          />
          {webViewLoading && (
            <View style={styles.webViewSpinner}>
              <ActivityIndicator size="large" color="#0F6E56" />
            </View>
          )}
        </View>
      </Modal>

      {/* MONTH DROPDOWN */}
      <Modal visible={showMonthPicker} transparent animationType="none">
        <TouchableOpacity
          style={{ flex: 1 }}
          activeOpacity={1}
          onPress={() => setShowMonthPicker(false)}
        >
          <View style={[styles.monthDropdown, { top: dropdownTop, left: dropdownLeft }]}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              style={styles.monthDropdownScroll}
            >
              {MONTHS.map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[
                    styles.monthDropdownItem,
                    m === selectedMonth && styles.monthDropdownItemActive,
                  ]}
                  onPress={() => {
                    setSelectedMonth(m);
                    setShowMonthPicker(false);
                  }}
                >
                  <Text
                    style={[
                      styles.monthDropdownText,
                      m === selectedMonth && styles.monthDropdownTextActive,
                    ]}
                  >
                    {m}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {showToast && (
        <Animated.View style={[styles.toastOverlay, { opacity: toastOpacity }]}>
          <View style={styles.toastBox}>
            <Ionicons name="checkmark-circle" size={20} color="#0F6E56" style={{ marginRight: 8 }} />
            <Text style={styles.toastText}>{toastMsg}</Text>
          </View>
        </Animated.View>
      )}

      {captureReceipt && (
        <View style={styles.receiptCaptureOffscreen} pointerEvents="none">
          <View ref={receiptShotRef} collapsable={false} style={styles.receiptCaptureCard}>
            <Text style={styles.payTitle}>Payment Receipt</Text>
            <ReceiptCardContent data={captureReceipt.data} />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0F6E56",
  },

  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F1EFE8",
  },

  // ── Header ──────────────────────────────────────
  header: {
    backgroundColor: "#0F6E56",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 14,
  },

  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "500",
  },

  // ── Profile banner ───────────────────────────────
  banner: {
    backgroundColor: "#1D9E75",
    paddingHorizontal: 20,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },

  bannerInfo: {
    flex: 1,
  },

  bannerWelcome: {
    color: "#9FE1CB",
    fontSize: 12,
    fontWeight: "400",
  },

  bannerName: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "500",
  },

  menuBtn: {
    padding: 4,
  },

  // ── Body ────────────────────────────────────────
  body: {
    flex: 1,
    backgroundColor: "#F1EFE8",
  },

  bodyContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
    gap: 16,
  },

  // ── Cards ────────────────────────────────────────
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 18,
    borderWidth: 0.5,
    borderColor: "#9FE1CB",
  },

  cardTitle: {
    fontSize: 15,
    fontWeight: "500",
    color: "#085041",
    marginBottom: 14,
  },

  // ── Info rows ────────────────────────────────────
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },

  infoRowBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: "#E1F5EE",
  },

  infoLabel: {
    fontSize: 14,
    color: "#888780",
  },

  infoValue: {
    fontSize: 14,
    fontWeight: "500",
    color: "#085041",
  },

  remaining: {
    color: "#E24B4A",
  },

  // ── Month pill ───────────────────────────────────
  monthPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#E1F5EE",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    gap: 4,
  },

  monthPillText: {
    fontSize: 13,
    color: "#0F6E56",
    fontWeight: "500",
  },

  // ── Table ────────────────────────────────────────
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#F1EFE8",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 12,
  },

  tableHeaderCell: {
    fontSize: 12,
    fontWeight: "500",
    color: "#5F5E5A",
  },

  tableRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderBottomWidth: 0.5,
    borderBottomColor: "#E1F5EE",
  },

  dateCell: {
    fontSize: 14,
    color: "#444441",
  },

  statusBadge: {
    alignSelf: "flex-start",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },

  badgeApproved: { backgroundColor: "#E1F5EE" },
  badgePending: { backgroundColor: "#FAEEDA" },
  badgeRejected: { backgroundColor: "#FCEBEB" },

  statusBadgeText: {
    fontSize: 11,
    fontWeight: "500",
  },

  textApproved: { color: "#0F6E56" },
  textPending: { color: "#BA7517" },
  textRejected: { color: "#A32D2D" },

  noReceipt: {
    color: "#B4B2A9",
    fontSize: 13,
  },

  emptyRow: {
    paddingVertical: 24,
    alignItems: "center",
  },

  emptyText: {
    fontSize: 14,
    color: "#888780",
  },

  // ── Menu modal ───────────────────────────────────
  menuOverlay: {
    flex: 1,
  },

  menuCard: {
    position: "absolute",
    backgroundColor: "#fff",
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
    minWidth: 160,
  },

  menuItem: {
    paddingVertical: 14,
    paddingHorizontal: 18,
  },

  menuItemText: {
    fontSize: 14,
    color: "#085041",
  },

  menuItemTextDisabled: {
    color: "#B4B2A9",
  },

  signOutText: {
    color: "#E24B4A",
  },

  menuDivider: {
    height: 0.5,
    backgroundColor: "#E1F5EE",
  },

  // ── Pay modal ────────────────────────────────────
  payOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,.5)",
    justifyContent: "center",
    padding: 24,
  },

  payCard: {
    backgroundColor: "#fff",
    padding: 24,
    borderRadius: 14,
  },

  payTitle: {
    textAlign: "center",
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 20,
    color: "#085041",
  },

  payLabel: {
    fontSize: 13,
    color: "#888780",
    marginBottom: 6,
    marginTop: 10,
    fontWeight: "500",
  },

  payInput: {
    borderWidth: 1.5,
    borderColor: "#9FE1CB",
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#f7fdf9",
    color: "#085041",
    fontSize: 15,
  },

  methodRow: {
    flexDirection: "row",
    gap: 10,
  },
  methodOption: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: "#9FE1CB",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#f7fdf9",
  },
  methodOptionSelected: {
    borderColor: "#0F6E56",
    backgroundColor: "#0F6E56",
  },
  methodOptionText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#085041",
  },
  methodOptionTextSelected: {
    color: "#fff",
  },

  payNowBtn: {
    backgroundColor: "#0F6E56",
    padding: 14,
    borderRadius: 10,
    marginTop: 12,
    alignItems: "center",
  },

  payNowBtnDisabled: {
    opacity: 0.5,
  },

  payNowText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 15,
  },

  payHint: {
    fontSize: 12,
    color: "#888780",
    marginTop: 10,
    marginBottom: 8,
    lineHeight: 17,
  },

  cancelBtn: {
    backgroundColor: "#F1EFE8",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },

  cancelBtnText: {
    color: "#085041",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },

  pwRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#9FE1CB",
    borderRadius: 10,
    backgroundColor: "#f7fdf9",
    paddingHorizontal: 12,
  },
  pwRowInput: {
    flex: 1,
    paddingVertical: 12,
    color: "#085041",
    fontSize: 15,
  },
  pwErrorText: {
    color: "#A32D2D",
    fontSize: 12,
    marginTop: 8,
  },

  // ── Receipt modal ────────────────────────────────
  receiptOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,.5)",
    justifyContent: "center",
    padding: 25,
  },

  receiptPreviewCard: {
    backgroundColor: "#fff",
    padding: 20,
    borderRadius: 14,
  },

  receiptScrollArea: {
    maxHeight: 360,
    marginBottom: 12,
  },

  receiptFields: {
    width: "100%",
    marginBottom: 12,
  },

  receiptFieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: "#E1F5EE",
  },

  receiptFieldLabel: {
    fontSize: 13,
    color: "#888780",
  },

  receiptFieldValue: {
    fontSize: 13,
    fontWeight: "600",
    color: "#085041",
    flexShrink: 1,
    textAlign: "right",
  },

  receiptImage: {
    width: "100%",
    height: 350,
    resizeMode: "contain",
  },

  receiptCaptureOffscreen: {
    position: "absolute",
    top: 0,
    left: -2000,
  },

  receiptCaptureCard: {
    width: 320,
    backgroundColor: "#fff",
    padding: 20,
  },

  receiptCloseBtn: {
    backgroundColor: "#0F6E56",
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: "center",
  },

  receiptCloseBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },

  // ── Month dropdown ───────────────────────────────
  monthPickerWrapper: {
    alignSelf: "flex-start",
  },

  monthDropdown: {
    position: "absolute",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: "#9FE1CB",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 6,
    overflow: "hidden",
    minWidth: 160,
  },

  monthDropdownScroll: {
    maxHeight: 132,
  },

  monthDropdownItem: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: 0.5,
    borderBottomColor: "#E1F5EE",
  },

  monthDropdownItemActive: {
    backgroundColor: "#E1F5EE",
  },

  monthDropdownText: {
    fontSize: 14,
    color: "#444441",
  },

  monthDropdownTextActive: {
    color: "#0F6E56",
    fontWeight: "500",
  },

  // ── WebView modal ────────────────────────────────
  webViewContainer: {
    flex: 1,
    backgroundColor: "#fff",
  },
  webViewHeader: {
    backgroundColor: "#0F6E56",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  webViewTitle: {
    flex: 1,
    textAlign: "center",
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  webViewClose: {
    padding: 4,
  },
  webViewSpinner: {
    ...StyleSheet.absoluteFill,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.75)",
  },

  // ── Toast ─────────────────────────────────────────
  toastOverlay: {
    position: "absolute",
    bottom: 48,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  toastBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 6,
  },
  toastText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#085041",
  },
});
