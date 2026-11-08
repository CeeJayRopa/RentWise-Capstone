import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Modal,
  Alert,
  ScrollView,
  StatusBar,
  Animated,
  Easing,
  Linking,
  RefreshControl,
  BackHandler,
  AppState,
} from "react-native";
import { WebView } from "react-native-webview";

import { collection, doc, onSnapshot, query, where } from "firebase/firestore";

import { db } from "../../shared/services/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback, useEffect, useRef, useState } from "react";

import { auth } from "../../shared/firebaseConfig";
import { requireOnlineAction } from "../../shared/services/networkStatus";
import { getTenantData } from "../../services/tenantService";
import {
  createPayment,
  createOnlinePayment,
  reconcilePendingPayment,
  recoverPaymentSession,
  interruptPaymentSession,
  PaymentRecordingResult,
  PaymentAttemptStatus,
} from "../../services/paymentService";
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
  rollingAmountDue,
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
  Lock,
  HelpCircle,
  Plus,
  Minus,
  CalendarDays,
} from "lucide-react-native";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";

import HelpTour, { HelpStep } from "../components/HelpTour";
import HelpSupportModal from "../components/HelpSupportModal";
import { hasSeenPageTour, markPageTourSeen } from "../../shared/services/onboardingTour";

export default function PaymentsScreen() {
  const insets = useSafeAreaInsets();
  const topInset = insets.top > 0 ? insets.top : (StatusBar.currentHeight ?? 24);

  const [tenant, setTenant] = useState<any>(null);
  const [stall, setStall] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [advancePeriods, setAdvancePeriods] = useState(0);
  const [draftAdvancePeriods, setDraftAdvancePeriods] = useState(1);
  const [advanceModalVisible, setAdvanceModalVisible] = useState(false);
  const [removeAdvanceConfirmVisible, setRemoveAdvanceConfirmVisible] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<"gcash" | "paymaya" | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  const [showWebView, setShowWebView] = useState(false);
  const [webViewUrl, setWebViewUrl] = useState("");
  const [webViewLoading, setWebViewLoading] = useState(false);
  const [checkoutAttemptStatus, setCheckoutAttemptStatus] = useState<PaymentAttemptStatus>("pending");
  const [activePaymentAmount, setActivePaymentAmount] = useState(0);
  const paymentStartInFlight = useRef(false);
  const reconciliationInFlight = useRef(false);
  const interruptionInFlight = useRef(false);
  const checkoutVisibleRef = useRef(false);
  const recoveryPromiseRef = useRef<Promise<boolean> | null>(null);
  const finalizationInFlight = useRef(false);
  const paymentInteractionLockedRef = useRef(false);
  const [paymentInteractionLocked, setPaymentInteractionLockedState] = useState(false);

  const [toastMsg, setToastMsg] = useState("");
  const [showToast, setShowToast] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const [paymentSuccess, setPaymentSuccess] = useState<{ amount: number; method: string } | null>(null);


  const [tourVisible, setTourVisible] = useState(false);
  const [helpSupportVisible, setHelpSupportVisible] = useState(false);
  const helpRef = useRef<View>(null);
  const historyRef = useRef<View>(null);
  const balanceRef = useRef<View>(null);
  const amountRef = useRef<View>(null);
  const methodRef = useRef<View>(null);
  const payBtnRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);

  const setPaymentInteractionLocked = (locked: boolean) => {
    paymentInteractionLockedRef.current = locked;
    setPaymentInteractionLockedState(locked);
  };

  // Android Home/Recents remain under OS control, but Back must never dismiss
  // RentWise while a provider-confirmed payment is being recorded. The saved
  // session still makes process death/backgrounding recoverable.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      return paymentInteractionLockedRef.current;
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    checkoutVisibleRef.current = showWebView;
  }, [showWebView]);

  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener("change", (nextState) => {
      const leftApp = previousState === "active" && nextState !== "active";
      const returnedToApp = previousState !== "active" && nextState === "active";
      previousState = nextState;
      if (leftApp && checkoutVisibleRef.current) {
        void interruptActivePayment("background");
        return;
      }
      if (!returnedToApp || recoveryPromiseRef.current) return;
      void recoverUnfinishedPayment().catch((error) => {
        setPaymentInteractionLocked(false);
        console.log("PAYMENT APP-RESUME RECONCILIATION ERROR:", error);
      });
    });
    return () => subscription.remove();
  }, []);

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

  const periodRate = Number(tenant?.price || 0);

  useFocusEffect(
    useCallback(() => {
      const user = auth.currentUser;
      if (!user) {
        setPaymentInteractionLocked(false);
        return;
      }

      // Advance selections are only a draft until checkout starts. Reset a
      // stale selection whenever the tenant returns to this page.
      setAdvancePeriods(0);

      // If Android killed the process during wallet authorization, recover
      // the verified provider payment from the persisted session. Incomplete
      // sessions stay stored so a later focus can check again safely.
      void recoverUnfinishedPayment().catch((error) => {
        setPaymentInteractionLocked(false);
        console.log("PAYMENT RECONCILIATION ERROR:", error);
      });

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

  // E-wallet redirects are not guaranteed to return to the app. While the
  // modal is open, ask the trusted backend for the provider result. Only a
  // recorded (provider-succeeded) result closes the flow as successful.
  useEffect(() => {
    if (!showWebView) return;
    let stopped = false;
    const verify = async () => {
      if (reconciliationInFlight.current || interruptionInFlight.current || stopped) return;
      reconciliationInFlight.current = true;
      try {
        const sessionId = await getPendingCheckoutSession();
        if (!sessionId) return;
        const result = await reconcilePendingPayment(sessionId);
        if (!stopped) await handleAttemptResult(result, activePaymentAmount);
      } catch (error) {
        console.log("PAYMENT STATUS CHECK ERROR:", error);
      } finally {
        reconciliationInFlight.current = false;
      }
    };
    void verify();
    const interval = setInterval(() => void verify(), 3000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [showWebView, activePaymentAmount]);

  async function loadTenantProfile(uid: string) {
    try {
      const tenantData = await getTenantData(uid);
      if (!tenantData) return;
      setTenant(tenantData);
    } catch (error) {
      console.log("PROFILE ERROR:", error);
    }
  }

  // Live (not one-time) so a change to the stall's location info (used for
  // receipts below) shows up immediately, same reasoning as the tenant
  // listener below. Keyed off `tenant?.stallId` (itself kept live by the
  // users/{uid} listener right below) rather than a separately-fetched
  // value -- otherwise, if an admin moves this tenant to a different stall
  // while this screen is already open and focused, this would keep
  // watching the OLD stall doc until the tenant next re-focuses the tab,
  // and a payment made in that window would get tagged with the old
  // building/space even though its stallId field was already correct.
  useEffect(() => {
    const currentStallId = tenant?.stallId;
    if (!currentStallId) {
      setStall(null);
      return;
    }
    const unsubscribe = onSnapshot(doc(db, "stalls", currentStallId), (snap) => {
      if (snap.exists()) setStall({ id: snap.id, ...snap.data() });
    }, (error) => {
      if (auth.currentUser) console.error("TENANT PAYMENT STALL LISTENER ERROR:", error);
    });
    return unsubscribe;
  }, [tenant?.stallId]);

  // Live (not one-time) so a rate/schedule change the admin makes shows up
  // immediately even if this screen is already open and focused, instead
  // of only refreshing the next time the tenant switches back to this tab.
  // Price/paymentSchedule/category live on the tenant's OWN doc now (not
  // the stall), so this listens there directly.
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const unsubscribe = onSnapshot(doc(db, "users", uid), (snap) => {
      if (snap.exists()) setTenant((prev: any) => ({ ...prev, ...snap.data(), id: snap.id }));
    }, (error) => {
      if (auth.currentUser) console.error("TENANT PAYMENT PROFILE LISTENER ERROR:", error);
    });
    return unsubscribe;
  }, []);

  // Uses the same native pull-to-refresh behavior as the dashboard.
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

  function recoverUnfinishedPayment(): Promise<boolean> {
    if (recoveryPromiseRef.current) return recoveryPromiseRef.current;

    const recovery = (async () => {
      let checkoutSessionId = await getPendingCheckoutSession();
      if (checkoutSessionId) {
        try {
          const result = await reconcilePendingPayment(checkoutSessionId);
          await handleAttemptResult(result, 0, true);
          if (result.status !== "pending") return result.status === "recorded";
        } catch (error: any) {
          const code = String(error?.code ?? "");
          if (code !== "functions/not-found" && code !== "not-found") throw error;
          // The backend has confirmed this device reference is stale. Remove
          // only the local pointer, then ask the backend for the tenant's real
          // unresolved session instead of allowing it to block recovery.
          await clearPendingCheckoutSession();
          await clearPendingPaymentMethod();
          checkoutSessionId = null;
        }
      }

      const recovered = await recoverPaymentSession();
      if (recovered.status === "none") {
        setPaymentInteractionLocked(false);
        return false;
      }
      checkoutSessionId = recovered.sessionId;
      await setPendingCheckoutSession(checkoutSessionId);
      if (recovered.paymentMethod) await setPendingPaymentMethod(recovered.paymentMethod);
      if (recovered.status === "pending" && recovered.redirectUrl) {
        setActivePaymentAmount(Number(recovered.amount ?? 0));
        setCheckoutAttemptStatus("pending");
        setWebViewUrl(recovered.redirectUrl);
        setShowWebView(true);
        setPaymentInteractionLocked(false);
        return false;
      }
      const result = await reconcilePendingPayment(checkoutSessionId);
      await handleAttemptResult(result, 0, true);
      return result.status === "recorded";
    })();

    recoveryPromiseRef.current = recovery;
    const clearRecoveryPromise = () => {
      if (recoveryPromiseRef.current === recovery) recoveryPromiseRef.current = null;
    };
    void recovery.then(clearRecoveryPromise, clearRecoveryPromise);
    return recovery;
  }

  async function handleAttemptResult(
    result: PaymentRecordingResult,
    amount: number,
    recovered = false,
  ) {
    setCheckoutAttemptStatus(result.status === "recorded" ? "paid" : result.status);
    if (result.status === "recorded") {
      const pendingMethod = await getPendingPaymentMethod();
      const recordedMethod = pendingMethod === "gcash" ? "GCash" : pendingMethod === "paymaya" ? "Maya" : "Online";
      await clearPendingCheckoutSession();
      await clearPendingPaymentMethod();
      setShowWebView(false);
      setPaymentInteractionLocked(false);
      setAdvancePeriods(0);
      if (recovered) triggerToast("Payment recovered and sent for confirmation.");
      else setPaymentSuccess({ amount, method: recordedMethod });
      return;
    }
    if (result.status === "processing") {
      setPaymentInteractionLocked(true);
      return;
    }
    if (result.status === "pending") {
      setPaymentInteractionLocked(false);
      return;
    }
    // `paid` means the provider has confirmed funds but the verified RentWise
    // payment record has not yet been returned. Keep the recovery reference;
    // only `recorded` is allowed to clear it and show the success result.
    if (result.status === "paid") {
      setPaymentInteractionLocked(true);
      return;
    }
    await clearPendingCheckoutSession();
    await clearPendingPaymentMethod();
    setShowWebView(false);
    setPaymentInteractionLocked(false);
    if (result.status === "expired") triggerToast("Payment session expired. Please try again.");
    else if (result.status === "failed") triggerToast("Payment failed. Please try again.");
    else triggerToast("Payment cancelled.");
  }

  const pendingPayments = payments.filter((p) => p.status === "pending");

  const paymentSchedule = tenant?.paymentSchedule ?? "monthly";
  const today = new Date();
  const rawBillingStart = tenant?.billingStartedAt ?? tenant?.createdAt;
  const billingStartedAt = rawBillingStart?.toDate?.()
    ?? (rawBillingStart ? new Date(rawBillingStart) : null);
  const storedNextDueAt = tenant?.nextDueAt?.toDate?.()
    ?? (tenant?.nextDueAt ? new Date(tenant.nextDueAt) : billingStartedAt);
  const actualPaymentDue = rollingAmountDue(periodRate, paymentSchedule, storedNextDueAt, today);
  const paymentDue = actualPaymentDue;
  const periodCharge = computePeriodCharge(periodRate, paymentSchedule, today);
  const advanceAmount = Math.round(advancePeriods * periodCharge * 100) / 100;
  const totalPaymentAmount = Math.round((paymentDue + advanceAmount) * 100) / 100;
  const advanceUnit = paymentSchedule === "daily"
    ? "day"
    : paymentSchedule === "weekly"
      ? "week"
      : paymentSchedule === "semi-monthly"
        ? "15-day period"
        : "month";
  const maxAdvancePeriods = paymentSchedule === "daily"
    ? 365
    : paymentSchedule === "weekly"
      ? 52
      : paymentSchedule === "semi-monthly"
        ? 24
        : 12;
  // Advance selection is a page-only preview. It changes this Payment
  // Center total but never mutates the tenant's real balance or dashboard.
  const displayedPaymentTotal = advancePeriods > 0 ? totalPaymentAmount : paymentDue;
  const [balanceWhole, balanceCents] = Math.max(0, displayedPaymentTotal)
    .toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .split(".");

  const pendingAmount = pendingPayments.reduce((sum, payment) => {
    const amount = Number(payment.amount ?? 0);
    return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
  }, 0);
  const remainingAfterPending = Math.max(0, Math.round((paymentDue - pendingAmount) * 100) / 100);
  const formatPeso = (value: number) => value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const hasPendingCoverage = paymentDue > 0 && pendingAmount >= paymentDue;
  const hasPaidCurrentPeriod = paymentDue <= 0 || hasPendingCoverage;

  const tourSteps: HelpStep[] = [
    { key: "history", ref: historyRef, title: "Payment history", description: "View past payments and download receipts.", edgeInset: "top", round: true },
    { key: "balance", ref: balanceRef, title: "Total balance due", description: "What you currently owe for this billing period, after any payments already made.", edgeInset: "top" },
    ...(!hasPaidCurrentPeriod
      ? [
          { key: "amount", ref: amountRef, title: "Add advance payment", description: "Your current balance is locked for safety. Use Add advance payment to include complete billing periods.", edgeInset: "top" as const, onBeforeMeasure: () => scrollSectionIntoView(amountRef) },
          { key: "method", ref: methodRef, title: "Payment method", description: "Choose GCash or Maya for the PayMongo test demonstration.", edgeInset: "top" as const, onBeforeMeasure: () => scrollSectionIntoView(methodRef) },
          { key: "pay", ref: payBtnRef, title: "Pay Now", description: "Opens PayMongo's test checkout. No real money is charged.", edgeInset: "top" as const, onBeforeMeasure: () => scrollSectionIntoView(payBtnRef) },
        ]
      : []),
  ];

  async function handlePayNow() {
    if (paymentStartInFlight.current) return;
    if (!(await requireOnlineAction("Starting an online payment"))) return;
    paymentStartInFlight.current = true;
    try {
    // The client sends only the selected advance quantity. The backend
    // computes the balance and final amount from the latest billing state.
    if (paymentDue <= 0 && advancePeriods <= 0) {
      Alert.alert("Nothing to pay", "You have no balance due. Choose an advance payment period first.");
      return;
    }
    if (!selectedMethod) {
      Alert.alert("Error", "Please choose GCash or Maya");
      return;
    }
    const user = auth.currentUser;
    if (!user) return;

    setRedirecting(true);
    const tenantName = tenant
      ? `${tenant.firstName ?? ""} ${tenant.lastName ?? ""}`.trim()
      : "";
    const tenantEmail = tenant?.email || user.email || "";
    const { paymentIntentId, redirectUrl, amount: authoritativeAmount } = await createOnlinePayment(
      advancePeriods,
      selectedMethod,
      { name: tenantName, email: tenantEmail },
    );
    await setPendingCheckoutSession(paymentIntentId);
    await setPendingPaymentMethod(selectedMethod);
    setActivePaymentAmount(authoritativeAmount);
    setCheckoutAttemptStatus("pending");
    setSelectedMethod(null);
    setWebViewUrl(redirectUrl);
    setShowWebView(true);
    } catch (error) {
      console.log("PAYMONGO ERROR:", error);
      Alert.alert("Error", "Unable to start payment. Please try again.");
    } finally {
      setRedirecting(false);
      paymentStartInFlight.current = false;
    }
  }

  async function handlePaymentSuccess(amountCentavos: number) {
    if (finalizationInFlight.current) return;
    finalizationInFlight.current = true;
    setPaymentInteractionLocked(true);
    try {
      const user = auth.currentUser;
      if (!user) {
        setPaymentInteractionLocked(false);
        return;
      }
      const paymentAmount = amountCentavos / 100;
      const sessionId = await getPendingCheckoutSession();
      if (!sessionId) {
        setPaymentInteractionLocked(false);
        Alert.alert("Verification pending", "RentWise could not find the payment session. Reopen Payments to recover it securely.");
        return;
      }
      const pendingMethod = await getPendingPaymentMethod();
      const paymentMethodLabel = pendingMethod === "gcash" ? "GCash" : pendingMethod === "paymaya" ? "Maya" : "Online";
      const receiptNo = "RW-ONLINE-" + Date.now().toString().slice(-8);
      const tenantName = tenant ? `${tenant.firstName} ${tenant.lastName}` : "";
      const schedule = tenant?.paymentSchedule ?? "monthly";
      const scheduleRent = computePeriodCharge(tenant?.price ?? 0, schedule, new Date());
      const owedAmount = Math.max(paymentDue, scheduleRent || 0);
      const periodsOwed =
        scheduleRent > 0 ? Math.max(1, Math.round(owedAmount / scheduleRent)) : 1;
      const advanceAmount = Math.max(0, paymentAmount - owedAmount);
      const periodsAdvance =
        scheduleRent > 0 ? Math.floor((advanceAmount + 0.000001) / scheduleRent) : 0;
      const periodsCovered = periodsOwed + periodsAdvance;
      const billingCredit = Math.max(0, Math.round((advanceAmount - periodsAdvance * scheduleRent) * 100) / 100);

      // Itemizes exactly which period(s) this payment covers — including
      // any consecutive unpaid days/periods before today — so the tenant
      // can see why the total is what it is instead of one lump sum.
      const today = new Date();
      const owedBreakdown = consecutivePeriodsEnding(tenant?.price ?? 0, schedule, today, periodsOwed).map((p) => ({
        label: periodLabel(schedule, p.date),
        amount: p.amount,
      }));
      let advanceCursor = nextPeriodStart(schedule, today);
      const advanceBreakdown: { label: string; amount: number }[] = [];
      for (let i = 0; i < periodsAdvance; i++) {
        advanceBreakdown.push({
          label: `Advance – ${periodLabel(schedule, advanceCursor)}`,
          amount: computePeriodCharge(tenant?.price ?? 0, schedule, advanceCursor),
        });
        advanceCursor = nextPeriodStart(schedule, advanceCursor);
      }
      const breakdown = [...owedBreakdown, ...advanceBreakdown];
      if (billingCredit > 0) breakdown.push({ label: "Remaining billing credit", amount: billingCredit });

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
      const result = await createPayment({
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
      await handleAttemptResult(result, paymentAmount);
    } catch (err) {
      console.log("[handlePaymentSuccess] error:", err);
      Alert.alert(
        "Verification pending",
        "RentWise could not confirm the final result yet. Your payment will continue to be checked securely.",
      );
    } finally {
      finalizationInFlight.current = false;
    }
  }

  async function interruptActivePayment(reason: "close" | "background" = "close") {
    if (interruptionInFlight.current || finalizationInFlight.current) return;
    interruptionInFlight.current = true;
    setPaymentInteractionLocked(true);
    try {
      const sessionId = await getPendingCheckoutSession();
      if (!sessionId) {
        setShowWebView(false);
        setPaymentInteractionLocked(false);
        return;
      }
      const result = await interruptPaymentSession(sessionId);
      if (result.status === "paid" || result.status === "processing" || result.status === "recorded") {
        const reconciled = result.status === "recorded"
          ? result
          : await reconcilePendingPayment(sessionId);
        await handleAttemptResult(reconciled, activePaymentAmount, reason === "background");
        return;
      }
      if (result.status === "cancelled" || result.status === "failed" || result.status === "expired") {
        await clearPendingCheckoutSession();
        await clearPendingPaymentMethod();
        setShowWebView(false);
        setPaymentInteractionLocked(false);
        if (reason === "close") triggerToast("Payment cancelled. No payment record was created.");
        return;
      }
      // Provider still considers the attempt actionable. Keep the saved
      // session so returning to Payments can safely resume or reconcile it.
      setShowWebView(false);
      setPaymentInteractionLocked(false);
      if (reason === "close") triggerToast("Payment status is still being verified.");
    } catch (error) {
      console.log("PAYMENT INTERRUPTION ERROR:", error);
      setShowWebView(false);
      setPaymentInteractionLocked(false);
      if (reason === "close") triggerToast("Could not safely cancel yet. RentWise will verify it again.");
    } finally {
      interruptionInFlight.current = false;
    }
  }

  function handlePaymentCancel() {
    void interruptActivePayment("close");
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
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      <View style={styles.headerGradient}>
        <View style={[styles.header, { paddingTop: topInset + 14 }]}>
          <View style={styles.headerTitleGroup}>
            <Text style={styles.headerEyebrow}>Tenant Hub</Text>
            <Text style={styles.headerTitle}>Payment Center</Text>
          </View>
          <View style={styles.headerActions}>
            <View ref={historyRef} collapsable={false}>
              <TouchableOpacity
                style={styles.historyBtn}
                onPress={() => router.push("/payment-history")}
                activeOpacity={0.7}
              >
                <History size={18} color={colors.ink} />
              </TouchableOpacity>
            </View>
            <View ref={helpRef} collapsable={false}>
              <TouchableOpacity
                style={styles.historyBtn}
                onPress={() => setHelpSupportVisible(true)}
                activeOpacity={0.7}
              >
                <HelpCircle size={18} color={colors.ink} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={styles.balanceCard} ref={balanceRef} collapsable={false}>
          <View style={styles.balanceHeaderRow}>
            <Text style={styles.balanceLabel}>Total Balance Due</Text>
            <View style={styles.leaseBadge}>
              <Text style={styles.leaseBadgeText}>
                {tenant?.status === "active" ? "Active Lease" : "Lease Inactive"}
              </Text>
            </View>
          </View>
          <View style={styles.balanceAmountRow}>
            <Text style={styles.balanceAmount}>₱{balanceWhole}</Text>
            <Text style={styles.balanceCents}>.{balanceCents}</Text>
          </View>
          {pendingAmount > 0 && advancePeriods === 0 ? (
            <View style={styles.pendingBalanceSummary}>
              <View style={styles.pendingBalanceRow}>
                <Text style={styles.pendingBalanceLabel}>Awaiting confirmation</Text>
                <Text style={styles.pendingBalanceValue}>₱{formatPeso(pendingAmount)}</Text>
              </View>
              <View style={styles.pendingBalanceRow}>
                <Text style={styles.pendingBalanceLabel}>Remaining to submit</Text>
                <Text style={styles.pendingBalanceValue}>₱{formatPeso(remainingAfterPending)}</Text>
              </View>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.body}>
        <ScrollView
          ref={scrollRef}
          style={styles.bodyScroll}
          contentContainerStyle={[styles.bodyContent, { paddingBottom: Math.max(insets.bottom, 8) }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#000000"
              colors={["#000000"]}
            />
          }
        >
        {hasPaidCurrentPeriod && advancePeriods === 0 ? (
          <View style={styles.caughtUpCard}>
            <CheckCircle2 size={28} color={colors.emerald} />
            <Text style={styles.caughtUpTitle}>You're all caught up</Text>
            <Text style={styles.caughtUpText}>
              {hasPendingCoverage
                ? "Your payment is pending administrator confirmation."
                : storedNextDueAt && storedNextDueAt > today
                  ? `Your next payment is due ${storedNextDueAt.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}.`
                  : "You have no payment due right now."}
            </Text>
            {!hasPendingCoverage ? (
              <Pressable
                style={({pressed}) => [styles.advanceButton, pressed && styles.advanceButtonPressed]}
                onPress={() => {
                  setDraftAdvancePeriods(1);
                  setAdvanceModalVisible(true);
                }}
              >
                <CalendarDays size={16} color={colors.emerald} />
                <Text style={styles.advanceButtonText}>Pay in advance</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <>
            <View ref={amountRef} collapsable={false}>
              <Pressable
                style={({pressed}) => [styles.advanceButton, pressed && styles.advanceButtonPressed]}
                onPress={() => {
                  setDraftAdvancePeriods(Math.max(1, advancePeriods));
                  setAdvanceModalVisible(true);
                }}
              >
                <CalendarDays size={16} color={colors.emerald} />
                <Text style={styles.advanceButtonText}>{advancePeriods > 0 ? "Change advance payment" : "Add advance payment"}</Text>
              </Pressable>

              {advancePeriods > 0 ? (
                <View style={styles.selectedAdvanceSummary}>
                  <View style={styles.paymentSummaryRow}>
                    <Text style={styles.paymentSummaryLabel}>Current balance</Text>
                    <Text style={styles.paymentSummaryValue}>₱{paymentDue.toLocaleString("en-PH", {minimumFractionDigits: 2})}</Text>
                  </View>
                  <View style={styles.paymentSummaryRow}>
                    <Text style={styles.paymentSummaryLabel}>Advance ({advancePeriods} {advanceUnit}{advancePeriods === 1 ? "" : "s"})</Text>
                    <Text style={styles.paymentSummaryValue}>+₱{advanceAmount.toLocaleString("en-PH", {minimumFractionDigits: 2})}</Text>
                  </View>
                  <View style={styles.advanceTotalDivider} />
                  <View style={styles.paymentSummaryRow}>
                    <Text style={styles.advanceTotalLabel}>Total to pay</Text>
                    <Text style={styles.advanceTotalValue}>₱{totalPaymentAmount.toLocaleString("en-PH", {minimumFractionDigits: 2})}</Text>
                  </View>
                </View>
              ) : null}
            </View>

            <View style={styles.methodCard} ref={methodRef} collapsable={false}>
              <View style={styles.methodCardHeader}>
                <Text style={styles.methodCardTitle}>Payment method</Text>
                <View style={styles.securedBadge}>
                  <ShieldCheck size={13} color={colors.emerald} />
                  <Text style={styles.securedBadgeText}>Secured</Text>
                </View>
              </View>

              <View style={styles.methodInfoBanner}>
                <Info size={13} color={colors.textSecondary} />
                <Text style={styles.methodInfoText}>TEST MODE — This demonstration does not charge real money.</Text>
              </View>

              <View style={styles.methodOptionsGroup}>
                <Pressable
                  style={[styles.methodOptionCard, selectedMethod === "gcash" && styles.methodOptionCardSelected]}
                  onPress={() => setSelectedMethod("gcash")}
                >
                  <View style={styles.methodBrandIcon}>
                    <Image
                      source={require("../../assets/gcash.png")}
                      style={styles.methodBrandIconImage}
                      resizeMode="cover"
                    />
                  </View>
                  <View style={styles.methodOptionInfo}>
                    <Text style={styles.methodOptionName}>GCash</Text>
                    <Text style={styles.methodOptionSub}>PayMongo test checkout</Text>
                  </View>
                  <View style={[styles.radioOuter, selectedMethod === "gcash" && styles.radioOuterSelected]}>
                    {selectedMethod === "gcash" && <View style={styles.radioInner} />}
                  </View>
                </Pressable>

                <View style={styles.methodOptionDivider} />

                <Pressable
                  style={[styles.methodOptionCard, selectedMethod === "paymaya" && styles.methodOptionCardSelected]}
                  onPress={() => setSelectedMethod("paymaya")}
                >
                  <View style={[styles.methodBrandIcon, styles.methodBrandIconDark]}>
                    <Image source={require("../../assets/maya-icon.png")} style={styles.methodBrandIconImage} resizeMode="contain" />
                  </View>
                  <View style={styles.methodOptionInfo}>
                    <Text style={styles.methodOptionName}>Maya</Text>
                    <Text style={styles.methodOptionSub}>PayMongo test checkout</Text>
                  </View>
                  <View style={[styles.radioOuter, selectedMethod === "paymaya" && styles.radioOuterSelected]}>
                    {selectedMethod === "paymaya" && <View style={styles.radioInner} />}
                  </View>
                </Pressable>
              </View>

              {selectedMethod && (
                <View style={styles.methodInfoBanner}>
                  <Info size={13} color={colors.textSecondary} />
                  <Text style={styles.methodInfoText}>
                    Continue to PayMongo's {selectedMethod === "gcash" ? "GCash" : "Maya"} test checkout to complete provider authorization. No real money is charged.
                  </Text>
                </View>
              )}
            </View>

            <Pressable
              ref={payBtnRef}
              style={({ pressed }) => [
                styles.payNowInlineBtn,
                (redirecting || !selectedMethod) && styles.payNowInlineBtnDisabled,
                pressed &&
                  !(redirecting || !selectedMethod) && {
                    backgroundColor: colors.white,
                    transform: [{ scale: 0.97 }],
                  },
              ]}
              disabled={redirecting || !selectedMethod}
              onPress={handlePayNow}
            >
              {({ pressed }) => {
                const isActivePress = pressed && !(redirecting || !selectedMethod);
                return (
                  <>
                    <Lock size={16} color={isActivePress ? colors.emerald : colors.white} />
                    <Text
                      style={[styles.payNowInlineText, isActivePress && styles.payNowInlineTextPressed]}
                      numberOfLines={1}
                    >
                      {redirecting
                        ? "Opening payment..."
                        : `Pay ₱${totalPaymentAmount.toLocaleString()}`}
                    </Text>
                  </>
                );
              }}
            </Pressable>

            <View style={styles.securityFooter}>
              <Lock size={11} color={colors.textMuted} />
              <Text style={styles.securityFooterText}>RentWise never stores your e-wallet credentials</Text>
            </View>
          </>
        )}
        </ScrollView>
      </View>

      <Modal
        visible={advanceModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (removeAdvanceConfirmVisible) setRemoveAdvanceConfirmVisible(false);
          else setAdvanceModalVisible(false);
        }}
      >
        <View style={styles.advanceModalOverlay}>
          <View style={styles.advanceModalCard}>
            <View style={styles.advanceModalHeader}>
              <View>
                <Text style={styles.advanceModalTitle}>Advance payment</Text>
                <Text style={styles.advanceModalSubtitle}>Choose additional {advanceUnit}s to cover.</Text>
              </View>
            </View>

            <View style={styles.advanceRateCard}>
              <Text style={styles.advanceRateLabel}>{paymentSchedule.replace("-", " ")} rate</Text>
              <Text style={styles.advanceRateValue}>₱{periodCharge.toLocaleString("en-PH", {minimumFractionDigits: 2})} / {advanceUnit}</Text>
            </View>

            <Text style={styles.advancePickerLabel}>Number of additional {advanceUnit}{draftAdvancePeriods === 1 ? "" : "s"}</Text>
            <View style={styles.advancePicker}>
              <Pressable
                style={[styles.advancePickerButton, draftAdvancePeriods <= 1 && styles.advancePickerButtonDisabled]}
                disabled={draftAdvancePeriods <= 1}
                onPress={() => setDraftAdvancePeriods((value) => Math.max(1, value - 1))}
              >
                <Minus size={22} color={colors.emerald} />
              </Pressable>
              <Text style={styles.advancePickerValue}>{draftAdvancePeriods}</Text>
              <Pressable
                style={[styles.advancePickerButton, draftAdvancePeriods >= maxAdvancePeriods && styles.advancePickerButtonDisabled]}
                disabled={draftAdvancePeriods >= maxAdvancePeriods}
                onPress={() => setDraftAdvancePeriods((value) => Math.min(maxAdvancePeriods, value + 1))}
              >
                <Plus size={22} color={colors.emerald} />
              </Pressable>
            </View>

            <View style={styles.advanceTotalCard}>
              <View style={styles.paymentSummaryRow}>
                <Text style={styles.paymentSummaryLabel}>Current balance</Text>
                <Text style={styles.paymentSummaryValue}>₱{paymentDue.toLocaleString("en-PH", {minimumFractionDigits: 2})}</Text>
              </View>
              <View style={styles.paymentSummaryRow}>
                <Text style={styles.paymentSummaryLabel}>Advance amount</Text>
                <Text style={styles.paymentSummaryValue}>+₱{(draftAdvancePeriods * periodCharge).toLocaleString("en-PH", {minimumFractionDigits: 2})}</Text>
              </View>
              <View style={styles.advanceTotalDivider} />
              <View style={styles.paymentSummaryRow}>
                <Text style={styles.advanceTotalLabel}>Total to pay</Text>
                <Text style={styles.advanceTotalValue}>₱{(paymentDue + draftAdvancePeriods * periodCharge).toLocaleString("en-PH", {minimumFractionDigits: 2})}</Text>
              </View>
            </View>

            <View style={styles.advanceModalActions}>
              {advancePeriods > 0 ? (
                <Pressable
                  style={styles.advanceRemoveButton}
                  onPress={() => setRemoveAdvanceConfirmVisible(true)}
                >
                  <Text style={styles.advanceRemoveText}>Remove</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={({pressed}) => [styles.advanceCancelButton, pressed && styles.advanceCancelButtonPressed]}
                  onPress={() => setAdvanceModalVisible(false)}
                >
                  {({pressed}) => <Text style={[styles.advanceCancelText, pressed && styles.advanceCancelTextPressed]}>Cancel</Text>}
                </Pressable>
              )}
              <Pressable
                style={({pressed}) => [styles.advanceConfirmButton, pressed && styles.advanceConfirmButtonPressed]}
                onPress={() => {
                  setAdvancePeriods(draftAdvancePeriods);
                  setAdvanceModalVisible(false);
                }}
              >
                {({pressed}) => <Text style={[styles.advanceConfirmText, pressed && styles.advanceConfirmTextPressed]}>Confirm</Text>}
              </Pressable>
            </View>

            {removeAdvanceConfirmVisible ? (
              <View style={styles.removeConfirmOverlay}>
                <View style={styles.removeConfirmCard}>
                  <View style={styles.removeConfirmIcon}>
                    <CalendarDays size={24} color={colors.error} />
                  </View>
                  <Text style={styles.removeConfirmTitle}>Remove advance payment?</Text>
                  <Text style={styles.removeConfirmMessage}>
                    This only removes your advance-payment selection. Your actual account balance will not be changed.
                  </Text>

                  <View style={styles.removeConfirmAmounts}>
                    <View>
                      <Text style={styles.removeConfirmAmountLabel}>Current preview</Text>
                      <Text style={styles.removeConfirmOldAmount}>₱{totalPaymentAmount.toLocaleString("en-PH", {minimumFractionDigits: 2})}</Text>
                    </View>
                    <Text style={styles.removeConfirmArrow}>→</Text>
                    <View style={styles.removeConfirmAmountRight}>
                      <Text style={styles.removeConfirmAmountLabel}>Original balance</Text>
                      <Text style={styles.removeConfirmNewAmount}>₱{paymentDue.toLocaleString("en-PH", {minimumFractionDigits: 2})}</Text>
                    </View>
                  </View>

                  <View style={styles.removeConfirmActions}>
                    <Pressable
                      style={({pressed}) => [styles.removeConfirmKeep, pressed && styles.removeConfirmKeepPressed]}
                      onPress={() => setRemoveAdvanceConfirmVisible(false)}
                    >
                      <Text style={styles.removeConfirmKeepText}>Keep advance</Text>
                    </Pressable>
                    <Pressable
                      style={({pressed}) => [styles.removeConfirmRemove, pressed && styles.removeConfirmRemovePressed]}
                      onPress={() => {
                        setRemoveAdvanceConfirmVisible(false);
                        setAdvancePeriods(0);
                        setDraftAdvancePeriods(1);
                        setAdvanceModalVisible(false);
                      }}
                    >
                      <Text style={styles.removeConfirmRemoveText}>Remove</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* WEBVIEW PAYMENT MODAL */}
      <Modal visible={showWebView} animationType="slide" onRequestClose={handlePaymentCancel}>
        <View style={styles.webViewContainer}>
          <View style={[styles.webViewHeader, { paddingTop: insets.top + 6 }]}>
            <View>
              <Text style={styles.webViewTitle}>Pay Online</Text>
              <Text style={styles.webViewStatusText}>
                {checkoutAttemptStatus === "processing"
                  ? "Your payment is being verified."
                  : checkoutAttemptStatus === "pending"
                    ? "Awaiting payment."
                    : checkoutAttemptStatus === "expired"
                      ? "Payment session expired. Please try again."
                      : checkoutAttemptStatus === "failed"
                        ? "Payment failed. Please try again."
                        : checkoutAttemptStatus === "cancelled"
                          ? "Payment cancelled."
                          : "Payment confirmed."}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.webViewClose, paymentInteractionLocked && styles.webViewCloseDisabled]}
              disabled={paymentInteractionLocked}
              onPress={handlePaymentCancel}
              activeOpacity={0.7}
            >
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
                  const amountMatch = url.match(/[?&]amount=(\d+)/);
                  const statusMatch = url.match(/[?&]returnStatus=([^&]+)/);
                  const centavos = amountMatch ? parseInt(amountMatch[1], 10) : 0;
                  const returnStatus = statusMatch ? decodeURIComponent(statusMatch[1]) : "success";
                  if (returnStatus === "success") {
                    void handlePaymentSuccess(centavos);
                  } else {
                    void (async () => {
                      const sessionId = await getPendingCheckoutSession();
                      if (!sessionId) return;
                      const result = await reconcilePendingPayment(sessionId);
                      await handleAttemptResult(result, activePaymentAmount);
                    })().catch((error) => console.log("PAYMENT RETURN RECONCILIATION ERROR:", error));
                  }
                } else {
                  void (async () => {
                    const sessionId = await getPendingCheckoutSession();
                    if (!sessionId) return;
                    const result = await reconcilePendingPayment(sessionId);
                    await handleAttemptResult(result, activePaymentAmount);
                  })().catch((error) => console.log("PAYMENT RETURN RECONCILIATION ERROR:", error));
                }
                return false;
              }
              // PayMongo may hand off to a supported banking or e-wallet app.
              // A WebView cannot load custom app schemes, so open them via OS.
              if (!url.startsWith("http://") && !url.startsWith("https://")) {
                Linking.openURL(url).catch(() => {
                  Alert.alert(
                    "App not found",
                    "Please install the selected e-wallet app, or complete the PayMongo test flow in the web page.",
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

      <Modal
        visible={paymentInteractionLocked}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {}}
      >
        <View style={styles.paymentLockOverlay}>
          <View style={styles.paymentLockCard}>
            <View style={styles.paymentLockIcon}>
              <ShieldCheck size={30} color={colors.emerald} />
            </View>
            <ActivityIndicator size="large" color={colors.emerald} />
            <Text style={styles.paymentLockTitle}>Securing your payment</Text>
            <Text style={styles.paymentLockMessage}>
              RentWise is verifying the provider result and recording it safely. Please wait and do not submit another payment.
            </Text>
          </View>
        </View>
      </Modal>

      <Modal
        visible={paymentSuccess !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPaymentSuccess(null)}
      >
        <View style={styles.paymentSuccessOverlay}>
          <View style={styles.paymentSuccessCard}>
            <View style={styles.paymentSuccessIcon}>
              <CheckCircle2 size={42} color={colors.emerald} />
            </View>
            <Text style={styles.paymentSuccessTitle}>Payment successful</Text>
            <Text style={styles.paymentSuccessMessage}>
              Your online payment was processed and submitted for admin confirmation.
            </Text>
            <View style={styles.paymentSuccessDetails}>
              <View style={styles.paymentSuccessDetailRow}>
                <Text style={styles.paymentSuccessDetailLabel}>Amount</Text>
                <Text style={styles.paymentSuccessDetailValue}>
                  ₱{Number(paymentSuccess?.amount ?? 0).toLocaleString("en-PH", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </Text>
              </View>
              <View style={styles.paymentSuccessDetailRow}>
                <Text style={styles.paymentSuccessDetailLabel}>Method</Text>
                <Text style={styles.paymentSuccessDetailValue}>{paymentSuccess?.method ?? "Online"}</Text>
              </View>
              <View style={styles.paymentSuccessDetailRow}>
                <Text style={styles.paymentSuccessDetailLabel}>Status</Text>
                <Text style={styles.paymentSuccessPending}>Pending confirmation</Text>
              </View>
            </View>
            <Pressable
              style={({ pressed }) => [styles.paymentSuccessButton, pressed && styles.paymentSuccessButtonPressed]}
              onPress={() => setPaymentSuccess(null)}
            >
              <Text style={styles.paymentSuccessButtonText}>Done</Text>
            </Pressable>
          </View>
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

      <HelpSupportModal visible={helpSupportVisible} steps={tourSteps} onClose={() => setHelpSupportVisible(false)} onReplayTour={() => setTourVisible(true)} />
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
    backgroundColor: colors.parchment,
    paddingBottom: spacing.md,
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },

  headerTitleGroup: {
    flex: 1,
  },

  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
  },

  headerTitle: {
    color: colors.ink,
    fontSize: fontSize.lg,
    fontFamily: fontFamily.extrabold,
    marginTop: 2,
  },

  headerEyebrow: {
    color: colors.emerald,
    fontSize: 10,
    fontFamily: fontFamily.bold,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  historyBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.card,
  },

  balanceCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: colors.emerald,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
  },

  balanceHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  balanceLabel: {
    color: colors.emeraldSoft,
    fontSize: 10,
    fontFamily: fontFamily.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  leaseBadge: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.45)",
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },

  leaseBadgeText: {
    color: colors.white,
    fontSize: 9,
    fontFamily: fontFamily.semibold,
  },

  balanceAmountRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginTop: spacing.sm,
  },

  balanceAmount: {
    color: colors.white,
    fontSize: 30,
    fontFamily: fontFamily.extrabold,
  },

  balanceCents: {
    color: colors.white,
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    marginLeft: 3,
  },

  pendingBalanceSummary: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.35)",
    gap: 4,
  },

  pendingBalanceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  pendingBalanceLabel: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 11,
    fontFamily: fontFamily.medium,
  },

  pendingBalanceValue: {
    color: colors.white,
    fontSize: 11,
    fontFamily: fontFamily.bold,
  },

  // ── Body ────────────────────────────────────────
  body: {
    flex: 1,
  },

  bodyScroll: {
    flex: 1,
  },

  bodyContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: 0,
  },

  // ── Enter amount card ────────────────────────────
  amountCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },

  amountCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },

  amountCardTitle: {
    fontSize: 10,
    fontFamily: fontFamily.medium,
    color: colors.ink,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  amountCardCurrency: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.textMuted,
    letterSpacing: 0.5,
    backgroundColor: colors.mist,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },

  amountBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: "rgba(15, 125, 91, 0.22)",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },

  amountPeso: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginRight: 6,
  },

  amountInput: {
    flex: 1,
    fontSize: fontSize.xl,
    fontFamily: fontFamily.extrabold,
    color: colors.ink,
    padding: 0,
  },

  paymentSummary: { marginTop: spacing.md, gap: spacing.sm },
  paymentSummaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  paymentSummaryLabel: { flex: 1, fontSize: fontSize.sm, fontFamily: fontFamily.regular, color: colors.textSecondary },
  paymentSummaryValue: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.ink },
  selectedAdvanceSummary: {
    marginTop: spacing.sm,
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.mist,
    borderWidth: 1,
    borderColor: colors.border,
  },
  advanceButton: {
    marginTop: spacing.lg,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.emerald,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.white,
  },
  advanceButtonText: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.emerald },
  advanceButtonPressed: {
    backgroundColor: colors.emeraldSoft,
    transform: [{scale: 0.98}],
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
    marginTop: spacing.lg,
  },

  methodCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },

  methodCardTitle: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  securedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.emeraldSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },

  securedBadgeText: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },

  methodOptionsGroup: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    ...shadow.card,
  },

  methodOptionDivider: {
    height: 1,
    marginHorizontal: spacing.md,
    backgroundColor: colors.border,
  },

  methodOptionCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
  },

  methodOptionCardSelected: {
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
    borderColor: colors.emerald,
  },

  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.emerald,
  },

  methodInfoBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.mist,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    marginTop: 4,
  },

  methodInfoText: {
    flex: 1,
    fontSize: 11,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    lineHeight: 14,
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

  payNowInlineTextPressed: {
    color: colors.emerald,
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
  advanceModalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(5, 25, 20, 0.56)" },
  advanceModalCard: {
    minHeight: "68%",
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  advanceModalHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  advanceModalTitle: { fontSize: fontSize.lg, fontFamily: fontFamily.bold, color: colors.ink },
  advanceModalSubtitle: { marginTop: 4, fontSize: fontSize.sm, fontFamily: fontFamily.regular, color: colors.textSecondary },
  advanceRateCard: { marginTop: spacing.xl, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.emeraldSoft },
  advanceRateLabel: { fontSize: fontSize.xs, fontFamily: fontFamily.medium, color: colors.textSecondary, textTransform: "uppercase" },
  advanceRateValue: { marginTop: 3, fontSize: fontSize.md, fontFamily: fontFamily.bold, color: colors.ink },
  advancePickerLabel: { marginTop: spacing.xl, textAlign: "center", fontSize: fontSize.sm, fontFamily: fontFamily.medium, color: colors.textSecondary },
  advancePicker: { marginTop: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xl },
  advancePickerButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 24, borderWidth: 1, borderColor: colors.emerald, backgroundColor: colors.white },
  advancePickerButtonDisabled: { opacity: 0.35 },
  advancePickerValue: { minWidth: 64, textAlign: "center", fontSize: 32, fontFamily: fontFamily.extrabold, color: colors.ink },
  advanceTotalCard: { marginTop: spacing.xl, padding: spacing.lg, gap: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.mist },
  advanceTotalDivider: { height: 1, backgroundColor: colors.border, marginVertical: 2 },
  advanceTotalLabel: { fontSize: fontSize.base, fontFamily: fontFamily.bold, color: colors.ink },
  advanceTotalValue: { fontSize: fontSize.lg, fontFamily: fontFamily.extrabold, color: colors.emerald },
  advanceModalActions: { marginTop: spacing.xl, flexDirection: "row", gap: spacing.sm },
  advanceCancelButton: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  advanceCancelText: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.ink },
  advanceCancelButtonPressed: { backgroundColor: colors.mist, transform: [{scale: 0.97}] },
  advanceCancelTextPressed: { color: colors.emerald },
  advanceRemoveButton: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colors.error },
  advanceRemoveText: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.error },
  advanceConfirmButton: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.emerald, ...shadow.button },
  advanceConfirmText: { fontSize: fontSize.sm, fontFamily: fontFamily.bold, color: colors.white },
  advanceConfirmButtonPressed: { backgroundColor: colors.ink, transform: [{scale: 0.97}] },
  advanceConfirmTextPressed: { color: colors.white },

  removeConfirmOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
    elevation: 20,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: "rgba(5, 25, 20, 0.68)",
  },
  removeConfirmCard: {
    width: "100%",
    padding: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: colors.white,
    ...shadow.card,
  },
  removeConfirmIcon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
    backgroundColor: colors.errorSoft,
  },
  removeConfirmTitle: {
    marginTop: spacing.md,
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },
  removeConfirmMessage: {
    marginTop: spacing.sm,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  removeConfirmAmounts: {
    marginTop: spacing.lg,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: radius.md,
    backgroundColor: colors.mist,
  },
  removeConfirmAmountRight: { alignItems: "flex-end" },
  removeConfirmAmountLabel: { fontSize: fontSize.xs, fontFamily: fontFamily.medium, color: colors.textMuted },
  removeConfirmOldAmount: { marginTop: 3, fontSize: fontSize.base, fontFamily: fontFamily.bold, color: colors.textSecondary },
  removeConfirmNewAmount: { marginTop: 3, fontSize: fontSize.base, fontFamily: fontFamily.bold, color: colors.emerald },
  removeConfirmArrow: { fontSize: fontSize.lg, fontFamily: fontFamily.bold, color: colors.textMuted },
  removeConfirmActions: { marginTop: spacing.xl, flexDirection: "row", gap: spacing.sm },
  removeConfirmKeep: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.emerald,
    backgroundColor: colors.white,
  },
  removeConfirmKeepPressed: { backgroundColor: colors.emeraldSoft, transform: [{scale: 0.97}] },
  removeConfirmKeepText: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.emerald },
  removeConfirmRemove: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.error,
  },
  removeConfirmRemovePressed: { opacity: 0.82, transform: [{scale: 0.97}] },
  removeConfirmRemoveText: { fontSize: fontSize.sm, fontFamily: fontFamily.bold, color: colors.white },

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
  webViewStatusText: {
    marginTop: 2,
    color: colors.emeraldSoft,
    fontSize: fontSize.xs,
    fontFamily: fontFamily.regular,
  },

  webViewClose: {
    padding: 4,
  },
  webViewCloseDisabled: {
    opacity: 0.35,
  },
  paymentLockOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    backgroundColor: "rgba(5, 25, 20, 0.78)",
  },
  paymentLockCard: {
    width: "100%",
    maxWidth: 360,
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    borderRadius: radius.xl,
    backgroundColor: colors.white,
    ...shadow.card,
  },
  paymentLockIcon: {
    width: 54,
    height: 54,
    marginBottom: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 27,
    backgroundColor: colors.emeraldSoft,
  },
  paymentLockTitle: {
    marginTop: spacing.lg,
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    textAlign: "center",
  },
  paymentLockMessage: {
    marginTop: spacing.sm,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    lineHeight: 20,
    textAlign: "center",
  },

  paymentSuccessOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    backgroundColor: colors.overlay,
  },
  paymentSuccessCard: {
    width: "100%",
    maxWidth: 380,
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.xxl,
    ...shadow.raised,
  },
  paymentSuccessIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.successSoft,
    marginBottom: spacing.md,
  },
  paymentSuccessTitle: {
    color: colors.ink,
    fontSize: fontSize.xl,
    fontFamily: fontFamily.bold,
    textAlign: "center",
  },
  paymentSuccessMessage: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    lineHeight: 20,
    textAlign: "center",
    marginTop: spacing.sm,
  },
  paymentSuccessDetails: {
    alignSelf: "stretch",
    backgroundColor: colors.mist,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  paymentSuccessDetailRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    marginVertical: 4,
  },
  paymentSuccessDetailLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
  },
  paymentSuccessDetailValue: {
    flexShrink: 1,
    color: colors.ink,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.bold,
    textAlign: "right",
  },
  paymentSuccessPending: {
    flexShrink: 1,
    color: colors.warning,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.bold,
    textAlign: "right",
  },
  paymentSuccessButton: {
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.emerald,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
  },
  paymentSuccessButtonPressed: {
    opacity: 0.85,
  },
  paymentSuccessButtonText: {
    color: colors.white,
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
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

});
