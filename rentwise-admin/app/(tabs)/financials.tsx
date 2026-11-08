import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Modal,
  ActivityIndicator,
  StyleSheet,
  Alert,
  RefreshControl,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Dimensions,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  onSnapshot,
  query,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { House, HelpCircle, Users, Receipt as ReceiptIcon, CheckCircle2, Eye, Clock, ArrowRight, ChevronDown, Search, X } from "lucide-react-native";
import { auth } from "../../shared/services/auth";
import { db } from "../../shared/services/firestore";
import { firebaseApp } from "../../shared/firebaseConfig";
import { readLocalCache, saveLocalCache } from "../../shared/services/localCache";
import { requireOnlineAction } from "../../shared/services/networkStatus";
import { logDetailedUpdate } from "../../shared/services/updatesService";
import HelpTour, { HelpStep } from "../components/HelpTour";
import HelpSupportModal from "../components/HelpSupportModal";
import { hasSeenPageTour, markPageTourSeen } from "../../shared/services/onboardingTour";
import {
  getReminderSchedule,
  setReminderSchedule,
  DEFAULT_REMINDER_HOUR,
  DEFAULT_REMINDER_MINUTE,
} from "../../shared/services/reminderSchedule";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";
import * as Print from "expo-print";
import RNBlobUtil from "react-native-blob-util";
import {
  getSavedReceiptDirectory,
  requestReceiptDirectoryAccess,
  saveBase64PdfToReceiptDirectory,
} from "../../shared/services/receiptStorage";

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

type StatusFilter = "All" | "Paid" | "Unpaid" | "Pending";

function scheduleIntervalDays(schedule: string): number {
  if (schedule === "daily") return 1;
  if (schedule === "weekly") return 7;
  if (schedule === "semi-monthly") return 15;
  return 30;
}

function scheduleAdvanceLimit(schedule: string): number {
  if (schedule === "daily") return 365;
  if (schedule === "weekly") return 52;
  if (schedule === "semi-monthly") return 24;
  return 12;
}

function rollingAmountDue(dailyRate: number, schedule: string, nextDueAt: Date | null, now: Date): number {
  const periodsDue = rollingPeriodsDue(schedule, nextDueAt, now);
  return Math.max(0, dailyRate) * scheduleIntervalDays(schedule) * periodsDue;
}

function rollingPeriodsDue(schedule: string, nextDueAt: Date | null, now: Date): number {
  if (!nextDueAt || Number.isNaN(nextDueAt.getTime()) || now < nextDueAt) return 0;
  const days = scheduleIntervalDays(schedule);
  return Math.floor((now.getTime() - nextDueAt.getTime()) / (days * 86400000)) + 1;
}

type TenantRow = {
  id: string;
  name: string;
  buildingNumber: string;
  spaceId: string;
  stallId: string;
  rent: number;
  paymentSchedule: string;
  status: "paid" | "unpaid" | "online";
  paymentId: string | null;
  pendingAtMs: number;
  pendingAmount: number;
  // Month-scoped balance (matches rentwise-tenant/app/dashboard.tsx): what's
  // due right now, accounting for whatever's already been paid this month.
  paymentDue: number;
  billingDaysDue: number;
  category: string;
  latestReceiptNo: string;
  latestPaidAmount: number;
};

type StallInfo = {
  buildingNumber: string;
  spaceId: string;
  price: number;
  paymentSchedule: string;
};

// The admin always enters the stall's DAILY rate. Every schedule's period
// charge is derived by multiplying that daily rate by however many days
// fall in the period containing `date`.
function computePeriodCharge(dailyRate: number, schedule: string, date: Date): number {
  return dailyRate * scheduleIntervalDays(schedule);
}

// Advances `d` to the start of the next billing period for `schedule`.
function nextPeriodStart(schedule: string, d: Date): Date {
  const n = new Date(d);
  n.setDate(n.getDate() + scheduleIntervalDays(schedule));
  return n;
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

// Names the tenant's own billing unit instead of the generic "periods" —
// reads more naturally, especially "cutoffs" for semi-monthly, which is
// the term actually used locally for that schedule.
function periodUnitLabel(schedule: string, count: number): string {
  return `${scheduleIntervalDays(schedule)}-day interval${count === 1 ? "" : "s"}`;
}

function normalizePaymentSchedule(value: unknown): string {
  const schedule = String(value ?? "").trim().toLowerCase();
  return ["daily", "weekly", "semi-monthly", "monthly"].includes(schedule)
    ? schedule
    : "monthly";
}

function paymentScheduleLabel(schedule: string): string {
  const days = scheduleIntervalDays(schedule);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

function formatPeso(amount: number): string {
  return `₱${Math.max(0, amount).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function paymentTimeMs(payment: any): number {
  const raw = payment?.createdAt ?? payment?.date;
  if (typeof raw?.toMillis === "function") return raw.toMillis();
  if (typeof raw?.seconds === "number") return raw.seconds * 1000;
  if (raw instanceof Date) return raw.getTime();
  const parsed = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

// Matches ampmTrack/ampmPill below: track is 68 tall with 3px padding on
// each side, so each half (and the pill sliding between them) is 31 tall.
const AMPM_PILL_HEIGHT = 31;

export default function Financials() {
  const insets = useSafeAreaInsets();
  const screenHeight = Dimensions.get("screen").height;

  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<TenantRow | null>(null);
  const [paymentModal, setPaymentModal] = useState(false);
  const [receiptModal, setReceiptModal] = useState(false);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [profileModal, setProfileModal] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<any>(null);
  const [profilePayments, setProfilePayments] = useState<any[]>([]);
  const [processing, setProcessing] = useState(false);
  const [openingPaymentId, setOpeningPaymentId] = useState<string | null>(null);
  const [approvingOnline, setApprovingOnline] = useState(false);
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);
  const openingPaymentRef = useRef(false);
  const approvingOnlineRef = useRef(false);
  const downloadingReceiptRef = useRef(false);
  const cashProcessingRef = useRef(false);
  const [cashReceived, setCashReceived] = useState("");
  const [paymentQuantity, setPaymentQuantity] = useState("0");
  const paymentKeyboardVisibleRef = useRef(false);
  const paymentModalScrollRef = useRef<ScrollView>(null);
  const [paymentKeyboardHeight, setPaymentKeyboardHeight] = useState(0);
  const [receiptPreviewModal, setReceiptPreviewModal] = useState(false);
  const [onlineConfirmModal, setOnlineConfirmModal] = useState(false);
  const [selectedOnlinePayment, setSelectedOnlinePayment] = useState<any>(null);
  const [legacyPaymentIntentId, setLegacyPaymentIntentId] = useState("");
  const [tourVisible, setTourVisible] = useState(false);
  const [helpSupportVisible, setHelpSupportVisible] = useState(false);

  const [reminderHour, setReminderHour] = useState(DEFAULT_REMINDER_HOUR);
  const [reminderMinute, setReminderMinute] = useState<0 | 30>(DEFAULT_REMINDER_MINUTE);
  const [showReminderModal, setShowReminderModal] = useState(false);

  const handleCashReceivedChange = (value: string) => {
    setCashReceived(value.replace(/\D/g, "").slice(0, 6));
  };
  const handlePaymentQuantityChange = (value: string) => {
    setPaymentQuantity(value.replace(/\D/g, "").slice(0, 3));
  };
  const revealPaymentFields = () => {
    // Wait until Android finishes resizing the modal for the keyboard, then
    // scroll the form instead of moving/recentering the whole modal.
    setTimeout(() => paymentModalScrollRef.current?.scrollToEnd({ animated: true }), 250);
  };
  const [savingReminder, setSavingReminder] = useState(false);

  useEffect(() => {
    const showSubscription = Keyboard.addListener("keyboardDidShow", (event) => {
      paymentKeyboardVisibleRef.current = true;
      setPaymentKeyboardHeight(event.endCoordinates.height);
      setTimeout(() => paymentModalScrollRef.current?.scrollToEnd({ animated: true }), 50);
    });
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
      paymentKeyboardVisibleRef.current = false;
      setPaymentKeyboardHeight(0);
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);
  // Draft values edited inside the modal -- only committed to
  // reminderHour/reminderMinute (and Firestore) on Save, so Cancel discards
  // any in-progress stepper taps.
  const [draftHour12, setDraftHour12] = useState(2);
  const [draftMinute, setDraftMinute] = useState<0 | 30>(30);
  const [draftIsPM, setDraftIsPM] = useState(true);
  // Drives the sliding AM/PM pill -- 0 = AM, 1 = PM.
  const ampmSlideAnim = useRef(new Animated.Value(1)).current;

  const [reminderSaved, setReminderSaved] = useState(false);
  const [reminderSavedText, setReminderSavedText] = useState("");
  const reminderToastFade = useRef(new Animated.Value(0)).current;
  const reminderToastTranslateY = useRef(new Animated.Value(20)).current;

  const userDocsRef = useRef<any[]>([]);
  const stallMapRef = useRef<Map<string, StallInfo>>(new Map());
  const paymentsRef = useRef<any[]>([]);

  const homeRef = useRef<View>(null);
  const helpRef = useRef<View>(null);
  const summaryRef = useRef<View>(null);
  const searchRef = useRef<View>(null);
  const filterRef = useRef<View>(null);
  const reminderTimeRef = useRef<View>(null);
  const listRef = useRef<View>(null);
  const viewBtnRef = useRef<View>(null);
  const listScrollRef = useRef<ScrollView>(null);

  // Scrolls a given section into view and gives the ScrollView time to
  // settle before HelpTour measures it — otherwise a row near the bottom of
  // it can still be outside the viewport when its spotlight is measured.
  const scrollSectionIntoView = (targetRef: React.RefObject<View | null>) =>
    new Promise<void>((resolve) => {
      const scrollNode = listScrollRef.current?.getNativeScrollRef?.();
      if (!scrollNode || !targetRef.current) { resolve(); return; }
      targetRef.current.measureLayout(
        scrollNode as any,
        (_x: number, y: number) => {
          listScrollRef.current?.scrollTo({ y: Math.max(0, y - 100), animated: true });
          setTimeout(resolve, 400);
        },
        () => resolve(),
      );
    });

  // Auth guard — redirect if not signed in
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace("/");
        return;
      }
      setChecking(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (checking) return;
    getReminderSchedule()
      .then(({ hour, minute }) => {
        setReminderHour(hour);
        setReminderMinute(minute);
      })
      .catch((err) => {
        // Falls back to the defaults already in state (14:30) -- most likely
        // cause is the settings/reminderSchedule Firestore rule not being
        // deployed yet, or the doc not existing yet.
        console.error("GET REMINDER SCHEDULE ERROR:", err);
      });
  }, [checking]);

  useEffect(() => {
    if (!reminderSaved) return;
    reminderToastFade.setValue(0);
    reminderToastTranslateY.setValue(20);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(reminderToastFade, { toValue: 1, duration: 450, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(reminderToastTranslateY, { toValue: 0, duration: 450, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]),
      Animated.delay(1000),
      Animated.parallel([
        Animated.timing(reminderToastFade, { toValue: 0, duration: 450, easing: Easing.in(Easing.back(1.5)), useNativeDriver: true }),
        Animated.timing(reminderToastTranslateY, { toValue: -10, duration: 450, easing: Easing.in(Easing.back(1.5)), useNativeDriver: true }),
      ]),
    ]).start(() => setReminderSaved(false));
  }, [reminderSaved]);

  function openReminderModal() {
    const isPM = reminderHour >= 12;
    const hour12 = reminderHour % 12 === 0 ? 12 : reminderHour % 12;
    setDraftHour12(hour12);
    setDraftMinute(reminderMinute);
    setDraftIsPM(isPM);
    // Snap instantly to the right side on open -- this is initializing the
    // modal's state, not a user-driven toggle, so it shouldn't animate.
    ampmSlideAnim.setValue(isPM ? 1 : 0);
    setShowReminderModal(true);
  }

  function toggleAmPm(isPM: boolean) {
    setDraftIsPM(isPM);
    Animated.timing(ampmSlideAnim, {
      toValue: isPM ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }

  async function saveReminderTime() {
    if (!(await requireOnlineAction("Saving the reminder schedule"))) return;
    const hour24 = draftIsPM
      ? (draftHour12 % 12) + 12
      : draftHour12 % 12;
    setSavingReminder(true);
    try {
      await setReminderSchedule({ hour: hour24, minute: draftMinute });
      setReminderHour(hour24);
      setReminderMinute(draftMinute);
      setShowReminderModal(false);
      setReminderSavedText(formatReminderTime(hour24, draftMinute));
      setReminderSaved(true);
    } catch (err) {
      console.error("SAVE REMINDER TIME ERROR:", err);
      Alert.alert("Error", "Failed to save reminder time. Please try again.");
    } finally {
      setSavingReminder(false);
    }
  }

  function formatReminderTime(hour24: number, minute: number): string {
    const isPM = hour24 >= 12;
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    return `${hour12}:${minute.toString().padStart(2, "0")} ${isPM ? "PM" : "AM"}`;
  }

  // selectedTenant is a one-time snapshot taken when a modal opens (e.g.
  // "Set Paid" / cash payment) -- rows keeps updating live in the
  // background (payments listener, refreshUsersAndStalls) but that snapshot
  // otherwise never does, so computedRent/change etc. could show stale
  // numbers if the tenant's real paymentDue changes while the modal is
  // still open (e.g. another payment lands, or an admin on another device
  // confirms one). Re-syncing it to the matching live row keeps every
  // value derived from it current for as long as the modal stays open.
  useEffect(() => {
    if (!selectedTenant) return;
    const fresh = rows.find((r) => r.id === selectedTenant.id);
    // computeRows builds a brand-new object every time regardless of
    // whether anything actually changed, so compare the fields that feed
    // computedRent/change/periodsOwed rather than object identity --
    // otherwise this would re-render the open modal (and disrupt the cash
    // input's focus) on every single payments snapshot, even ones that
    // didn't touch this tenant at all.
    if (
      fresh &&
      (fresh.paymentDue !== selectedTenant.paymentDue ||
        fresh.rent !== selectedTenant.rent ||
        fresh.paymentSchedule !== selectedTenant.paymentSchedule ||
        fresh.status !== selectedTenant.status ||
        fresh.paymentId !== selectedTenant.paymentId)
    ) {
      setSelectedTenant(fresh);
    }
  }, [rows, selectedTenant]);

  // Auto-opens the guided tour the first time the admin ever lands on this
  // page — never again after that, since it flips a persisted per-device
  // flag. Can still be replayed anytime via the Help button.
  useEffect(() => {
    if (checking) return;
    (async () => {
      const seen = await hasSeenPageTour("financials");
      if (!seen) {
        setTourVisible(true);
        await markPageTourSeen("financials");
      }
    })();
  }, [checking]);

  // Build the tenant-row list from current users/stalls + live payments
  const computeRows = (allPayments: any[]) => {
    const userDocs = userDocsRef.current;
    const stallMap = stallMapRef.current;
    const today = new Date();

    const tenantList: TenantRow[] = userDocs.map((d) => {
      const u = d.data();
      const stall = stallMap.get(u.stallId);
      const tenantPayments = allPayments.filter((p) => p.userId === d.id);
      // Billing terms live on the tenant, not the stall -- travels with
      // them if relocated, instead of reflecting whoever's stall this is.
      const schedule = normalizePaymentSchedule(u.paymentSchedule);
      const dailyRate = u.price ?? 0;

      const latestApprovedPayment = tenantPayments
        .filter((p) => p.status === "approved")
        .sort((a, b) => Number(b.date?.seconds ?? 0) - Number(a.date?.seconds ?? 0))[0];

      const storedNextDue = u.nextDueAt ?? u.billingStartedAt ?? u.createdAt;
      const nextDueAt = storedNextDue?.toDate ? storedNextDue.toDate() : null;
      const paymentDue = rollingAmountDue(dailyRate, schedule, nextDueAt, today);
      const billingDaysDue = scheduleIntervalDays(schedule) * rollingPeriodsDue(schedule, nextDueAt, today);

      let tenantStatus: "paid" | "unpaid" | "online" = "unpaid";
      let paymentId: null | string = null;

      // A pending online payment always needs admin action (confirm it),
      // regardless of whether the tenant is otherwise caught up.
      const pendingPayment = tenantPayments
        .filter((p) => p.status === "pending")
        .sort((a, b) => paymentTimeMs(b) - paymentTimeMs(a))[0];
      if (pendingPayment) {
        tenantStatus = "online";
        paymentId = pendingPayment.id;
      } else if (paymentDue <= 0) {
        // Caught up through today's period — this is exactly what the "Set
        // to Paid" modal clears (computedRent === paymentDue), so paying
        // that amount should immediately flip the badge to Paid. The old
        // check required the tenant to have prepaid the ENTIRE calendar
        // month, which kept them stuck on Unpaid even right after paying
        // exactly what was due.
        tenantStatus = "paid";
      }

      return {
        id: d.id,
        name: [u.firstName, u.middleName, u.lastName].filter(Boolean).join(" "),
        buildingNumber: stall?.buildingNumber ?? "",
        spaceId: stall?.spaceId ?? "",
        stallId: u.stallId ?? "",
        rent: u.price ?? 0,
        paymentSchedule: schedule,
        status: tenantStatus,
        paymentId,
        pendingAtMs: pendingPayment ? paymentTimeMs(pendingPayment) : 0,
        pendingAmount: pendingPayment
          ? Number(pendingPayment.amount ?? pendingPayment.paymentAmount ?? 0)
          : 0,
        paymentDue,
        billingDaysDue,
        category: String(u.marketCategory ?? u.businessType ?? u.category ?? "Market Tenant"),
        latestReceiptNo: String(latestApprovedPayment?.receiptNo ?? ""),
        latestPaidAmount: Number(latestApprovedPayment?.amount ?? latestApprovedPayment?.paymentAmount ?? 0),
      };
    });

    tenantList.sort((a, b) => {
      const spaceA = Number(a.spaceId.split("-")[1]);
      const spaceB = Number(b.spaceId.split("-")[1]);
      return spaceA - spaceB;
    });

    setRows(tenantList);
    void saveLocalCache("admin:financials", tenantList);
  };

  // Re-fetches users+stalls (not live) and recomputes rows against the
  // latest cached payments snapshot (which stays live via onSnapshot).
  const refreshUsersAndStalls = async () => {
    const [usersSnap, stallsSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, "users"),
          where("role", "==", "tenant"),
          where("status", "==", "active"),
        ),
      ),
      getDocs(collection(db, "stalls")),
    ]);

    const stallMap = new Map<string, StallInfo>();
    stallsSnap.docs.forEach((d) => {
      const s = d.data();
      stallMap.set(d.id, {
        buildingNumber: String(s.buildingNumber ?? ""),
        spaceId: s.spaceId ?? "",
        price: Number(s.price ?? 0),
        paymentSchedule: normalizePaymentSchedule(s.paymentSchedule),
      });
    });

    userDocsRef.current = usersSnap.docs;
    stallMapRef.current = stallMap;
    computeRows(paymentsRef.current);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshUsersAndStalls();
    } catch (e) {
      console.log("FINANCIALS REFRESH ERROR:", e);
    } finally {
      setRefreshing(false);
    }
  };

  // On every screen focus: refresh users+stalls then open a live payments listener
  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      let unsubPayments: (() => void) | undefined;
      let unsubPendingPayments: (() => void) | undefined;
      let unsubUsers: (() => void) | undefined;
      let unsubStalls: (() => void) | undefined;

      const setup = async () => {
        try {
          await refreshUsersAndStalls();

          unsubUsers = onSnapshot(
            query(
              collection(db, "users"),
              where("role", "==", "tenant"),
              where("status", "==", "active"),
            ),
            (usersSnap) => {
              userDocsRef.current = usersSnap.docs;
              computeRows(paymentsRef.current);
            },
          );

          unsubStalls = onSnapshot(collection(db, "stalls"), (stallsSnap) => {
            const stallMap = new Map<string, StallInfo>();
            stallsSnap.docs.forEach((d) => {
              const stall = d.data();
              stallMap.set(d.id, {
                buildingNumber: String(stall.buildingNumber ?? ""),
                spaceId: stall.spaceId ?? "",
                price: Number(stall.price ?? 0),
                paymentSchedule: normalizePaymentSchedule(stall.paymentSchedule),
              });
            });
            stallMapRef.current = stallMap;
            computeRows(paymentsRef.current);
          });

          // Real-time payments listener — fires immediately then on every change
          let approvedPayments: any[] = [];
          let pendingPayments: any[] = [];
          const publishPayments = () => {
            const allPayments = [...approvedPayments, ...pendingPayments];
            paymentsRef.current = allPayments;
            computeRows(allPayments);
            setLoading(false);
          };
          const paymentWindowStart = Timestamp.fromDate(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1));
          unsubPayments = onSnapshot(
            query(collection(db, "payments"), where("status", "==", "approved"), where("date", ">=", paymentWindowStart)),
            (paymentsSnap) => {
              approvedPayments = paymentsSnap.docs.map((d) => ({
                id: d.id,
                ...d.data(),
              }));
              publishPayments();
            },
            (err) => {
              console.log("FINANCIALS PAYMENTS LISTENER ERROR:", err);
              setLoading(false);
            },
          );
          unsubPendingPayments = onSnapshot(
            query(collection(db, "payments"), where("status", "==", "pending")),
            (paymentsSnap) => {
              pendingPayments = paymentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
              publishPayments();
            },
            (err) => console.log("FINANCIALS PENDING PAYMENTS LISTENER ERROR:", err),
          );
        } catch (e) {
          console.log("FINANCIALS FETCH ERROR:", e);
          const cached = await readLocalCache<TenantRow[]>("admin:financials");
          if (cached) setRows(cached);
          setLoading(false);
        }
      };

      setup();

      return () => {
        if (unsubUsers) unsubUsers();
        if (unsubStalls) unsubStalls();
        if (unsubPayments) unsubPayments();
        if (unsubPendingPayments) unsubPendingPayments();
      };
    }, []),
  );

  const downloadReceipt = async () => {
    if (!receiptData || downloadingReceiptRef.current) return;

    downloadingReceiptRef.current = true;
    setDownloadingReceipt(true);
    try {
      if (!(await confirmReceiptFolderAccess())) return;

      const receiptNo =
        receiptData.receiptNo ?? "RW-" + Date.now().toString().slice(-8);

      const html = `
    <html>
      <body style="font-family: Arial; padding:30px;">
        <h1 style="text-align:center;">RentWise</h1>
        <h2 style="text-align:center;">Tenant's Digital Receipt</h2>
        <hr/>
        <p><b>Receipt No:</b> ${receiptNo || "N/A"}</p>
        <p><b>Tenant Name:</b> ${receiptData.tenantName || "N/A"}</p>
        <p><b>Building Number:</b> ${receiptData.buildingNumber || "N/A"}</p>
        <p><b>Space ID:</b> ${receiptData.spaceId || "N/A"}</p>
        <p><b>Date:</b> ${receiptData.date instanceof Date ? receiptData.date.toDateString() : new Date(receiptData.date).toDateString()}</p>
        <p><b>Rent Amount:</b> ₱${receiptData.rentAmount}</p>
        <p><b>Payment:</b> ₱${receiptData.payment}</p>
        <p><b>Change:</b> ₱${receiptData.change}</p>
        <p><b>Approval Status:</b> ${receiptData.status || "N/A"}</p>
        <hr/>
        <h3 style="text-align:center;">Thank you for your payment</h3>
      </body>
    </html>
    `;

      const { base64 } = await Print.printToFileAsync({ html, base64: true });

      const fileName = `receipt-${receiptNo}.pdf`;
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
    } catch (error) {
      console.log("PDF ERROR", error);
      Alert.alert("Error", "Failed to generate or download the receipt.");
    } finally {
      downloadingReceiptRef.current = false;
      setDownloadingReceipt(false);
    }
  };

  const confirmOnlinePayment = async (row: TenantRow) => {
    if (!row.paymentId || openingPaymentRef.current) return;

    openingPaymentRef.current = true;
    setOpeningPaymentId(row.paymentId);
    try {
      if (!(await requireOnlineAction("Acknowledging an online payment"))) return;
      const paymentRef = doc(db, "payments", row.paymentId);

      const paymentSnap = await getDoc(paymentRef);

      if (!paymentSnap.exists()) return;

      const payment = paymentSnap.data();

      let coveredStalls = Array.isArray(payment.stalls) && payment.stalls.length > 0
        ? payment.stalls
        : Array.isArray(payment.receiptData?.stalls) ? payment.receiptData.stalls : [];
      // Legacy pending payments predate the immutable receipt stall snapshot.
      // Read the tenant's current assignments only as a display fallback; no
      // payment or tenant document is modified here.
      if (coveredStalls.length === 0) {
        const tenantSnap = await getDoc(doc(db, "users", row.id));
        if (tenantSnap.exists()) {
          const tenantData = tenantSnap.data();
          const ids = [...new Set([
            ...(Array.isArray(tenantData.stallIds) ? tenantData.stallIds.map(String) : []),
            String(tenantData.primaryStallId ?? tenantData.stallId ?? ""),
          ].filter(Boolean))].slice(0, 3);
          const stallSnaps = await Promise.all(ids.map((id) => getDoc(doc(db, "stalls", id))));
          coveredStalls = stallSnaps.filter((snap) => snap.exists()).map((snap) => ({
            stallId: snap.id,
            buildingNumber: String(snap.data()?.buildingNumber ?? ""),
            spaceId: String(snap.data()?.spaceId ?? snap.id),
            dailyRate: Number(snap.data()?.price ?? 0),
          }));
        }
      }

      setSelectedTenant(row);
      setSelectedOnlinePayment(payment);
      setLegacyPaymentIntentId("");

      // `date` can come back as a Firestore Timestamp, a plain Date, an ISO
      // string, or (briefly, if read right after a serverTimestamp() write
      // resolves from local cache) missing entirely — handle all of them
      // instead of only the Timestamp case, and fall back to "now" rather
      // than showing a blank field. Kept as an actual Date object (not a
      // string) — `receiptData` is shared with the cash-payment "Tenant's
      // Digital Receipt" modal below, which calls `.toDateString()` on it
      // directly since Modal still renders hidden children in RN.
      const rawDate = payment.date;
      const parsedDate =
        rawDate?.toDate?.() ??
        (rawDate instanceof Date ? rawDate : null) ??
        (rawDate ? new Date(rawDate) : null);
      const resolvedDate =
        parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate : new Date();

      setReceiptData({
        receiptNo: payment.receiptNo ?? "",
        tenantName: row.name,
        buildingNumber: row.buildingNumber,
        spaceId: row.spaceId,
        date: resolvedDate,
        paymentMethod: payment.paymentMethod ?? "",

        // IMPORTANT PART
        rentAmount: payment.rentAmount,
        payment: payment.amount,
        change: payment.change ?? 0,

        status: payment.status,
        periodsCovered: payment.periodsCovered ?? 1,
        periodsAdvance: payment.periodsAdvance ?? 0,
        stalls: coveredStalls,
        // Same itemized, date-labeled lines the tenant saw when they paid --
        // stored on the payment doc at creation, so this reads the real
        // breakdown instead of re-deriving an approximation of it.
        breakdown: payment.receiptData?.breakdown ?? [],
      });

      setOnlineConfirmModal(true);
    } catch (error) {
      console.log("OPEN RECEIPT ERROR:", error);
      Alert.alert("Unable to open payment", "Please try again.");
    } finally {
      openingPaymentRef.current = false;
      setOpeningPaymentId(null);
    }
  };

  // What the tenant currently owes, matching the same balance the tenant
  // sees as "Payment" on their own dashboard — not just a flat per-period
  // rate, so a tenant who's already partly paid this month isn't overcharged.
  const computedRent = selectedTenant ? Math.max(0, selectedTenant.paymentDue) : 0;

  // How many billing periods the Rent Amount actually covers — lets the modal explain
  // *why* the total is what it is (e.g. "5 days x P120") instead of just showing a
  // lump sum that looks wrong if the tenant missed a few periods.
  const periodCharge = selectedTenant
    ? computePeriodCharge(selectedTenant.rent, selectedTenant.paymentSchedule, new Date())
    : 0;
  const periodsOwed = periodCharge > 0 ? Math.max(1, Math.round(computedRent / periodCharge)) : 1;
  const advanceQuantity = Math.max(0, Number(paymentQuantity) || 0);
  const quantity = periodsOwed + advanceQuantity;
  const quantityLimit = scheduleAdvanceLimit(selectedTenant?.paymentSchedule ?? "monthly");
  const paymentTotal = periodCharge * quantity;
  const change = Number(cashReceived || 0) - paymentTotal;
  const dueDays = periodsOwed * scheduleIntervalDays(selectedTenant?.paymentSchedule ?? "monthly");
  const scheduleQuantityLabel = selectedTenant?.paymentSchedule === "daily" ? "Days"
    : selectedTenant?.paymentSchedule === "weekly" ? "Weeks"
      : selectedTenant?.paymentSchedule === "semi-monthly" ? "15-day intervals" : "Months";
  const additionalQuantityLabel = selectedTenant?.paymentSchedule === "daily" ? "Additional days"
    : selectedTenant?.paymentSchedule === "weekly" ? "Additional weeks"
      : selectedTenant?.paymentSchedule === "semi-monthly" ? "Additional 15-day intervals" : "Additional months";

  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const filteredRows = rows
    .filter((r) => {
      if (normalizedSearch && !r.name.toLocaleLowerCase().includes(normalizedSearch)) return false;
      if (filter === "Paid") return r.status === "paid";
      if (filter === "Unpaid") return r.status === "unpaid";
      if (filter === "Pending") return r.status === "online";
      return true;
    })
    .sort((a, b) => {
      // New online transactions stay at the top until confirmed. Once the
      // live payment status changes, this condition no longer applies and
      // the tenant returns to the normal building/space order from rows.
      if (a.status === "online" && b.status !== "online") return -1;
      if (a.status !== "online" && b.status === "online") return 1;
      if (a.status === "online" && b.status === "online") return b.pendingAtMs - a.pendingAtMs;
      return 0;
    });

  const spacesCount = rows.length;
  const paidCount = rows.filter((r) => r.status === "paid").length;
  const unpaidCount = rows.filter((r) => r.status === "unpaid").length;
  const pendingCount = rows.filter((r) => r.status === "online").length;

  const tourSteps: HelpStep[] = [
    { key: "home", ref: homeRef, title: "Home", description: "Takes you back to the dashboard.", edgeInset: "top", round: true },
    // Moved right after "home" (was last) -- placing it right before the
    // "view" step specifically triggered a visual glitch on transition (a
    // stray highlight briefly appearing over the previous target) that
    // reordering sidesteps entirely, since nothing transitions INTO fab
    // from a scrolled list row anymore.
    { key: "summary", ref: summaryRef, title: "Payment summary", description: "Tracks all active spaces and separates paid, unpaid, and pending online payments waiting for confirmation.", edgeInset: "top" },
    { key: "search", ref: searchRef, title: "Search", description: "Find a tenant quickly by typing their name.", edgeInset: "top" },
    { key: "filter", ref: filterRef, title: "Status filter", description: "Narrow the list to only paid or only unpaid tenants.", edgeInset: "top" },
    { key: "reminderTime", ref: reminderTimeRef, title: "Reminder time", description: "Set what time tenants get their daily payment reminder.", edgeInset: "top" },
    { key: "list", ref: listRef, title: "Tenant list", description: "Shows each tenant's payment schedule, current due amount, and payment status. Unpaid tenants show Set Paid, while pending online payments show Confirm.", edgeInset: "top" },
  ];
  if (filteredRows.length > 0) {
    tourSteps.push({ key: "view", ref: viewBtnRef, title: "View", description: "Opens this tenant's full payment details and history.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(viewBtnRef) });
  }

  if (checking) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator color={colors.emerald} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      {/* HEADER */}
      <LinearGradient
        colors={[colors.emerald, colors.ink]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
          <View ref={homeRef} collapsable={false}>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => router.push("/dashboard")}
              activeOpacity={0.7}
            >
              <House size={24} color={colors.emeraldSoft} />
            </TouchableOpacity>
          </View>
          <Text style={styles.headerTitle}>RentWise</Text>
          <View ref={helpRef} collapsable={false}>
            <TouchableOpacity onPress={() => setHelpSupportVisible(true)} activeOpacity={0.7} style={styles.iconBtn}>
              <HelpCircle size={22} color={colors.emeraldSoft} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Sub-header */}
        <View style={styles.subHeader}>
          <Text style={styles.pageTitle}>Financials</Text>
        </View>
      </LinearGradient>

      {/* BODY */}
      <View style={styles.body}>
        {/* SUMMARY STATS */}
        <View style={styles.summaryRow} ref={summaryRef} collapsable={false}>
          <View style={styles.summaryOverviewCard}>
            <View style={styles.summarySpacesBlock}>
              <Text style={styles.summaryTotalValue}>{spacesCount}</Text>
              <Text style={styles.summaryTotalLabel}>Total Spaces</Text>
              <Text style={styles.summaryTotalHint}>Active Lease Units</Text>
            </View>
            <View style={styles.summaryStatusList}>
              <View style={styles.summaryStatusRow}>
                <View style={styles.summaryStatusLabelWrap}>
                  <View style={[styles.summaryDot, styles.summaryDotPaid]} />
                  <Text style={styles.summaryStatusLabel}>Paid</Text>
                </View>
                <Text style={[styles.summaryStatusValue, styles.summaryPaidValue]}>{paidCount}</Text>
              </View>
              <View style={styles.summaryStatusRow}>
                <View style={styles.summaryStatusLabelWrap}>
                  <View style={[styles.summaryDot, styles.summaryDotUnpaid]} />
                  <Text style={styles.summaryStatusLabel}>Unpaid</Text>
                </View>
                <Text style={[styles.summaryStatusValue, styles.summaryUnpaidValue]}>{unpaidCount}</Text>
              </View>
              <View style={styles.summaryStatusRow}>
                <View style={styles.summaryStatusLabelWrap}>
                  <View style={[styles.summaryDot, styles.summaryDotPending]} />
                  <Text style={styles.summaryStatusLabel}>Pending</Text>
                </View>
                <Text style={styles.summaryStatusValue}>{pendingCount}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* TENANT SEARCH */}
        <View style={styles.searchWrap} ref={searchRef} collapsable={false}>
          <Search size={19} color={colors.textSecondary} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search tenant name"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="search"
            style={styles.searchInput}
            accessibilityLabel="Search tenants by name"
          />
          {searchQuery.length > 0 ? (
            <TouchableOpacity onPress={() => setSearchQuery("")} style={styles.searchClearBtn} accessibilityLabel="Clear tenant search">
              <X size={17} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* STATUS FILTER */}
        <View style={styles.filterRow}>
          <View style={styles.filterStatusGroup} ref={filterRef} collapsable={false}>
          <View style={styles.segmentTrack}>
            {(["All", "Paid", "Unpaid", "Pending"] as StatusFilter[]).map((opt) => (
              <TouchableOpacity
                key={opt}
                style={[styles.segmentItem, filter === opt && styles.segmentItemActive]}
                onPress={() => setFilter(opt)}
                activeOpacity={0.8}
              >
                <Text style={[styles.segmentText, filter === opt && styles.segmentTextActive]}>
                  {opt}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          </View>
          <View ref={reminderTimeRef} collapsable={false} style={styles.reminderTimeWrap}>
            <TouchableOpacity
              style={styles.reminderTimeBtn}
              onPress={openReminderModal}
              activeOpacity={0.7}
            >
              <Clock size={13} color={colors.ink} />
              <Text style={styles.reminderTimeBtnText}>
                {formatReminderTime(reminderHour, reminderMinute)}
              </Text>
              <ChevronDown size={13} color={colors.ink} />
            </TouchableOpacity>
          </View>
        </View>

        {/* TENANT INFO CARD */}
        {loading ? (
          <View style={styles.centeredBox}>
            <ActivityIndicator size="large" color={colors.emerald} />
          </View>
        ) : (
          <View style={styles.card} ref={listRef} collapsable={false}>
            {filteredRows.length === 0 ? (
              <View style={styles.emptyBox}>
                <Users size={40} color={colors.borderStrong} style={styles.emptyIcon} />
                <Text style={styles.emptyText}>{normalizedSearch ? `No tenants match “${searchQuery.trim()}”.` : "No tenants found."}</Text>
              </View>
            ) : (
              <ScrollView
                ref={listScrollRef}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
                refreshControl={
                  <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />
                }
              >
                {filteredRows.map((item, idx) => item.status === "paid" ? (
                  <View key={item.id} style={[styles.tenantCard, styles.tenantCardPaid]}>
                    <View style={styles.tenantHeaderRow}>
                      <View style={styles.paidTenantCopy}>
                        <Text style={[styles.rowName, styles.rowNamePaid]} numberOfLines={1}>{item.name}</Text>
                        <Text style={styles.paidTenantMeta} numberOfLines={1}>B{item.buildingNumber} · {item.spaceId}  {item.category || "Market Tenant"} · {paymentScheduleLabel(item.paymentSchedule)}</Text>
                      </View>
                      <View style={[styles.statusTag, styles.statusTagPaid]}><Text style={[styles.statusTagText, styles.statusTagTextPaid]}>Paid</Text></View>
                    </View>
                    <View style={styles.paidReceiptRow}>
                      <Text style={styles.receiptSummary} numberOfLines={1}>▤ Receipt {item.latestReceiptNo ? `#${item.latestReceiptNo}` : "record"}{item.latestPaidAmount > 0 ? ` · ${formatPeso(item.latestPaidAmount)}` : ""}</Text>
                      <View ref={idx === 0 ? viewBtnRef : undefined} collapsable={false} style={styles.compactViewWrap}>
                        <Pressable style={({ pressed }) => [styles.compactViewBtn, pressed && styles.viewInfoBtnPressed]} onPress={() => router.push({ pathname: "/tenant-preview", params: { tenantId: item.id } })}>
                          {({ pressed }) => <><Eye size={14} color={pressed ? colors.white : colors.ink} /><Text style={[styles.compactViewText, pressed && styles.viewInfoBtnTextPressed]}>View</Text></>}
                        </Pressable>
                      </View>
                    </View>
                  </View>
                ) : (
                  <View key={item.id} style={styles.tenantCard}>
                    {/* TENANT INFO */}
                    <View style={styles.rowLeft}>
                      <Text style={styles.rowName}>{item.name}</Text>
                      <View style={styles.rowMetaWrap}>
                        <Text style={styles.rowMeta}>
                          B{item.buildingNumber} · {item.spaceId}
                        </Text>
                        <Text style={styles.categoryText} numberOfLines={1}>{item.category || "Market Tenant"}</Text>
                        <View style={[styles.statusTag, styles.nonPaidStatusTag, item.status === "online" ? styles.statusTagPending : styles.statusTagUnpaid]}>
                          <Text style={[styles.statusTagText, item.status === "online" ? styles.statusTagTextPending : styles.statusTagTextUnpaid]}>{item.status === "online" ? "Pending" : "Unpaid"}</Text>
                        </View>
                      </View>
                      <View style={styles.cardDivider} />
                      <Text style={styles.billingLabel}>Billing Cadence</Text>
                      <Text
                        style={styles.rowSchedule}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.8}
                      >
                        {item.billingDaysDue > 0
                          ? `${item.billingDaysDue} ${item.billingDaysDue === 1 ? "day" : "days"}`
                          : paymentScheduleLabel(item.paymentSchedule)}
                      </Text>
                      <View style={styles.rowDueWrap}>
                        <Text style={[styles.rowDueValue, item.paymentDue <= 0 && styles.rowDueValuePaid]}>
                          {formatPeso(item.status === "online" ? (item.pendingAmount ?? 0) : item.paymentDue)}
                        </Text>
                      </View>
                    </View>

                    {/* ACTION BUTTONS — Set Paid on top, View below */}
                    <View style={styles.actionBtns}>
                      {/* PAYMENT BUTTON — hidden once already paid, nothing to action */}
                        <Pressable
                          style={({ pressed }) => [
                            styles.setPaidBtn,
                            item.status === "online" && styles.setPaidBtnOnline,
                            openingPaymentId === item.paymentId && { opacity: 0.65 },
                            pressed && openingPaymentId !== item.paymentId && (item.status === "online" ? styles.setPaidBtnOnlinePressed : styles.setPaidBtnPressed),
                          ]}
                          disabled={openingPaymentId !== null}
                          onPress={async () => {
                            if (item.status === "online") {
                              await confirmOnlinePayment(item);
                            } else {
                              setSelectedTenant(item);
                              setCashReceived("");
                              setPaymentQuantity("0");
                              setPaymentModal(true);
                            }
                          }}
                        >
                          {({ pressed }) => openingPaymentId === item.paymentId ? (
                            <ActivityIndicator size="small" color={colors.warning} />
                          ) : (
                            <>
                              <CheckCircle2
                                size={14}
                                color={item.status === "online" ? (pressed ? colors.white : colors.warning) : (pressed ? colors.emerald : colors.white)}
                                style={styles.setPaidBtnIcon}
                              />
                              <Text
                                style={[
                                  styles.setPaidBtnText,
                                  item.status === "online" && styles.setPaidBtnTextOnline,
                                  pressed && (item.status === "online" ? styles.setPaidBtnTextOnlinePressed : styles.setPaidBtnTextPressed),
                                ]}
                              >
                                {item.status === "online" ? "Confirm" : "Set Paid"}
                              </Text>
                            </>
                          )}
                        </Pressable>

                      {/* VIEW INFO BUTTON */}
                      <View ref={idx === 0 ? viewBtnRef : undefined} collapsable={false} style={styles.viewBtnWrap}>
                      <Pressable
                        style={({ pressed }) => [
                          styles.viewInfoBtn,
                          pressed && styles.viewInfoBtnPressed,
                        ]}
                        onPress={() => {
                          router.push({
                            pathname: "/tenant-preview",
                            params: { tenantId: item.id },
                          });
                        }}
                      >
                        {({ pressed }) => (
                          <>
                            <Eye size={14} color={pressed ? colors.white : colors.emerald} style={styles.setPaidBtnIcon} />
                            <Text style={[styles.viewInfoBtnText, pressed && styles.viewInfoBtnTextPressed]}>View</Text>
                          </>
                        )}
                      </Pressable>
                      </View>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        )}
      </View>

      {/* CASH PAYMENT MODAL */}
      <Modal
        visible={paymentModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (paymentKeyboardVisibleRef.current) {
            Keyboard.dismiss();
            return;
          }
          if (!processing) setPaymentModal(false);
        }}
      >
        <KeyboardAvoidingView
          style={styles.modalBg}
          // Android already resizes the visible window for the keyboard.
          // Applying KAV padding there as well makes this centered modal
          // alternate between two layouts while a controlled input updates.
          // Let Android perform the single native movement; iOS still needs
          // the explicit padding adjustment.
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}
        >
          <View
            style={[
              styles.payModalBox,
              {
                maxHeight: paymentKeyboardHeight > 0
                  ? Math.max(300, screenHeight - paymentKeyboardHeight - insets.top - 20)
                  : screenHeight * 0.9,
              },
            ]}
          >
            <LinearGradient
              colors={[colors.emerald, colors.ink]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.payModalTitleRow}
            >
              <View style={styles.payModalBadge}>
                <Text style={styles.payModalBadgeText}>₱</Text>
              </View>
              <Text style={styles.payModalTitle}>Payment Confirmation</Text>
            </LinearGradient>
            <ScrollView
              ref={paymentModalScrollRef}
              style={styles.payModalScroll}
              contentContainerStyle={styles.payModalBody}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
            <View style={styles.payModalRow}>
              <Text style={styles.payModalLabel}>Tenant Name</Text>
              <Text style={styles.modalValue}>{selectedTenant?.name}</Text>
            </View>
            <View style={styles.payModalRow}>
              <Text style={styles.payModalLabel}>Building Number</Text>
              <Text style={styles.modalValue}>
                {selectedTenant?.buildingNumber}
              </Text>
            </View>
            <View style={styles.payModalRow}>
              <Text style={styles.payModalLabel}>Space ID</Text>
              <Text style={styles.modalValue}>{selectedTenant?.spaceId}</Text>
            </View>
            <View style={styles.payModalRow}>
              <Text style={styles.payModalLabel}>Date</Text>
              <Text style={styles.modalValue}>{new Date().toDateString()}</Text>
            </View>
            <View style={styles.payModalRow}>
              <Text style={styles.payModalLabel}>Days</Text>
              <Text style={styles.modalValue}>{dueDays}</Text>
            </View>
            <View style={styles.payModalRow}>
              <View>
                <Text style={styles.payModalLabel}>Advance Payment</Text>
                <Text style={styles.payModalSubLabel}>{additionalQuantityLabel}</Text>
              </View>
              <TextInput value={paymentQuantity} onChangeText={handlePaymentQuantityChange}
                keyboardType="numeric" inputMode="numeric" maxLength={3} style={styles.cashInput}
                placeholder="0" placeholderTextColor={colors.textMuted}
                onFocus={revealPaymentFields} />
            </View>
            <View style={styles.payModalDivider} />
            <View style={styles.payModalRow}>
              <Text style={styles.payModalLabel}>Total Amount</Text>
              <Text style={styles.payModalAmount}>{formatPeso(paymentTotal)}</Text>
            </View>
            <View style={styles.payModalRow}>
              <Text style={styles.payModalLabel}>Cash Received</Text>

              <TextInput
                value={cashReceived}
                onChangeText={handleCashReceivedChange}
                keyboardType="numeric"
                inputMode="numeric"
                maxLength={6}
                placeholder="Enter amount"
                placeholderTextColor={colors.textMuted}
                style={styles.cashInput}
                onFocus={revealPaymentFields}
              />
            </View>
            <View style={[styles.payModalRow, styles.payModalRowLast]}>
              <Text style={styles.payModalLabel}>Change</Text>
              <Text style={styles.modalValue}>₱{change > 0 ? change : 0}</Text>
            </View>
            <View style={styles.payModalButtons}>
              <Pressable
                style={({ pressed }) => [styles.payModalBtnSecondary, pressed && !processing && styles.payModalBtnSecondaryPressed]}
                onPress={() => {
                  Keyboard.dismiss();
                  setPaymentModal(false);
                }}
                disabled={processing}
              >
                {({ pressed }) => (
                  <Text style={[styles.payModalBtnSecondaryText, pressed && !processing && styles.payModalBtnSecondaryTextPressed]}>Close</Text>
                )}
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.payModalBtnPrimary, pressed && !processing && styles.payModalBtnPrimaryPressed]}
                disabled={processing}
                onPress={async () => {
                  if (!selectedTenant || cashProcessingRef.current) return;
                  const payment = Number(cashReceived);
                  if (!cashReceived || payment === 0) {
                    Alert.alert("Please enter payment amount");
                    return;
                  }
                  if (quantity > quantityLimit) {
                    const remainingAdvance = Math.max(0, quantityLimit - periodsOwed);
                    Alert.alert("Advance limit exceeded", `Maximum additional payment is ${remainingAdvance} ${scheduleQuantityLabel.toLowerCase()}.`);
                    return;
                  }
                  if (payment < paymentTotal) {
                    Alert.alert("Insufficient payment");
                    return;
                  }
                  cashProcessingRef.current = true;
                  setProcessing(true);
                  try {
                    const recordPayment = httpsCallable(getFunctions(firebaseApp), "adminRecordCashPayment");
                    const response = await recordPayment({tenantId: selectedTenant.id, quantity, cashReceived: payment});
                    const saved = response.data as {receiptNo: string; amount: number; change: number; nextDueAt: string};
                    void logDetailedUpdate({
                      module: "Financials",
                      type: "Cash Payment Confirmation",
                      tenantId: selectedTenant.id,
                      tenantName: selectedTenant.name,
                      spaceNo: selectedTenant.spaceId,
                      paymentAmount: saved.amount,
                      paymentMethod: "cash",
                      oldValue: "Unpaid",
                      newValue: "Paid",
                      changedBy: auth.currentUser?.uid ?? "",
                      approvalStatus: "pending",
                    });
                    setReceiptData({
                      tenantName: selectedTenant.name,
                      buildingNumber: selectedTenant.buildingNumber,
                      spaceId: selectedTenant.spaceId,
                      date: new Date(),
                      rentAmount: saved.amount,
                      payment,
                      change: saved.change,
                      status: "Approved",
                      receiptNo: saved.receiptNo,
                      periodsCovered: quantity,
                      paidThroughAt: saved.nextDueAt,
                    });
                    setCashReceived("");
                    setPaymentModal(false);
                    setReceiptModal(true);
                  } catch (error) {
                    console.log("PAYMENT ERROR", error);
                    Alert.alert("Error", "Failed to save payment. Try again.");
                  } finally {
                    cashProcessingRef.current = false;
                    setProcessing(false);
                  }
                }}
              >
                {({ pressed }) => processing ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <ActivityIndicator size="small" color={colors.white} />
                    <Text style={styles.payModalBtnPrimaryText}>Saving...</Text>
                  </View>
                ) : (
                  <Text style={[styles.payModalBtnPrimaryText, pressed && styles.payModalBtnPrimaryTextPressed]}>
                    Generate Receipt
                  </Text>
                )}
              </Pressable>
            </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={receiptPreviewModal} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.receiptBox}>
            <LinearGradient
              colors={[colors.emerald, colors.ink]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.receiptHeader}
            >
              <View style={styles.receiptHeaderIcon}>
                <ReceiptIcon size={20} color={colors.emerald} />
              </View>
              <Text style={styles.receiptHeaderTitle}>Cash Payment</Text>
            </LinearGradient>

            <View style={styles.receiptBody}>
            <View style={styles.modalRow}>
              <Text style={styles.modalLabel}>Tenant Name</Text>
              <Text style={styles.modalValue}>{selectedTenant?.name}</Text>
            </View>

            <View style={styles.modalRow}>
              <Text style={styles.modalLabel}>Building Number</Text>
              <Text style={styles.modalValue}>
                {selectedTenant?.buildingNumber}
              </Text>
            </View>

            <View style={styles.modalRow}>
              <Text style={styles.modalLabel}>Space ID</Text>
              <Text style={styles.modalValue}>{selectedTenant?.spaceId}</Text>
            </View>

            <View style={styles.modalRow}>
              <Text style={styles.modalLabel}>Date</Text>
              <Text style={styles.modalValue}>
                {new Date().toLocaleDateString()}
              </Text>
            </View>

            <View style={styles.modalRow}>
              <Text style={styles.modalLabel}>Rent Amount</Text>
              <Text style={styles.modalValue}>₱{computedRent}</Text>
            </View>

            <View style={styles.modalRow}>
              <Text style={styles.modalLabel}>Payment</Text>

              <TextInput
                value={cashReceived}
                onChangeText={handleCashReceivedChange}
                keyboardType="numeric"
                inputMode="numeric"
                maxLength={6}
                style={styles.cashInput}
                placeholder="Enter cash amount"
                placeholderTextColor={colors.textMuted}
              />
            </View>

            <View style={styles.modalRow}>
              <Text style={styles.modalLabel}>Change</Text>

              <Text style={styles.modalValue}>₱{change > 0 ? change : 0}</Text>
            </View>

            <View style={styles.modalRow}>
              <Text style={styles.modalLabel}>Approval Status</Text>

              <Text style={styles.modalValue}>APPROVED</Text>
            </View>
            </View>

            <View style={styles.modalButtons}>
              <Pressable
                style={({ pressed }) => [styles.modalBtnSecondary, pressed && styles.modalBtnSecondaryPressed]}
                onPress={() => setReceiptPreviewModal(false)}
              >
                {({ pressed }) => (
                  <Text style={[styles.modalBtnSecondaryText, pressed && styles.modalBtnSecondaryTextPressed]}>Close</Text>
                )}
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.modalBtnPrimary, pressed && styles.modalBtnPrimaryPressed]}
                onPress={() => {
                  setReceiptData({
                    tenantName: selectedTenant?.name,
                    buildingNumber: selectedTenant?.buildingNumber,
                    spaceId: selectedTenant?.spaceId,
                    date: new Date(),
                    rentAmount: computedRent,
                    payment: Number(cashReceived),
                    change: Number(cashReceived) - computedRent,
                    status: "Approved",
                  });

                  setPaymentModal(false);

                  setReceiptModal(true);
                }}
              >
                {({ pressed }) => (
                  <Text style={[styles.modalBtnPrimaryText, pressed && styles.modalBtnPrimaryTextPressed]}>Download Receipt</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={onlineConfirmModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!approvingOnline) setOnlineConfirmModal(false);
        }}
      >
        <View style={styles.modalBg}>
          <View style={styles.receiptBox}>
            <ScrollView style={styles.confirmScrollArea} showsVerticalScrollIndicator={false}>
            <View style={styles.confirmBody}>
              <View style={styles.confirmIconCircle}>
                <Clock size={26} color={colors.warning} />
              </View>

              <Text style={styles.confirmTotalLabel}>AMOUNT PENDING</Text>
              <Text style={styles.confirmTotalAmount}>₱{Number(receiptData?.payment ?? 0).toLocaleString()}</Text>

              <View style={styles.confirmPill}>
                <Text style={styles.confirmPillText}>TRANSACTION PENDING</Text>
              </View>

              <View style={styles.confirmDivider} />

              <View style={styles.confirmDetailRows}>
                <View style={styles.confirmDetailRow}>
                  <Text style={styles.confirmDetailLabel}>Reference ID</Text>
                  <Text style={styles.confirmDetailValue}>#{receiptData?.receiptNo}</Text>
                </View>
                <View style={styles.confirmDetailRow}>
                  <Text style={styles.confirmDetailLabel}>Tenant Name</Text>
                  <Text style={styles.confirmDetailValue}>{receiptData?.tenantName}</Text>
                </View>
                <View style={styles.confirmDetailRow}>
                  <Text style={styles.confirmDetailLabel}>Stalls Covered</Text>
                  <View style={{ alignItems: "flex-end", flex: 1 }}>
                    {(receiptData?.stalls?.length
                      ? receiptData.stalls
                      : [{buildingNumber: receiptData?.buildingNumber, spaceId: receiptData?.spaceId}]
                    ).map((stall: any, index: number) => (
                      <Text key={`${stall.buildingNumber}-${stall.spaceId}-${index}`} style={styles.confirmDetailValue}>
                        B{stall.buildingNumber} · {stall.spaceId}
                      </Text>
                    ))}
                  </View>
                </View>
                <View style={styles.confirmDetailRow}>
                  <Text style={styles.confirmDetailLabel}>Payment Date</Text>
                  <Text style={[styles.confirmDetailValue, styles.confirmDetailValueAccent]}>
                    {receiptData?.date?.toLocaleDateString?.("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    }) ?? ""}
                  </Text>
                </View>
                <View style={styles.confirmDetailRow}>
                  <Text style={styles.confirmDetailLabel}>Payment Method</Text>
                  <Text style={styles.confirmDetailValue}>{receiptData?.paymentMethod || "—"}</Text>
                </View>
                <View style={styles.confirmDetailRow}>
                  <Text style={styles.confirmDetailLabel}>
                    {String(selectedOnlinePayment?.paymentSchedule ?? "").toLowerCase() === "daily"
                      ? "Combined Daily Rent"
                      : "Billing Interval Charge"}
                  </Text>
                  <Text style={styles.confirmDetailValue}>₱{receiptData?.rentAmount}</Text>
                </View>
                {receiptData?.change > 0 && (
                  <View style={styles.confirmDetailRow}>
                    <Text style={styles.confirmDetailLabel}>Change</Text>
                    <Text style={styles.confirmDetailValue}>₱{receiptData.change}</Text>
                  </View>
                )}
                <View style={[styles.confirmDetailRow, { borderBottomWidth: 0 }]}>
                  <Text style={styles.confirmDetailLabel}>Status</Text>
                  <Text style={[styles.confirmDetailValue, { color: colors.warning }]}>PENDING</Text>
                </View>
                {!selectedOnlinePayment?.checkoutSessionId && (
                  <View style={{ marginTop: spacing.md }}>
                    <Text style={styles.confirmDetailLabel}>PayMongo Payment Intent ID</Text>
                    <TextInput
                      value={legacyPaymentIntentId}
                      onChangeText={setLegacyPaymentIntentId}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="pi_..."
                      placeholderTextColor={colors.textMuted}
                      style={styles.cashInput}
                    />
                    <Text style={[styles.confirmDetailLabel, { marginTop: spacing.xs }]}>Required only for historical payments without a provider reference.</Text>
                  </View>
                )}
              </View>

              {receiptData?.breakdown?.length > 0 && (
                <>
                  <View style={styles.confirmDivider} />
                  <View style={styles.confirmBreakdownSection}>
                    <Text style={styles.confirmBreakdownTitle}>Breakdown</Text>
                    {receiptData.breakdown.map((line: { label: string; amount: number }, i: number) => (
                      <View key={i} style={styles.confirmBreakdownRow}>
                        <Text style={styles.confirmBreakdownLabel}>{line.label}</Text>
                        <Text style={styles.confirmBreakdownValue}>₱{line.amount.toLocaleString()}</Text>
                      </View>
                    ))}
                    <View style={styles.confirmBreakdownDivider} />
                    <View style={styles.confirmBreakdownRow}>
                      <Text style={styles.confirmBreakdownTotalLabel}>Total</Text>
                      <Text style={styles.confirmBreakdownTotalValue}>₱{receiptData?.payment}</Text>
                    </View>
                  </View>
                </>
              )}
            </View>
            </ScrollView>

            <View style={styles.confirmButtonsRow}>
              <Pressable
                style={({ pressed }) => [styles.confirmCloseBtn, approvingOnline && { opacity: 0.55 }, pressed && !approvingOnline && styles.confirmCloseBtnPressed]}
                onPress={() => {
                  setOnlineConfirmModal(false);
                  setSelectedOnlinePayment(null);
                  setLegacyPaymentIntentId("");
                }}
                disabled={approvingOnline}
              >
                {({ pressed }) => (
                  <Text style={[styles.confirmCloseBtnText, pressed && styles.confirmCloseBtnTextPressed]}>Close</Text>
                )}
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.confirmPrimaryBtn, approvingOnline && { opacity: 0.7 }, pressed && !approvingOnline && styles.confirmPrimaryBtnPressed]}
                disabled={approvingOnline}
                onPress={async () => {
                  if (!selectedTenant?.paymentId || approvingOnlineRef.current) return;

                  approvingOnlineRef.current = true;
                  setApprovingOnline(true);
                  try {
                    if (!selectedOnlinePayment?.checkoutSessionId && !/^pi_[A-Za-z0-9_-]+$/.test(legacyPaymentIntentId.trim())) {
                      Alert.alert("Provider reference required", "Enter the successful PayMongo Payment Intent ID from the Dashboard.");
                      return;
                    }
                    const approvePayment = httpsCallable(
                      getFunctions(firebaseApp),
                      "adminApproveOnlinePayment",
                    );
                    await approvePayment({
                      paymentId: selectedTenant.paymentId,
                      ...(!selectedOnlinePayment?.checkoutSessionId
                        ? {legacyPaymentIntentId: legacyPaymentIntentId.trim()}
                        : {}),
                    });
                  } catch (error: any) {
                    Alert.alert("Approval failed", error?.message || "Unable to approve this payment.");
                    return;
                  } finally {
                    approvingOnlineRef.current = false;
                    setApprovingOnline(false);
                  }

                  void logDetailedUpdate({
                    module: "Financials",
                    type: "Online Payment Confirmation",
                    tenantId: selectedTenant?.id ?? "",
                    tenantName: receiptData?.tenantName ?? "",
                    spaceNo: receiptData?.spaceId ?? "",
                    paymentAmount: receiptData?.payment ?? 0,
                    paymentMethod: "online",
                    oldValue: "Pending",
                    newValue: "Approved",
                    changedBy: auth.currentUser?.uid ?? "",
                    approvalStatus: "pending",
                  });

                  setOnlineConfirmModal(false);
                  setSelectedOnlinePayment(null);
                  setLegacyPaymentIntentId("");
                }}
              >
                {({ pressed }) => approvingOnline ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <ActivityIndicator size="small" color={colors.white} />
                    <Text style={styles.confirmPrimaryBtnText}>Confirming...</Text>
                  </View>
                ) : (
                  <Text style={[styles.confirmPrimaryBtnText, pressed && styles.confirmPrimaryBtnTextPressed]}>
                    Confirm Payment
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* TENANT DIGITAL RECEIPT */}

      <Modal visible={receiptModal} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.receiptBox}>
            <LinearGradient
              colors={[colors.emerald, colors.ink]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.receiptHeader}
            >
              <View style={styles.receiptHeaderIcon}>
                <Text style={styles.receiptHeaderIconText}>₱</Text>
              </View>
              <Text style={styles.receiptHeaderTitle}>Payment Receipt</Text>
              <View style={styles.receiptHeaderMetaCol}>
                {!!receiptData?.receiptNo && (
                  <Text style={styles.receiptHeaderNo}>#{receiptData.receiptNo}</Text>
                )}
                {!!receiptData?.status && (
                  <Text style={styles.receiptHeaderStatus}>{receiptData.status}</Text>
                )}
              </View>
            </LinearGradient>

            <View style={styles.receiptBody}>
              <View style={styles.receiptRow}>
                <Text style={styles.receiptLabel}>Tenant Name</Text>
                <Text style={styles.receiptValue}>{receiptData?.tenantName}</Text>
              </View>
              <View style={styles.receiptRow}>
                <Text style={styles.receiptLabel}>Building Number</Text>
                <Text style={styles.receiptValue}>{receiptData?.buildingNumber}</Text>
              </View>
              <View style={styles.receiptRow}>
                <Text style={styles.receiptLabel}>Space ID</Text>
                <Text style={styles.receiptValue}>{receiptData?.spaceId}</Text>
              </View>
              <View style={styles.receiptRow}>
                <Text style={styles.receiptLabel}>Date</Text>
                <Text style={styles.receiptValue}>{receiptData?.date?.toDateString()}</Text>
              </View>

              <View style={styles.receiptDivider} />

              <View style={styles.receiptRow}>
                <Text style={styles.receiptLabel}>Rent Amount</Text>
                <Text style={styles.receiptValue}>₱{receiptData?.rentAmount}</Text>
              </View>
              <View style={styles.receiptRow}>
                <Text style={styles.receiptLabel}>Change</Text>
                <Text style={styles.receiptValue}>₱{receiptData?.change}</Text>
              </View>

              <View style={styles.receiptTotalRow}>
                <Text style={styles.receiptTotalLabel}>Payment</Text>
                <Text style={styles.receiptTotalValue}>₱{receiptData?.payment}</Text>
              </View>

              <View style={styles.payModalButtons}>
                <Pressable
                  style={({ pressed }) => [styles.payModalBtnSecondary, downloadingReceipt && { opacity: 0.55 }, pressed && !downloadingReceipt && styles.payModalBtnSecondaryPressed]}
                  onPress={() => {
                    setReceiptModal(false);
                  }}
                  disabled={downloadingReceipt}
                >
                  {({ pressed }) => (
                    <Text style={[styles.payModalBtnSecondaryText, pressed && styles.payModalBtnSecondaryTextPressed]}>Close</Text>
                  )}
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.payModalBtnPrimary, downloadingReceipt && { opacity: 0.7 }, pressed && !downloadingReceipt && styles.payModalBtnPrimaryPressed]}
                  onPress={downloadReceipt}
                  disabled={downloadingReceipt}
                >
                  {({ pressed }) => downloadingReceipt ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <ActivityIndicator size="small" color={colors.white} />
                      <Text style={styles.payModalBtnPrimaryText}>Downloading...</Text>
                    </View>
                  ) : (
                    <Text style={[styles.payModalBtnPrimaryText, pressed && styles.payModalBtnPrimaryTextPressed]}>Download Receipt</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <HelpTour visible={tourVisible} steps={tourSteps} onClose={() => setTourVisible(false)} />
      <HelpSupportModal visible={helpSupportVisible} steps={tourSteps} onClose={() => setHelpSupportVisible(false)} onReplayTour={() => setTourVisible(true)} />

      {/* REMINDER TIME MODAL */}
      <Modal
        visible={showReminderModal}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!savingReminder) setShowReminderModal(false); }}
      >
        <View style={styles.modalBg}>
          <View style={styles.reminderModalBox}>
            <View style={styles.reminderModalTitleRow}>
              <View style={styles.reminderIconCircle}>
                <Clock size={20} color={colors.emerald} />
              </View>
              <View>
                <Text style={styles.reminderModalEyebrow}>DAILY</Text>
                <Text style={styles.reminderModalTitle}>Reminder Time</Text>
              </View>
            </View>

            <View style={styles.reminderPickerBox}>
              <View style={styles.timeStepperRow}>
                <View style={styles.stepperColumn}>
                  <Pressable
                    style={({ pressed }) => [styles.stepperBtn, pressed && styles.stepperBtnPressed]}
                    onPress={() => setDraftHour12((h) => (h % 12) + 1)}
                  >
                    {({ pressed }) => (
                      <Text style={[styles.stepperBtnText, pressed && styles.stepperBtnTextPressed]}>+</Text>
                    )}
                  </Pressable>
                  <Text style={styles.stepperValue}>{draftHour12.toString().padStart(2, "0")}</Text>
                  <Pressable
                    style={({ pressed }) => [styles.stepperBtn, pressed && styles.stepperBtnPressed]}
                    onPress={() => setDraftHour12((h) => ((h + 10) % 12) + 1)}
                  >
                    {({ pressed }) => (
                      <Text style={[styles.stepperBtnText, pressed && styles.stepperBtnTextPressed]}>−</Text>
                    )}
                  </Pressable>
                </View>

                <Text style={styles.stepperColon}>:</Text>

                <View style={styles.stepperColumn}>
                  <Pressable
                    style={({ pressed }) => [styles.stepperBtn, pressed && styles.stepperBtnPressed]}
                    onPress={() => setDraftMinute((m) => m === 0 ? 30 : 0)}
                  >
                    {({ pressed }) => (
                      <Text style={[styles.stepperBtnText, pressed && styles.stepperBtnTextPressed]}>+</Text>
                    )}
                  </Pressable>
                  <Text style={styles.stepperValue}>{draftMinute.toString().padStart(2, "0")}</Text>
                  <Pressable
                    style={({ pressed }) => [styles.stepperBtn, pressed && styles.stepperBtnPressed]}
                    onPress={() => setDraftMinute((m) => m === 0 ? 30 : 0)}
                  >
                    {({ pressed }) => (
                      <Text style={[styles.stepperBtnText, pressed && styles.stepperBtnTextPressed]}>−</Text>
                    )}
                  </Pressable>
                </View>

                <View style={styles.ampmTrack}>
                  <Animated.View
                    style={[
                      styles.ampmPill,
                      {
                        transform: [
                          {
                            translateY: ampmSlideAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0, AMPM_PILL_HEIGHT],
                            }),
                          },
                        ],
                      },
                    ]}
                  />
                  <TouchableOpacity
                    style={styles.ampmBtn}
                    onPress={() => toggleAmPm(false)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.ampmBtnText, !draftIsPM && styles.ampmBtnTextActive]}>AM</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.ampmBtn}
                    onPress={() => toggleAmPm(true)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.ampmBtnText, draftIsPM && styles.ampmBtnTextActive]}>PM</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <View style={styles.reminderModalButtons}>
              <Pressable
                style={({ pressed }) => [styles.reminderCancelBtn, pressed && !savingReminder && styles.reminderCancelBtnPressed]}
                onPress={() => setShowReminderModal(false)}
                disabled={savingReminder}
              >
                {({ pressed }) => (
                  <Text style={[styles.reminderCancelBtnText, pressed && !savingReminder && styles.reminderCancelBtnTextPressed]}>Cancel</Text>
                )}
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.reminderSaveBtn,
                  savingReminder && { opacity: 0.6 },
                  pressed && !savingReminder && styles.reminderSaveBtnPressed,
                ]}
                onPress={saveReminderTime}
                disabled={savingReminder}
              >
                {({ pressed }) =>
                  savingReminder ? (
                    <ActivityIndicator color={colors.white} size="small" />
                  ) : (
                    <>
                      <Text style={[styles.reminderSaveBtnText, pressed && styles.reminderSaveBtnTextPressed]}>Save reminder</Text>
                      <ArrowRight size={15} color={pressed ? colors.ink : colors.white} style={{ marginLeft: 4 }} />
                    </>
                  )
                }
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* REMINDER SAVED TOAST */}
      {reminderSaved && (
        <Animated.View style={[styles.reminderToastOverlay, { opacity: reminderToastFade }]}>
          <Animated.View style={[styles.reminderToastCard, { transform: [{ translateY: reminderToastTranslateY }] }]}>
            <CheckCircle2 size={18} color={colors.emeraldBright} />
            <Text style={styles.reminderToastText}>
              The reminder has been set daily every {reminderSavedText}
            </Text>
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.parchment },
  fullCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.parchment,
  },
  actionBtns: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    width: "100%",
    marginTop: spacing.md,
  },
  viewBtnWrap: { flex: 1 },
  compactViewWrap: { flexShrink: 0 },
  viewInfoBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 0,
    backgroundColor: colors.mist,
    paddingHorizontal: spacing.lg,
    paddingVertical: 6,
  },
  viewInfoBtnPressed: {
    backgroundColor: colors.emerald,
    borderColor: colors.emerald,
  },
  viewInfoBtnText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
    textAlign: "center",
  },
  viewInfoBtnTextPressed: {
    color: colors.white,
  },

  headerGradient: {
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: "hidden",
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.16)",
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
    color: colors.white,
    flex: 1,
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

  body: {
    flex: 1,
    backgroundColor: colors.parchment,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },

  summaryRow: {
    width: "100%",
    marginBottom: spacing.lg,
  },
  summaryOverviewCard: {
    minHeight: 104,
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...shadow.card,
  },
  summarySpacesBlock: {
    flex: 1,
    justifyContent: "center",
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: "rgba(255,255,255,0.24)",
    paddingRight: spacing.lg,
  },
  summaryTotalValue: {
    fontSize: 42,
    lineHeight: 44,
    fontFamily: fontFamily.extrabold,
    color: colors.white,
  },
  summaryTotalLabel: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.medium,
    color: "#6DE8BE",
    textTransform: "uppercase",
    letterSpacing: 0.3,
    marginTop: 4,
  },
  summaryTotalHint: {
    fontSize: 9,
    fontFamily: fontFamily.regular,
    color: "rgba(255,255,255,0.65)",
    marginTop: 2,
  },
  summaryStatusList: {
    flex: 1,
    justifyContent: "space-between",
    paddingLeft: spacing.lg,
    paddingVertical: 1,
  },
  summaryStatusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  summaryStatusLabelWrap: { flexDirection: "row", alignItems: "center", gap: 7 },
  summaryDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.35)" },
  summaryDotPaid: { backgroundColor: "#64E7B8" },
  summaryDotUnpaid: { backgroundColor: "#F6B8B8" },
  summaryDotPending: { backgroundColor: "#F5C842" },
  summaryStatusLabel: { fontSize: fontSize.xs, fontFamily: fontFamily.medium, color: "rgba(255,255,255,0.78)", textTransform: "uppercase" },
  summaryStatusValue: { minWidth: 22, textAlign: "right", fontSize: fontSize.md, fontFamily: fontFamily.bold, color: "#F5C842", fontVariant: ["tabular-nums"] },
  summaryPaidValue: { color: "#64E7B8" },
  summaryUnpaidValue: { color: "#F6B8B8" },
  searchWrap: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    ...shadow.subtle,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    color: colors.ink,
  },
  searchClearBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 15 },
  summaryCard: {
    width: "23%",
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: "23%",
    minWidth: 0,
    minHeight: 68,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: "transparent",
    overflow: "hidden",
  },
  summaryCardSpaces: { backgroundColor: colors.emerald },
  summaryCardPaid: { backgroundColor: colors.emeraldSoft, borderColor: colors.success },
  summaryCardUnpaid: { backgroundColor: colors.errorSoft, borderColor: colors.error },
  summaryCardPending: {
    backgroundColor: colors.warningSoft,
    borderColor: colors.warning,
    borderRadius: 14,
    overflow: "hidden",
  },
  summaryCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 2,
    minWidth: 0,
  },
  summaryLabelSpaces: {
    flexShrink: 1,
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.emeraldSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  summaryLabelPaid: {
    flexShrink: 1,
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  summaryLabelUnpaid: {
    flexShrink: 1,
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.error,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  summaryLabelPending: {
    flexShrink: 1,
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.warning,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  summaryValueSpaces: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.extrabold,
    color: colors.white,
    marginTop: 2,
  },
  summaryValuePaid: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.extrabold,
    color: colors.emerald,
    marginTop: 2,
  },
  summaryValueUnpaid: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.extrabold,
    color: colors.error,
    marginTop: 2,
  },
  summaryValuePending: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.extrabold,
    color: colors.warning,
    marginTop: 2,
  },

  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },

  filterStatusGroup: {
    flexDirection: "row",
    alignItems: "center",
  },
  segmentTrack: {
    flexDirection: "row",
    backgroundColor: colors.mist,
    borderRadius: 8,
    padding: 3,
    ...shadow.subtle,
  },
  segmentItem: {
    minWidth: 55,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    borderRadius: 7,
    alignItems: "center",
  },
  segmentItemActive: {
    backgroundColor: colors.ink,
  },
  segmentText: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.medium,
    color: colors.ink,
  },
  segmentTextActive: {
    color: colors.white,
  },

  centeredBox: { flex: 1, justifyContent: "center", alignItems: "center" },
  card: {
    flex: 1,
  },
  tenantCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm + 2,
    ...shadow.card,
  },
  tenantCardPaid: { paddingVertical: spacing.md },
  rowLeft: { width: "100%", position: "relative" },
  rowMetaWrap: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 3 },
  rowMeta: { fontSize: fontSize.xs, fontFamily: fontFamily.medium, color: colors.ink, backgroundColor: colors.mist, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  rowName: { fontSize: fontSize.base, fontFamily: fontFamily.bold, color: colors.textPrimary },
  rowSchedule: { fontSize: fontSize.xs + 1, fontFamily: fontFamily.regular, color: colors.ink, marginTop: 2 },
  categoryText: { flex: 1, fontSize: fontSize.xs, fontFamily: fontFamily.regular, color: colors.textSecondary },
  cardDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.sm },
  billingLabel: { fontSize: 9, fontFamily: fontFamily.medium, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.35 },
  rowDueWrap: { position: "absolute", right: 0, bottom: 0, alignItems: "flex-end" },
  rowDueValue: { fontSize: 21, fontFamily: fontFamily.extrabold, color: colors.error },
  rowDueValuePaid: { color: colors.emerald },

  tenantHeaderRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  paidTenantCopy: { flex: 1 },
  rowNamePaid: { fontSize: fontSize.sm },
  paidTenantMeta: { fontSize: 10, color: colors.textSecondary, fontFamily: fontFamily.regular, marginTop: 2 },
  statusTag: { borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3 },
  nonPaidStatusTag: { position: "absolute", right: 0, bottom: 22 },
  statusTagPaid: { backgroundColor: "#89F0CC" },
  statusTagUnpaid: { backgroundColor: "#FFDCDC" },
  statusTagPending: { backgroundColor: colors.warningSoft },
  statusTagText: { fontSize: 9, fontFamily: fontFamily.bold, textTransform: "uppercase" },
  statusTagTextPaid: { color: colors.emerald },
  statusTagTextUnpaid: { color: "#BE262D" },
  statusTagTextPending: { color: colors.warning },
  paidReceiptRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, marginTop: spacing.md },
  receiptSummary: { flex: 1, fontSize: fontSize.xs, fontFamily: fontFamily.semibold, color: colors.emerald },
  compactViewBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, width: 74, minHeight: 36, borderRadius: 8, backgroundColor: colors.mist, paddingHorizontal: spacing.sm },
  compactViewText: { fontSize: fontSize.xs, color: colors.ink, fontFamily: fontFamily.semibold },

  setPaidBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    minHeight: 38,
    borderRadius: 8,
    backgroundColor: colors.emerald,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    ...shadow.card,
  },
  setPaidBtnIcon: { marginRight: 6 },
  setPaidBtnOnline: { backgroundColor: colors.warningSoft },
  setPaidBtnPressed: { backgroundColor: colors.white },
  setPaidBtnOnlinePressed: { backgroundColor: colors.warning },
  setPaidBtnText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.white,
    textAlign: "center",
  },
  setPaidBtnTextOnline: { color: colors.warning },
  setPaidBtnTextPressed: { color: colors.emerald },
  setPaidBtnTextOnlinePressed: { color: colors.white },

  emptyBox: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  emptyIcon: { marginBottom: spacing.md - 2 },
  emptyText: { fontSize: fontSize.base, fontFamily: fontFamily.regular, color: colors.textSecondary, textAlign: "center" },

  modalBg: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    alignItems: "center",
  },
  modalBox: {
    width: "85%",
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.xl,
    ...shadow.raised,
  },

  // ── Payment receipt card ────────────────────────────────────────────
  receiptBox: {
    width: "88%",
    maxWidth: 380,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    overflow: "hidden",
    ...shadow.raised,
  },
  receiptHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  receiptHeaderIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm + 2,
  },
  receiptHeaderIconText: {
    fontSize: fontSize.xxl,
    fontFamily: fontFamily.extrabold,
    color: colors.ink,
    marginTop: -6,
    marginLeft: 2,
  },
  receiptHeaderTitle: {
    flex: 1,
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    color: colors.white,
  },
  receiptHeaderMetaCol: {
    alignItems: "flex-end",
    gap: 2,
  },
  receiptHeaderNo: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.medium,
    color: colors.emeraldSoft,
    transform: [{ translateY: 8 }],
  },
  receiptHeaderStatus: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.bold,
    color: colors.white,
    textTransform: "uppercase",
    letterSpacing: 0.3,
    transform: [{ translateY: 8 }],
  },
  receiptBody: {
    padding: spacing.xl,
    paddingBottom: spacing.lg,
  },
  receiptRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.xs + 2,
  },
  receiptLabel: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
  },
  receiptValue: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
    flexShrink: 1,
    textAlign: "right",
    marginLeft: spacing.md,
  },
  receiptDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginVertical: spacing.sm + 2,
  },
  receiptTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  receiptTotalLabel: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },
  receiptTotalValue: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.extrabold,
    color: colors.emerald,
  },
  modalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.sm - 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  // ── Online payment confirm card ───────────────────
  confirmScrollArea: {
    maxHeight: 480,
  },
  confirmBody: {
    width: "100%",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
  },
  confirmIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.warningSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  confirmTotalLabel: {
    fontSize: fontSize.xs + 1,
    fontFamily: fontFamily.bold,
    color: colors.textSecondary,
    letterSpacing: 0.4,
  },
  confirmTotalAmount: {
    fontSize: fontSize.xxl,
    fontFamily: fontFamily.extrabold,
    color: colors.ink,
    marginTop: 4,
  },
  confirmPill: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm + 2,
  },
  confirmPillText: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.bold,
    color: colors.warning,
    letterSpacing: 0.3,
  },
  confirmDivider: {
    width: "100%",
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.lg,
  },
  confirmDetailRows: {
    width: "100%",
  },
  confirmDetailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  confirmDetailLabel: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
  },
  confirmDetailValue: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
  },
  confirmDetailValueAccent: {
    color: colors.emerald,
  },
  confirmBreakdownSection: {
    width: "100%",
  },
  confirmBreakdownTitle: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  confirmBreakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  confirmBreakdownLabel: {
    flex: 1,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
  },
  confirmBreakdownValue: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
  },
  confirmBreakdownNote: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.regular,
    color: colors.textMuted,
    marginTop: 2,
  },
  confirmBreakdownDivider: {
    width: "100%",
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm + 2,
  },
  confirmBreakdownTotalLabel: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },
  confirmBreakdownTotalValue: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.extrabold,
    color: colors.gold,
  },
  confirmButtonsRow: {
    flexDirection: "row",
    width: "100%",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  confirmCloseBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: spacing.md,
  },
  confirmCloseBtnPressed: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  confirmCloseBtnText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.textSecondary,
  },
  confirmCloseBtnTextPressed: {
    color: colors.white,
  },
  confirmPrimaryBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.emerald,
    paddingVertical: spacing.md,
    ...shadow.button,
  },
  confirmPrimaryBtnPressed: {
    backgroundColor: colors.white,
  },
  confirmPrimaryBtnText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.bold,
    color: colors.white,
  },
  confirmPrimaryBtnTextPressed: {
    color: colors.emerald,
  },
  modalLabel: { fontSize: fontSize.sm, fontFamily: fontFamily.regular, color: colors.textSecondary },
  modalValue: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.ink },
  rentAmountBox: { alignItems: "flex-end" },
  dueBreakdownText: { fontSize: fontSize.xs, fontFamily: fontFamily.regular, color: colors.textMuted, marginTop: 2 },
  modalBodyText: { fontSize: fontSize.base, fontFamily: fontFamily.regular, color: colors.textSecondary, marginBottom: spacing.lg },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: spacing.xl,
    gap: spacing.sm + 2,
  },
  modalBtnSecondary: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.sm - 2,
    paddingVertical: spacing.sm + 1,
    paddingHorizontal: spacing.lg + 2,
  },
  modalBtnSecondaryPressed: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  modalBtnSecondaryText: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.textSecondary },
  modalBtnSecondaryTextPressed: { color: colors.white },
  modalBtnPrimary: {
    backgroundColor: colors.emerald,
    borderRadius: radius.sm - 2,
    paddingVertical: spacing.sm + 1,
    paddingHorizontal: spacing.lg + 2,
    ...shadow.button,
  },
  modalBtnPrimaryPressed: {
    backgroundColor: colors.white,
  },
  modalBtnPrimaryText: { fontSize: fontSize.sm, fontFamily: fontFamily.bold, color: colors.white },
  modalBtnPrimaryTextPressed: { color: colors.emerald },

  cashInput: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    width: 130,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    color: colors.ink,
    textAlign: "right",
    backgroundColor: colors.mist,
  },

  // ── Payment confirmation modal ─────────────────────────────────────────────

  payModalBox: {
    width: "85%",
    maxHeight: "90%",
    backgroundColor: colors.white,
    borderRadius: radius.xl + 4,
    overflow: "hidden",
    ...shadow.raised,
  },
  payModalScroll: {
    flexShrink: 1,
  },
  payModalBody: {
    padding: spacing.xl,
  },
  payModalTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  payModalBadge: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  payModalBadgeText: {
    fontSize: fontSize.lg + 8,
    fontFamily: fontFamily.extrabold,
    color: colors.ink,
    marginTop: -6,
    marginLeft: 2,
  },
  payModalTitle: {
    flex: 1,
    fontSize: fontSize.lg,
    fontFamily: fontFamily.extrabold,
    color: colors.white,
    lineHeight: 22,
  },
  payModalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm + 2,
  },
  payModalRowLast: {
    marginBottom: spacing.md,
  },
  payModalLabel: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
  },
  payModalSubLabel: {
    marginTop: 2,
    fontSize: fontSize.xs,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
  },
  payModalDivider: {
    height: 1,
    marginVertical: spacing.sm,
    backgroundColor: colors.border,
  },
  payModalAmount: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.extrabold,
    color: colors.ink,
  },
  payModalButtons: {
    flexDirection: "row",
    gap: spacing.sm + 2,
    marginTop: spacing.sm,
  },
  payModalBtnSecondary: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.emerald,
    borderRadius: radius.pill,
    paddingVertical: spacing.md - 1,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.white,
  },
  payModalBtnSecondaryPressed: {
    backgroundColor: colors.emerald,
  },
  payModalBtnSecondaryText: { fontSize: fontSize.base, fontFamily: fontFamily.semibold, color: colors.emerald },
  payModalBtnSecondaryTextPressed: { color: colors.white },
  payModalBtnPrimary: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.ink,
    borderRadius: radius.pill,
    paddingVertical: spacing.md - 1,
    ...shadow.button,
  },
  payModalBtnPrimaryPressed: {
    backgroundColor: colors.white,
  },
  payModalBtnPrimaryText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.white,
    textAlign: "center",
  },
  payModalBtnPrimaryTextPressed: {
    color: colors.ink,
  },

  // ── Reminder time button + modal ─────────────────────────────────────────

  reminderTimeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: "#DDF4EA",
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },

  reminderTimeWrap: { marginLeft: spacing.sm },

  reminderTimeBtnText: {
    color: colors.ink,
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
  },

  reminderModalBox: {
    width: "100%",
    maxWidth: 320,
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.xl,
    ...shadow.raised,
  },

  reminderModalTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },

  reminderIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.emeraldSoft,
    alignItems: "center",
    justifyContent: "center",
  },

  reminderModalEyebrow: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.textMuted,
    letterSpacing: 1,
    textTransform: "uppercase",
  },

  reminderModalTitle: {
    fontSize: fontSize.lg + 2,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginTop: 2,
  },

  reminderPickerBox: {
    backgroundColor: colors.parchment,
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    marginTop: spacing.xl,
  },

  timeStepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },

  stepperColumn: {
    alignItems: "center",
  },

  stepperBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.emeraldSoft,
    alignItems: "center",
    justifyContent: "center",
  },

  stepperBtnPressed: {
    backgroundColor: colors.emerald,
  },

  stepperBtnText: {
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
    color: colors.emerald,
    lineHeight: fontSize.lg + 2,
  },

  stepperBtnTextPressed: {
    color: colors.white,
  },

  stepperValue: {
    fontSize: fontSize.xxl + 6,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginVertical: spacing.sm,
    minWidth: 54,
    textAlign: "center",
  },

  stepperColon: {
    fontSize: fontSize.xxl + 6,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  ampmTrack: {
    width: 44,
    height: 68,
    borderRadius: radius.pill,
    backgroundColor: colors.mist,
    padding: 3,
    flexDirection: "column",
    position: "relative",
    marginLeft: spacing.sm,
  },

  ampmPill: {
    position: "absolute",
    top: 3,
    left: 3,
    width: 38,
    height: AMPM_PILL_HEIGHT,
    borderRadius: radius.pill,
    backgroundColor: colors.emerald,
  },

  ampmBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  ampmBtnText: {
    fontSize: fontSize.xs + 1,
    fontFamily: fontFamily.semibold,
    color: colors.textSecondary,
  },

  ampmBtnTextActive: {
    color: colors.white,
  },

  reminderModalButtons: {
    flexDirection: "row",
    gap: spacing.sm + 2,
    marginTop: spacing.xl,
  },

  reminderCancelBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingVertical: spacing.md - 1,
  },

  reminderCancelBtnPressed: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },

  reminderCancelBtnText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    color: colors.textSecondary,
  },

  reminderCancelBtnTextPressed: {
    color: colors.white,
  },

  reminderSaveBtn: {
    flex: 1.4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    paddingVertical: spacing.md - 1,
    ...shadow.button,
  },

  reminderSaveBtnPressed: {
    backgroundColor: colors.white,
  },

  reminderSaveBtnText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.white,
  },

  reminderSaveBtnTextPressed: {
    color: colors.ink,
  },

  reminderToastOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    alignItems: "center",
  },

  reminderToastCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.white,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    ...shadow.raised,
  },

  reminderToastText: {
    color: colors.ink,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
  },

});
