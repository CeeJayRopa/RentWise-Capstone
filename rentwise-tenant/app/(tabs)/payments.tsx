import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  ScrollView,
  StatusBar,
  Animated,
  Easing,
  Linking,
  RefreshControl,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { WebView } from "react-native-webview";
import { captureRef } from "react-native-view-shot";

import { collection, doc, getDoc, onSnapshot, query, updateDoc, where } from "firebase/firestore";

import { db } from "../../shared/services/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback, useEffect, useRef, useState } from "react";

import { auth } from "../../shared/firebaseConfig";
import { getTenantData } from "../../services/tenantService";
import { createOnlinePayment, createPayment } from "../../services/paymentService";
import { uploadReceiptImage } from "../../services/storageService";
import {
  setPendingCheckoutSession,
  getPendingCheckoutSession,
  clearPendingCheckoutSession,
  setPendingPaymentMethod,
  getPendingPaymentMethod,
  clearPendingPaymentMethod,
} from "../../services/pendingPayment";
import {
  computePeriodCharge,
  chargedSinceMonthStart,
  isSamePeriod,
  nextPeriodStart,
  consecutivePeriodsEnding,
  periodLabel,
} from "../../services/billingSchedule";

import { router, useFocusEffect } from "expo-router";
import {
  History,
  X,
  CheckCircle2,
  ShieldCheck,
  Info,
  Zap,
  Lock,
  Check,
  HelpCircle,
} from "lucide-react-native";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";

import ReceiptCardContent from "../components/ReceiptCardContent";
import HelpTour, { HelpStep } from "../components/HelpTour";
import { hasSeenPageTour, markPageTourSeen } from "../../shared/services/onboardingTour";

export default function PaymentsScreen() {
  const insets = useSafeAreaInsets();
  const topInset = insets.top > 0 ? insets.top : (StatusBar.currentHeight ?? 24);

  const [tenant, setTenant] = useState<any>(null);
  const [stall, setStall] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [payAmount, setPayAmount] = useState("");
  // Tracks whether the tenant has ever typed in the amount field -- before
  // that, the field shows the live computed default; after, it shows
  // exactly what they typed (including empty while erasing), so nothing
  // fights their keystrokes. See the TextInput below.
  const [hasEditedAmount, setHasEditedAmount] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<"gcash" | "paymaya" | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  const [showWebView, setShowWebView] = useState(false);
  const [webViewUrl, setWebViewUrl] = useState("");
  const [webViewLoading, setWebViewLoading] = useState(false);

  const [toastMsg, setToastMsg] = useState("");
  const [showToast, setShowToast] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;

  const [captureReceipt, setCaptureReceipt] = useState<{ paymentId: string; data: any } | null>(null);
  const receiptShotRef = useRef<View>(null);

  const [tourVisible, setTourVisible] = useState(false);
  const helpRef = useRef<View>(null);
  const historyRef = useRef<View>(null);
  const amountRef = useRef<View>(null);
  const methodRef = useRef<View>(null);
  const payBtnRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Scrolls a given section into view and gives the ScrollView time to
  // settle before HelpTour measures it — otherwise a section below the
  // fold (e.g. the Pay Now button, once the amount/method cards push it
  // down) would measure to its stale, off-screen position, and its
  // spotlight would bleed past the visible screen edge into the bottom nav.
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

  const periodRate = Number(stall?.price || 0);

  useFocusEffect(
    useCallback(() => {
      const user = auth.currentUser;
      if (!user) return;

      loadTenantProfile(user.uid);

      const q = query(collection(db, "payments"), where("userId", "==", user.uid));
      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          setPayments(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
          setLoading(false);
        },
        (error) => {
          console.log("PAYMENTS LISTENER ERROR:", error);
          setLoading(false);
        },
      );

      return unsubscribe;
    }, [])
  );

  // Auto-opens the guided tour the first time the tenant ever lands on this
  // page — never again after that, since it flips a persisted per-device
  // flag. Can still be replayed anytime via the Help button.
  useEffect(() => {
    if (loading) return;
    (async () => {
      const seen = await hasSeenPageTour("tenant-payments");
      if (!seen) {
        setTourVisible(true);
        await markPageTourSeen("tenant-payments");
      }
    })();
  }, [loading]);

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

  async function loadTenantProfile(uid: string) {
    try {
      const tenantData = await getTenantData(uid);
      if (!tenantData) return;
      setTenant(tenantData);
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

  // The page isn't scrollable, so there's no pull-to-refresh gesture —
  // this button re-fetches tenant/stall data the same way that used to.
  async function handleRefresh() {
    if (refreshing) return;
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

  const successfulPayments = payments.filter((p) => p.status === "approved");
  const pendingPayments = payments.filter((p) => p.status === "pending");

  const paymentSchedule = stall?.paymentSchedule ?? "monthly";
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthTotalCharge = periodRate * daysInMonth;

  const paidThisMonth = successfulPayments.reduce((sum, p) => {
    const d = p.date?.toDate ? p.date.toDate() : p.date ? new Date(p.date) : null;
    if (!d || d.getFullYear() !== year || d.getMonth() !== month) return sum;
    return sum + Number(p.amount || 0);
  }, 0);

  const remainingBill = monthTotalCharge - paidThisMonth;

  const chargedToDate = chargedSinceMonthStart(periodRate, paymentSchedule, today);
  const paymentDue = chargedToDate - paidThisMonth;

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
  const beforeSemiMonthlyDueDate = paymentSchedule === "semi-monthly" && today.getDate() < 15;

  const hasPaidCurrentPeriod =
    remainingBill <= 0 || hasPendingThisMonth || hasPaidForCurrentSpecificPeriod || beforeSemiMonthlyDueDate;

  const tourSteps: HelpStep[] = [
    { key: "help", ref: helpRef, title: "Help", description: "Come back here anytime for a guided tour of this page.", offsetY: 41, round: true },
    { key: "history", ref: historyRef, title: "Payment history", description: "View past payments and download receipts.", offsetY: 41, round: true },
    ...(!hasPaidCurrentPeriod
      ? [
          { key: "amount", ref: amountRef, title: "Enter amount", description: "Pre-filled with what's currently due. You can pay more, but not less.", offsetY: 41, onBeforeMeasure: () => scrollSectionIntoView(amountRef) },
          { key: "method", ref: methodRef, title: "Payment method", description: "Choose GCash or Maya to pay online.", offsetY: 41, onBeforeMeasure: () => scrollSectionIntoView(methodRef) },
          { key: "pay", ref: payBtnRef, title: "Pay Now", description: "Redirects you to your chosen e-wallet to confirm the transaction. A receipt is auto-saved to your history.", offsetY: 41, onBeforeMeasure: () => scrollSectionIntoView(payBtnRef) },
        ]
      : []),
  ];

  async function handlePayNow() {
    // The amount field falls back to displaying the computed `paymentDue`
    // whenever the tenant hasn't typed their own value — so the amount
    // actually being paid must fall back the same way, or a tenant who
    // never touched the field (because the pre-filled amount was already
    // correct) would fail this check despite the field showing a valid,
    // correct value.
    const effectiveAmount = payAmount ? Number(payAmount) : Math.round(paymentDue);

    if (!effectiveAmount || effectiveAmount <= 0) {
      Alert.alert("Error", "Please enter a valid amount");
      return;
    }
    if (paymentDue > 0 && effectiveAmount < paymentDue) {
      Alert.alert(
        "Amount too low",
        `Please enter at least ₱${Math.round(paymentDue).toLocaleString()} — partial payments are no longer accepted.`,
      );
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
        effectiveAmount,
        selectedMethod,
        { name: tenantName, email: tenantEmail },
      );
      setPendingCheckoutSession(paymentIntentId);
      setPendingPaymentMethod(selectedMethod);
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

  async function handlePaymentSuccess(amountCentavos: number) {
    setShowWebView(false);
    try {
      const user = auth.currentUser;
      if (!user) return;
      const paymentAmount = amountCentavos / 100;
      const sessionId = getPendingCheckoutSession();
      clearPendingCheckoutSession();
      const pendingMethod = getPendingPaymentMethod();
      clearPendingPaymentMethod();
      const paymentMethodLabel = pendingMethod === "gcash" ? "GCash" : pendingMethod === "paymaya" ? "Maya" : "GCash/Maya";
      const receiptNo = "RW-ONLINE-" + Date.now().toString().slice(-8);
      const tenantName = tenant ? `${tenant.firstName} ${tenant.lastName}` : "";
      const schedule = stall?.paymentSchedule ?? "monthly";
      const scheduleRent = computePeriodCharge(stall?.price ?? 0, schedule, new Date());
      const owedAmount = Math.max(paymentDue, scheduleRent || 0);
      const periodsOwed =
        scheduleRent > 0 ? Math.max(1, Math.round(owedAmount / scheduleRent)) : 1;
      const advanceAmount = Math.max(0, paymentAmount - owedAmount);
      const periodsAdvance =
        scheduleRent > 0 ? Math.round(advanceAmount / scheduleRent) : 0;
      const periodsCovered = periodsOwed + periodsAdvance;

      // Itemizes exactly which period(s) this payment covers — including
      // any consecutive unpaid days/periods before today — so the tenant
      // can see why the total is what it is instead of one lump sum.
      const today = new Date();
      const owedBreakdown = consecutivePeriodsEnding(stall?.price ?? 0, schedule, today, periodsOwed).map((p) => ({
        label: periodLabel(schedule, p.date),
        amount: p.amount,
      }));
      let advanceCursor = nextPeriodStart(schedule, today);
      const advanceBreakdown: { label: string; amount: number }[] = [];
      for (let i = 0; i < periodsAdvance; i++) {
        advanceBreakdown.push({
          label: `Advance – ${periodLabel(schedule, advanceCursor)}`,
          amount: computePeriodCharge(stall?.price ?? 0, schedule, advanceCursor),
        });
        advanceCursor = nextPeriodStart(schedule, advanceCursor);
      }
      const breakdown = [...owedBreakdown, ...advanceBreakdown];

      const receiptData = {
        receiptNo,
        tenantName,
        buildingNumber: stall?.buildingNumber ?? "",
        spaceId: stall?.spaceId ?? "",
        paymentMethod: paymentMethodLabel,
        date: new Date().toISOString(),
        rentAmount: scheduleRent,
        payment: paymentAmount,
        change: 0,
        status: "PENDING",
        breakdown,
      };
      const paymentId = await createPayment({
        userId: user.uid,
        amount: paymentAmount,
        rentAmount: scheduleRent,
        periodsCovered,
        periodsAdvance,
        method: "online",
        status: "pending",
        tenantName,
        buildingNumber: stall?.buildingNumber ?? "",
        spaceId: stall?.spaceId ?? "",
        stallId: tenant?.stallId ?? "",
        receiptNo,
        checkoutSessionId: sessionId ?? null,
        paymentMethod: paymentMethodLabel,
        receiptData,
        receipt: null,
        paymentId: null,
        cashReceived: null,
        change: 0,
      });
      // Admins are notified server-side by the notifyAdminsOnPayment Cloud
      // Function trigger (functions/src/paymentNotifier.ts), which fires
      // reliably on payment-doc creation regardless of client path.
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.emerald} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <LinearGradient
        colors={[colors.emerald, colors.ink]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={[styles.header, { paddingTop: topInset + 14 }]}>
          <View style={{ width: 86 }} />
          <Text style={styles.headerTitle}>Payment Center</Text>
          <View style={styles.headerActions}>
            <View ref={historyRef} collapsable={false}>
              <TouchableOpacity
                style={styles.historyBtn}
                onPress={() => router.push("/payment-history")}
                activeOpacity={0.7}
              >
                <History size={18} color={colors.white} />
              </TouchableOpacity>
            </View>
            <View ref={helpRef} collapsable={false}>
              <TouchableOpacity
                style={styles.historyBtn}
                onPress={() => setTourVisible(true)}
                activeOpacity={0.7}
              >
                <HelpCircle size={18} color={colors.white} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Total Balance Due</Text>
          <Text style={styles.balanceAmount}>₱{remainingBill.toLocaleString()}.00</Text>
        </View>
      </LinearGradient>

      <ScrollView
        ref={scrollRef}
        style={styles.body}
        contentContainerStyle={[styles.bodyContent, { paddingBottom: insets.bottom + 20 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.emerald} />
        }
      >
        {hasPaidCurrentPeriod ? (
          <View style={styles.caughtUpCard}>
            <CheckCircle2 size={28} color={colors.emerald} />
            <Text style={styles.caughtUpTitle}>
              {beforeSemiMonthlyDueDate ? "Nothing due yet" : "You're all caught up"}
            </Text>
            <Text style={styles.caughtUpText}>
              {beforeSemiMonthlyDueDate
                ? "Your next payment isn't due until the 15th."
                : "You've already paid or have a pending payment for this period."}
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.amountCard} ref={amountRef} collapsable={false}>
              <View style={styles.amountCardHeader}>
                <Text style={styles.amountCardTitle}>Enter amount</Text>
                <Text style={styles.amountCardCurrency}>PHP</Text>
              </View>

              <View style={styles.amountBox}>
                <Text style={styles.amountPeso}>₱</Text>
                <TextInput
                  style={styles.amountInput}
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                  value={hasEditedAmount ? payAmount : (paymentDue > 0 ? String(Math.round(paymentDue)) : "")}
                  onChangeText={(text) => {
                    if (!hasEditedAmount) setHasEditedAmount(true);
                    setPayAmount(text);
                  }}
                />
              </View>
            </View>

            <View style={styles.methodCard} ref={methodRef} collapsable={false}>
              <View style={styles.methodCardHeader}>
                <Text style={styles.methodCardTitle}>Payment method</Text>
                <View style={styles.securedBadge}>
                  <ShieldCheck size={13} color={colors.emerald} />
                  <Text style={styles.securedBadgeText}>Secured</Text>
                </View>
              </View>

              <Pressable
                style={[styles.methodOptionCard, selectedMethod === "gcash" && styles.methodOptionCardSelected]}
                onPress={() => setSelectedMethod("gcash")}
              >
                <View style={styles.methodBrandIcon}>
                  <Image source={require("../../assets/gcash.png")} style={styles.methodBrandIconImage} resizeMode="cover" />
                </View>
                <View style={styles.methodOptionInfo}>
                  <Text style={styles.methodOptionName}>GCash</Text>
                  <Text style={styles.methodOptionSub}>Fastest · No fees</Text>
                </View>
                <View style={[styles.radioOuter, selectedMethod === "gcash" && styles.radioOuterSelected]}>
                  {selectedMethod === "gcash" && <Check size={13} color={colors.white} />}
                </View>
              </Pressable>

              <Pressable
                style={[styles.methodOptionCard, selectedMethod === "paymaya" && styles.methodOptionCardSelected]}
                onPress={() => setSelectedMethod("paymaya")}
              >
                <View style={[styles.methodBrandIcon, styles.methodBrandIconDark]}>
                  <Image source={require("../../assets/maya-icon.png")} style={styles.methodBrandIconImage} resizeMode="contain" />
                </View>
                <View style={styles.methodOptionInfo}>
                  <Text style={styles.methodOptionName}>Maya</Text>
                  <Text style={styles.methodOptionSub}>Instant transfer</Text>
                </View>
                <View style={[styles.radioOuter, selectedMethod === "paymaya" && styles.radioOuterSelected]}>
                  {selectedMethod === "paymaya" && <Check size={13} color={colors.white} />}
                </View>
              </Pressable>

              {selectedMethod && (
                <View style={styles.methodInfoBanner}>
                  <Info size={15} color={colors.textSecondary} />
                  <Text style={styles.methodInfoText}>
                    You'll be redirected to {selectedMethod === "gcash" ? "GCash" : "Maya"} to confirm
                    the transaction. A receipt is auto-saved to your history.
                  </Text>
                </View>
              )}
            </View>

            <TouchableOpacity
              ref={payBtnRef}
              style={[styles.payNowInlineBtn, (redirecting || !selectedMethod) && styles.payNowInlineBtnDisabled]}
              disabled={redirecting || !selectedMethod}
              onPress={handlePayNow}
            >
              <Zap size={16} color={colors.white} />
              <Text style={styles.payNowInlineText} numberOfLines={1}>
                {redirecting
                  ? "Opening payment..."
                  : `Pay ₱${(Number(payAmount) || Math.round(paymentDue)).toLocaleString()}${
                      selectedMethod ? ` with ${selectedMethod === "gcash" ? "GCash" : "Maya"}` : ""
                    }`}
              </Text>
            </TouchableOpacity>

            <View style={styles.securityFooter}>
              <Lock size={11} color={colors.textMuted} />
              <Text style={styles.securityFooterText}>RentWise never stores your e-wallet credentials</Text>
            </View>
          </>
        )}
      </ScrollView>

      {/* WEBVIEW PAYMENT MODAL */}
      <Modal visible={showWebView} animationType="slide" onRequestClose={handlePaymentCancel}>
        <View style={styles.webViewContainer}>
          <View style={[styles.webViewHeader, { paddingTop: insets.top + 6 }]}>
            <Text style={styles.webViewTitle}>Pay Online</Text>
            <TouchableOpacity style={styles.webViewClose} onPress={handlePaymentCancel} activeOpacity={0.7}>
              <X size={22} color={colors.white} />
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
              <ActivityIndicator size="large" color={colors.emerald} />
            </View>
          )}
        </View>
      </Modal>

      {showToast && (
        <Animated.View style={[styles.toastOverlay, { opacity: toastOpacity }]}>
          <View style={styles.toastBox}>
            <CheckCircle2 size={20} color={colors.emerald} style={{ marginRight: 8 }} />
            <Text style={styles.toastText}>{toastMsg}</Text>
          </View>
        </Animated.View>
      )}

      {captureReceipt && (
        <View style={styles.receiptCaptureOffscreen} pointerEvents="none">
          <View ref={receiptShotRef} collapsable={false} style={styles.receiptCaptureCard}>
            <ReceiptCardContent data={captureReceipt.data} stall={stall} showActions={false} />
          </View>
        </View>
      )}

      <HelpTour
        visible={tourVisible}
        steps={tourSteps}
        onClose={() => {
          setTourVisible(false);
          // The tour auto-scrolls down to reach later steps — scroll back
          // to the top once it's done so the tenant isn't left mid-page.
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
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.parchment,
  },

  headerGradient: {
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: "hidden",
    paddingBottom: spacing.xxl,
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },

  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
  },

  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: colors.white,
    fontSize: fontSize.xl,
    fontFamily: fontFamily.extrabold,
  },

  historyBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },

  balanceCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: radius.lg,
    padding: spacing.lg + 2,
  },

  balanceLabel: {
    color: colors.emeraldSoft,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
  },

  balanceAmount: {
    color: colors.white,
    fontSize: fontSize.display,
    fontFamily: fontFamily.extrabold,
    marginTop: 4,
  },

  // ── Body ────────────────────────────────────────
  body: {
    flex: 1,
  },

  bodyContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },

  // ── Enter amount card ────────────────────────────
  amountCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md + 2,
    ...shadow.card,
  },

  amountCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },

  amountCardTitle: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  amountCardCurrency: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.textMuted,
    letterSpacing: 0.5,
  },

  amountBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.mist,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
  },

  amountPeso: {
    fontSize: fontSize.xxl,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginRight: 6,
  },

  amountInput: {
    flex: 1,
    fontSize: fontSize.xxl,
    fontFamily: fontFamily.extrabold,
    color: colors.ink,
    padding: 0,
  },

  // ── Caught up state ──────────────────────────────
  caughtUpCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.xxl,
    alignItems: "center",
    ...shadow.card,
  },

  caughtUpTitle: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginTop: spacing.md,
  },

  caughtUpText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    textAlign: "center",
    marginTop: 4,
  },

  // ── Payment method card ──────────────────────────
  methodCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg + 2,
    marginTop: spacing.lg,
    ...shadow.card,
  },

  methodCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.lg,
  },

  methodCardTitle: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  securedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  securedBadgeText: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },

  methodOptionCard: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },

  methodOptionCardSelected: {
    borderColor: colors.emerald,
    backgroundColor: colors.emeraldSoft,
  },

  methodBrandIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
    overflow: "hidden",
  },

  methodBrandIconDark: {
    backgroundColor: "#000000",
  },

  methodBrandIconImage: {
    width: "100%",
    height: "100%",
  },

  methodOptionInfo: {
    flex: 1,
  },

  methodOptionName: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  methodOptionSub: {
    fontSize: fontSize.xs + 1,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    marginTop: 1,
  },

  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },

  radioOuterSelected: {
    backgroundColor: colors.emerald,
    borderColor: colors.emerald,
  },

  methodInfoBanner: {
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: colors.mist,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginTop: 4,
  },

  methodInfoText: {
    flex: 1,
    fontSize: fontSize.xs + 1,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    lineHeight: 17,
  },

  // ── Pay now (inline) ─────────────────────────────
  payNowInlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.emerald,
    borderRadius: radius.md + 2,
    paddingVertical: spacing.md + 2,
    marginTop: spacing.lg,
    ...shadow.button,
  },

  payNowInlineBtnDisabled: {
    opacity: 0.5,
  },

  payNowInlineText: {
    flexShrink: 1,
    color: colors.white,
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
  },

  securityFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: spacing.md,
  },

  securityFooterText: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.regular,
    color: colors.textMuted,
  },

  // ── WebView ──────────────────────────────────────
  webViewContainer: {
    flex: 1,
    backgroundColor: colors.white,
  },

  webViewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.emerald,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },

  webViewTitle: {
    color: colors.white,
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
  },

  webViewClose: {
    padding: 4,
  },

  webViewSpinner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
  },

  // ── Toast ────────────────────────────────────────
  toastOverlay: {
    position: "absolute",
    bottom: 100,
    left: spacing.xl,
    right: spacing.xl,
    alignItems: "center",
  },

  toastBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    ...shadow.raised,
  },

  toastText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
    flexShrink: 1,
  },

  // Positioned within the visible viewport (not pushed off-canvas) — on real
  // devices, views placed entirely outside the screen bounds can get skipped
  // by Android's rendering pipeline as a clipping optimization, which made
  // captureRef() grab a blank/failed snapshot. opacity: 0 keeps it fully
  // rendered (so it captures correctly) while staying invisible to the user.
  receiptCaptureOffscreen: {
    position: "absolute",
    top: 0,
    left: 0,
    opacity: 0,
  },

  receiptCaptureCard: {
    width: 320,
    backgroundColor: colors.white,
    padding: spacing.xl,
  },
});
