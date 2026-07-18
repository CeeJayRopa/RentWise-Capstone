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
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { House, HelpCircle, Users, Wallet, Receipt as ReceiptIcon, CheckCircle2, Eye } from "lucide-react-native";
import { auth } from "../../shared/services/auth";
import { db } from "../../shared/services/firestore";
import { logDetailedUpdate } from "../../shared/services/updatesService";
import UpdatesReportFAB, { FAB_CLEARANCE } from "../components/UpdatesReportFAB";
import HelpTour, { HelpStep } from "../components/HelpTour";
import { hasSeenPageTour, markPageTourSeen } from "../../shared/services/onboardingTour";
import { Badge } from "../../shared/components/ui";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";
import * as Print from "expo-print";
import RNBlobUtil from "react-native-blob-util";

type StatusFilter = "All" | "Paid" | "Unpaid";

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
  // Month-scoped balance (matches rentwise-tenant/app/dashboard.tsx): what's
  // due right now, accounting for whatever's already been paid this month.
  paymentDue: number;
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

// Names the tenant's own billing unit instead of the generic "periods" —
// reads more naturally, especially "cutoffs" for semi-monthly, which is
// the term actually used locally for that schedule.
function periodUnitLabel(schedule: string, count: number): string {
  const plural = count !== 1;
  if (schedule === "daily") return plural ? "days" : "day";
  if (schedule === "weekly") return plural ? "weeks" : "week";
  if (schedule === "semi-monthly") return plural ? "cutoffs" : "cutoff";
  return plural ? "months" : "month";
}

export default function Financials() {
  const insets = useSafeAreaInsets();

  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("All");
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<TenantRow | null>(null);
  const [paymentModal, setPaymentModal] = useState(false);
  const [receiptModal, setReceiptModal] = useState(false);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [profileModal, setProfileModal] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<any>(null);
  const [profilePayments, setProfilePayments] = useState<any[]>([]);
  const [processing, setProcessing] = useState(false);
  const [cashReceived, setCashReceived] = useState("");
  const [receiptPreviewModal, setReceiptPreviewModal] = useState(false);
  const [onlineConfirmModal, setOnlineConfirmModal] = useState(false);
  const [selectedOnlinePayment, setSelectedOnlinePayment] = useState<any>(null);
  const [tourVisible, setTourVisible] = useState(false);

  const userDocsRef = useRef<any[]>([]);
  const stallMapRef = useRef<Map<string, StallInfo>>(new Map());
  const paymentsRef = useRef<any[]>([]);

  const homeRef = useRef<View>(null);
  const helpRef = useRef<View>(null);
  const summaryRef = useRef<View>(null);
  const filterRef = useRef<View>(null);
  const listRef = useRef<View>(null);
  const setPaidRef = useRef<View>(null);
  const viewBtnRef = useRef<View>(null);

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

    const year = today.getFullYear();
    const month = today.getMonth();

    const tenantList: TenantRow[] = userDocs.map((d) => {
      const u = d.data();
      const stall = stallMap.get(u.stallId);
      const tenantPayments = allPayments.filter((p) => p.userId === d.id);
      const schedule = stall?.paymentSchedule ?? "monthly";
      const dailyRate = stall?.price ?? 0;

      const paidThisMonth = tenantPayments.reduce((sum, p) => {
        if (p.status !== "approved") return sum;
        const pd = p.date?.toDate?.();
        if (!pd || pd.getFullYear() !== year || pd.getMonth() !== month) return sum;
        return sum + Number(p.amount || 0);
      }, 0);

      const chargedToDate = chargedSinceMonthStart(dailyRate, schedule, today);
      const paymentDue = chargedToDate - paidThisMonth;

      let tenantStatus: "paid" | "unpaid" | "online" = "unpaid";
      let paymentId: null | string = null;

      // A pending online payment always needs admin action (confirm it),
      // regardless of whether the tenant is otherwise caught up.
      const pendingPayment = tenantPayments.find((p) => p.status === "pending");
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
        name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
        buildingNumber: stall?.buildingNumber ?? "",
        spaceId: stall?.spaceId ?? "",
        stallId: u.stallId ?? "",
        rent: stall?.price ?? 0,
        paymentSchedule: stall?.paymentSchedule ?? "monthly",
        status: tenantStatus,
        paymentId,
        paymentDue,
      };
    });

    tenantList.sort((a, b) => {
      const spaceA = Number(a.spaceId.split("-")[1]);
      const spaceB = Number(b.spaceId.split("-")[1]);
      return spaceA - spaceB;
    });

    setRows(tenantList);
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
        paymentSchedule: s.paymentSchedule ?? "monthly",
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

      const setup = async () => {
        try {
          await refreshUsersAndStalls();

          // Real-time payments listener — fires immediately then on every change
          unsubPayments = onSnapshot(
            collection(db, "payments"),
            (paymentsSnap) => {
              const allPayments: any[] = paymentsSnap.docs.map((d) => ({
                id: d.id,
                ...d.data(),
              }));
              paymentsRef.current = allPayments;
              computeRows(allPayments);
              setLoading(false);
            },
            (err) => {
              console.log("FINANCIALS PAYMENTS LISTENER ERROR:", err);
              setLoading(false);
            },
          );
        } catch (e) {
          console.log("FINANCIALS FETCH ERROR:", e);
          setLoading(false);
        }
      };

      setup();

      return () => {
        if (unsubPayments) unsubPayments();
      };
    }, []),
  );

  const downloadReceipt = async () => {
    if (!receiptData) return;

    try {
      const receiptNo =
        receiptData.receiptNo ?? "RW-" + Date.now().toString().slice(-8);

      const html = `
    <html>
      <body style="font-family: Arial; padding:30px;">
        <h1 style="text-align:center;">RentWise</h1>
        <h2 style="text-align:center;">Tenant's Digital Receipt</h2>
        <hr/>
        <p><b>Receipt No:</b> ${receiptNo}</p>
        <p><b>Tenant Name:</b> ${receiptData.tenantName}</p>
        <p><b>Building Number:</b> ${receiptData.buildingNumber}</p>
        <p><b>Space ID:</b> ${receiptData.spaceId}</p>
        <p><b>Date:</b> ${receiptData.date instanceof Date ? receiptData.date.toDateString() : new Date(receiptData.date).toDateString()}</p>
        <p><b>Rent Amount:</b> ₱${receiptData.rentAmount}</p>
        <p><b>Payment:</b> ₱${receiptData.payment}</p>
        <p><b>Change:</b> ₱${receiptData.change}</p>
        <p><b>Approval Status:</b> ${receiptData.status}</p>
        <hr/>
        <h3 style="text-align:center;">Thank you for your payment</h3>
      </body>
    </html>
    `;

      const { base64 } = await Print.printToFileAsync({ html, base64: true });

      const fileName = `receipt-${receiptNo}.pdf`;
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
    }
  };

  const confirmCashPayment = async () => {
    if (!selectedTenant) return;

    const received = Number(cashReceived);
    const rentDue = computePeriodCharge(
      selectedTenant.rent,
      selectedTenant.paymentSchedule,
      new Date(),
    );

    if (received < rentDue) {
      alert("Insufficient payment");

      return;
    }

    setProcessing(true);

    try {
      const receiptNo = "RW-" + Date.now().toString().slice(-8);

      await addDoc(collection(db, "payments"), {
        userId: selectedTenant.id,

        amount: rentDue,

        rentAmount: rentDue,

        cashReceived: received,

        change: received - rentDue,

        method: "cash",

        status: "approved",

        stallId: selectedTenant.stallId,

        buildingNumber: selectedTenant.buildingNumber,

        spaceId: selectedTenant.spaceId,

        tenantName: selectedTenant.name,

        receiptNo,

        date: serverTimestamp(),

        createdAt: serverTimestamp(),

        receiptGenerated: true,

        receipt: null,
      });

      setReceiptPreviewModal(false);

      setCashReceived("");

      setReceiptModal(true);
    } catch (error) {
      console.log("PAYMENT ERROR", error);
    } finally {
      setProcessing(false);
    }
  };

  const confirmOnlinePayment = async (row: TenantRow) => {
    if (!row.paymentId) return;

    try {
      const paymentRef = doc(db, "payments", row.paymentId);

      const paymentSnap = await getDoc(paymentRef);

      if (!paymentSnap.exists()) return;

      const payment = paymentSnap.data();

      setSelectedTenant(row);

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

        // IMPORTANT PART
        rentAmount: payment.rentAmount,
        payment: payment.amount,
        change: payment.change ?? 0,

        status: payment.status,
        periodsCovered: payment.periodsCovered ?? 1,
        periodsAdvance: payment.periodsAdvance ?? 0,
      });

      setOnlineConfirmModal(true);
    } catch (error) {
      console.log("OPEN RECEIPT ERROR:", error);
    }
  };

  // What the tenant currently owes, matching the same balance the tenant
  // sees as "Payment" on their own dashboard — not just a flat per-period
  // rate, so a tenant who's already partly paid this month isn't overcharged.
  const computedRent = selectedTenant ? Math.max(0, selectedTenant.paymentDue) : 0;
  const change = Number(cashReceived || 0) - computedRent;

  // How many billing periods the Rent Amount actually covers — lets the modal explain
  // *why* the total is what it is (e.g. "5 days x P120") instead of just showing a
  // lump sum that looks wrong if the tenant missed a few periods.
  const periodCharge = selectedTenant
    ? computePeriodCharge(selectedTenant.rent, selectedTenant.paymentSchedule, new Date())
    : 0;
  const periodsOwed = periodCharge > 0 ? Math.max(1, Math.round(computedRent / periodCharge)) : 1;

  const filteredRows =
    filter === "All"
      ? rows
      : rows.filter((r) => {
          if (filter === "Paid") return r.status === "paid";

          return r.status === "unpaid" || r.status === "online";
        });

  const spacesCount = rows.length;
  const paidCount = rows.filter((r) => r.status === "paid").length;
  const unpaidCount = rows.filter((r) => r.status === "unpaid" || r.status === "online").length;

  // First row that actually shows a Set Paid/Confirm button — used to point
  // the tour at a real, on-screen example instead of a generic description.
  const firstActionableIndex = filteredRows.findIndex((r) => r.status !== "paid");

  const tourSteps: HelpStep[] = [
    { key: "home", ref: homeRef, title: "Home", description: "Takes you back to the dashboard.", offsetY: 41, round: true },
    { key: "help", ref: helpRef, title: "Help", description: "Come back here anytime for a guided tour of this page.", offsetY: 41, round: true },
    { key: "summary", ref: summaryRef, title: "Spaces / Paid / Unpaid", description: "Total stalls tracked here, and how many tenants have paid vs. are still unpaid this period.", offsetY: 41 },
    { key: "filter", ref: filterRef, title: "Status filter", description: "Narrow the list to only paid or only unpaid tenants.", offsetY: 41 },
    { key: "list", ref: listRef, title: "Tenant list", description: "Paid/Unpaid badges show status at a glance.", offsetY: 41 },
  ];
  if (firstActionableIndex !== -1) {
    tourSteps.push({ key: "setpaid", ref: setPaidRef, title: "Set Paid", description: "Records a cash payment for this tenant, or confirms a pending online payment.", offsetY: 41 });
  }
  if (filteredRows.length > 0) {
    tourSteps.push({ key: "view", ref: viewBtnRef, title: "View", description: "Opens this tenant's full payment details and history.", offsetY: 41 });
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
            <TouchableOpacity onPress={() => setTourVisible(true)} activeOpacity={0.7} style={styles.iconBtn}>
              <HelpCircle size={22} color={colors.emeraldSoft} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Sub-header */}
        <View style={styles.subHeader}>
          <Text style={styles.pageTitle}>Financials</Text>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{spacesCount} Spaces</Text>
          </View>
        </View>
      </LinearGradient>

      {/* BODY */}
      <View style={styles.body}>
        {/* SUMMARY STATS */}
        <View style={styles.summaryRow} ref={summaryRef} collapsable={false}>
          <View style={[styles.summaryCard, styles.summaryCardSpaces]}>
            <Text style={styles.summaryLabelSpaces}>Spaces</Text>
            <Text style={styles.summaryValueSpaces}>{spacesCount}</Text>
          </View>
          <View style={[styles.summaryCard, styles.summaryCardPaid]}>
            <Text style={styles.summaryLabelPaid}>Paid</Text>
            <Text style={styles.summaryValuePaid}>{paidCount}</Text>
          </View>
          <View style={[styles.summaryCard, styles.summaryCardUnpaid]}>
            <Text style={styles.summaryLabelUnpaid}>Unpaid</Text>
            <Text style={styles.summaryValueUnpaid}>{unpaidCount}</Text>
          </View>
        </View>

        {/* STATUS FILTER */}
        <View style={styles.filterRow} ref={filterRef} collapsable={false}>
          <Text style={styles.filterLabel}>Status</Text>
          <View style={styles.segmentTrack}>
            {(["All", "Paid", "Unpaid"] as StatusFilter[]).map((opt) => (
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

        {/* TENANT INFO CARD */}
        {loading ? (
          <View style={styles.centeredBox}>
            <ActivityIndicator size="large" color={colors.emerald} />
          </View>
        ) : (
          <View style={styles.card} ref={listRef} collapsable={false}>
            <View style={styles.cardHeader}>
              <Wallet size={16} color={colors.emerald} style={{ marginRight: spacing.sm }} />
              <Text style={styles.cardHeaderText}>Tenant info</Text>
            </View>

            {filteredRows.length === 0 ? (
              <View style={styles.emptyBox}>
                <Users size={40} color={colors.borderStrong} style={styles.emptyIcon} />
                <Text style={styles.emptyText}>No tenants found.</Text>
              </View>
            ) : (
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: insets.bottom + FAB_CLEARANCE }}
                refreshControl={
                  <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />
                }
              >
                {filteredRows.map((item, idx) => (
                  <View key={item.id} style={styles.tenantCard}>
                    {/* TENANT INFO */}
                    <View style={styles.rowLeft}>
                      <View style={styles.rowMetaWrap}>
                        <Text style={styles.rowMeta}>
                          B{item.buildingNumber} · {item.spaceId}
                        </Text>
                        <Badge
                          label={item.status === "paid" ? "Paid" : item.status === "online" ? "Pending" : "Unpaid"}
                          tone={item.status === "paid" ? "success" : item.status === "online" ? "warning" : "error"}
                        />
                      </View>

                      <Text style={styles.rowName}>{item.name}</Text>
                    </View>

                    {/* ACTION BUTTONS — Set Paid on top, View below */}
                    <View style={styles.actionBtns}>
                      {/* PAYMENT BUTTON — hidden once already paid, nothing to action */}
                      {item.status !== "paid" && (
                        <View ref={idx === firstActionableIndex ? setPaidRef : undefined} collapsable={false}>
                        <Pressable
                          style={({ pressed }) => [
                            styles.setPaidBtn,
                            item.status === "online" && styles.setPaidBtnOnline,
                            pressed && styles.btnPressed,
                          ]}
                          onPress={async () => {
                            if (item.status === "online") {
                              await confirmOnlinePayment(item);
                            } else {
                              setSelectedTenant(item);
                              setCashReceived("");
                              setPaymentModal(true);
                            }
                          }}
                        >
                          <CheckCircle2
                            size={14}
                            color={item.status === "online" ? colors.warning : colors.white}
                            style={styles.setPaidBtnIcon}
                          />
                          <Text
                            style={[
                              styles.setPaidBtnText,
                              item.status === "online" && styles.setPaidBtnTextOnline,
                            ]}
                          >
                            {item.status === "online" ? "Confirm" : "Set Paid"}
                          </Text>
                        </Pressable>
                        </View>
                      )}

                      {/* VIEW INFO BUTTON */}
                      <View ref={idx === 0 ? viewBtnRef : undefined} collapsable={false}>
                      <Pressable
                        style={({ pressed }) => [
                          styles.viewInfoBtn,
                          pressed && styles.btnPressed,
                        ]}
                        onPress={() => {
                          router.push({
                            pathname: "/tenant-preview",
                            params: { tenantId: item.id },
                          });
                        }}
                      >
                        <Eye size={14} color={colors.emerald} style={styles.setPaidBtnIcon} />
                        <Text style={styles.viewInfoBtnText}>View</Text>
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
      <UpdatesReportFAB />

      {/* CASH PAYMENT MODAL */}
      <Modal visible={paymentModal} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.payModalBox}>
            <View style={styles.payModalTitleRow}>
              <View style={styles.payModalBadge}>
                <Text style={styles.payModalBadgeText}>₱</Text>
              </View>
              <Text style={styles.payModalTitle}>Payment Confirmation</Text>
            </View>
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
              <Text style={styles.payModalLabel}>Rent Amount</Text>
              <View style={styles.rentAmountBox}>
                <Text style={styles.payModalAmount}>₱{computedRent}</Text>
                {periodsOwed > 1 && (
                  <Text style={styles.dueBreakdownText}>
                    {periodsOwed} {periodUnitLabel(selectedTenant?.paymentSchedule ?? "monthly", periodsOwed)} × ₱{periodCharge}
                  </Text>
                )}
              </View>
            </View>
            <View style={styles.payModalRow}>
              <Text style={styles.payModalLabel}>Cash Received</Text>

              <TextInput
                value={cashReceived}
                onChangeText={setCashReceived}
                keyboardType="numeric"
                placeholder="Enter amount"
                placeholderTextColor={colors.textMuted}
                style={styles.cashInput}
              />
            </View>
            <View style={[styles.payModalRow, styles.payModalRowLast]}>
              <Text style={styles.payModalLabel}>Change</Text>
              <Text style={styles.modalValue}>₱{change > 0 ? change : 0}</Text>
            </View>
            <View style={styles.payModalButtons}>
              <TouchableOpacity
                style={styles.payModalBtnSecondary}
                onPress={() => setPaymentModal(false)}
                disabled={processing}
              >
                <Text style={styles.payModalBtnSecondaryText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.payModalBtnPrimary}
                disabled={processing}
                onPress={async () => {
                  if (!selectedTenant) return;
                  const payment = Number(cashReceived);
                  if (!cashReceived || payment === 0) {
                    Alert.alert("Please enter payment amount");
                    return;
                  }
                  if (payment < computedRent) {
                    Alert.alert("Insufficient payment");
                    return;
                  }
                  setProcessing(true);
                  try {
                    const receiptNo = "RW-" + Date.now().toString().slice(-8);
                    await addDoc(collection(db, "payments"), {
                      userId: selectedTenant.id,
                      tenantName: selectedTenant.name,
                      stallId: selectedTenant.stallId,
                      buildingNumber: selectedTenant.buildingNumber,
                      spaceId: selectedTenant.spaceId,
                      // Only the actual rent due counts toward what the tenant
                      // has paid — any excess cash tendered is handed back as
                      // change (see `change` below), not credited as an
                      // advance payment toward future periods.
                      amount: computedRent,
                      rentAmount: computedRent,
                      cashReceived: payment,
                      change: Math.max(0, payment - computedRent),
                      method: "cash",
                      status: "approved",
                      receiptGenerated: true,
                      receiptNo,
                      date: serverTimestamp(),
                      approvedAt: serverTimestamp(),
                      paidAt: serverTimestamp(),
                      createdAt: serverTimestamp(),
                      receiptData: {
                        receiptNo,
                        date: new Date().toISOString(),
                        tenantName: selectedTenant.name,
                        buildingNumber: selectedTenant.buildingNumber,
                        spaceId: selectedTenant.spaceId,
                        paymentMethod: "Cash",
                        rentAmount: computedRent,
                        payment,
                        change: Math.max(0, payment - computedRent),
                        status: "Approved",
                      },
                    });
                    void logDetailedUpdate({
                      module: "Financials",
                      type: "Cash Payment Confirmation",
                      tenantId: selectedTenant.id,
                      tenantName: selectedTenant.name,
                      spaceNo: selectedTenant.spaceId,
                      paymentAmount: computedRent,
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
                      rentAmount: computedRent,
                      payment,
                      change: Math.max(0, payment - computedRent),
                      status: "Approved",
                      receiptNo,
                    });
                    setCashReceived("");
                    setPaymentModal(false);
                    setReceiptModal(true);
                  } catch (error) {
                    console.log("PAYMENT ERROR", error);
                    Alert.alert("Error", "Failed to save payment. Try again.");
                  } finally {
                    setProcessing(false);
                  }
                }}
              >
                <Text style={styles.payModalBtnPrimaryText}>
                  {processing ? "Saving..." : "Generate Receipt"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={receiptPreviewModal} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Tenant Digital Receipt</Text>

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
                onChangeText={setCashReceived}
                keyboardType="numeric"
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

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalBtnSecondary}
                onPress={() => setReceiptPreviewModal(false)}
              >
                <Text style={styles.modalBtnSecondaryText}>Close</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalBtnPrimary}
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
                <Text style={styles.modalBtnPrimaryText}>Download Receipt</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={onlineConfirmModal} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.modalBox}>
            <View style={styles.modalTitleRow}>
              <ReceiptIcon size={18} color={colors.emerald} style={{ marginRight: spacing.sm }} />
              <Text style={styles.modalTitle}>Tenant's Online Receipt</Text>
            </View>

            <Text style={styles.receiptLine}>Receipt No: {receiptData?.receiptNo}</Text>
            <Text style={styles.receiptLine}>Tenant Name: {receiptData?.tenantName}</Text>
            <Text style={styles.receiptLine}>Building Number: {receiptData?.buildingNumber}</Text>
            <Text style={styles.receiptLine}>Space ID: {receiptData?.spaceId}</Text>
            <Text style={styles.receiptLine}>
              Date: {receiptData?.date?.toLocaleDateString?.() ?? ""}
            </Text>
            <Text style={styles.receiptLine}>Rent Amount: ₱{receiptData?.rentAmount}</Text>
            <Text style={styles.receiptLine}>Payment: ₱{receiptData?.payment}</Text>
            {receiptData?.change > 0 && (
              <Text style={styles.receiptLine}>Change: ₱{receiptData.change}</Text>
            )}

            {receiptData?.periodsCovered > 1 && (
              <View style={styles.coversBox}>
                <Text style={styles.coversBoxText}>
                  Covers: {receiptData.periodsCovered}{" "}
                  {periodUnitLabel(selectedTenant?.paymentSchedule ?? "monthly", receiptData.periodsCovered)}
                  {receiptData?.periodsAdvance > 0
                    ? ` (${receiptData.periodsCovered - receiptData.periodsAdvance} due + ${receiptData.periodsAdvance} advance)`
                    : " (no advance payment)"}
                </Text>
              </View>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalBtnSecondary}
                onPress={() => {
                  setOnlineConfirmModal(false);
                }}
              >
                <Text style={styles.modalBtnSecondaryText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalBtnPrimary}
                onPress={async () => {
                  if (!selectedTenant?.paymentId) return;

                  await updateDoc(
                    doc(db, "payments", selectedTenant.paymentId),
                    {
                      status: "approved",
                      // Do NOT overwrite `date` here — it must stay the
                      // moment the tenant actually paid (set when the
                      // payment doc was first created), not when admin
                      // got around to approving it. Overwriting it shifted
                      // which day/period the payment counted toward,
                      // letting a late approval wrongly cover today's
                      // charge while leaving the day it was paid for
                      // unpaid.
                      approvedAt: serverTimestamp(),
                      verifiedBy: "admin",
                      paidAt: serverTimestamp(),
                      "receiptData.status": "Approved",
                    },
                  );

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
                }}
              >
                <Text style={styles.modalBtnPrimaryText}>Confirm Payment</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* TENANT DIGITAL RECEIPT */}

      <Modal visible={receiptModal} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.modalBox}>
            <View style={styles.modalTitleRow}>
              <ReceiptIcon size={18} color={colors.emerald} style={{ marginRight: spacing.sm }} />
              <Text style={styles.modalTitle}>Tenant's Digital Receipt</Text>
            </View>

            <Text style={styles.receiptLine}>
              Tenant Name:
              {receiptData?.tenantName}
            </Text>

            <Text style={styles.receiptLine}>
              Building Number:
              {receiptData?.buildingNumber}
            </Text>

            <Text style={styles.receiptLine}>
              Space ID:
              {receiptData?.spaceId}
            </Text>

            <Text style={styles.receiptLine}>
              Date:
              {receiptData?.date?.toDateString()}
            </Text>

            <Text style={styles.receiptLine}>Rent Amount: ₱{receiptData?.rentAmount}</Text>

            <Text style={styles.receiptLine}>Payment: ₱{receiptData?.payment}</Text>

            <Text style={styles.receiptLine}>Change: ₱{receiptData?.change}</Text>

            <Text style={styles.receiptLine}>
              Approval Status:
              {receiptData?.status}
            </Text>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalBtnSecondary}
                onPress={() => {
                  setReceiptModal(false);
                }}
              >
                <Text style={styles.modalBtnSecondaryText}>Close</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalBtnPrimary}
                onPress={downloadReceipt}
              >
                <Text style={styles.modalBtnPrimaryText}>Download Receipt</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <HelpTour visible={tourVisible} steps={tourSteps} onClose={() => setTourVisible(false)} />
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
    flexDirection: "column",
    alignItems: "stretch",
    alignSelf: "center",
    gap: spacing.sm,
    marginLeft: spacing.md,
    width: 128,
    flexShrink: 0,
  },
  viewInfoBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    width: 92,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  viewInfoBtnText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
    textAlign: "center",
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
  countPill: {
    backgroundColor: "rgba(255,255,255,0.16)",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  countPillText: { fontSize: fontSize.xs + 1, fontFamily: fontFamily.semibold, color: colors.emeraldSoft },

  body: {
    flex: 1,
    backgroundColor: colors.parchment,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl - 2,
  },

  summaryRow: {
    flexDirection: "row",
    gap: spacing.sm + 2,
    marginBottom: spacing.lg,
  },
  summaryCard: {
    flex: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg - 2,
  },
  summaryCardSpaces: { backgroundColor: colors.emerald },
  summaryCardPaid: { backgroundColor: colors.emeraldSoft },
  summaryCardUnpaid: { backgroundColor: colors.warningSoft },
  summaryLabelSpaces: {
    fontSize: fontSize.xs - 1,
    fontFamily: fontFamily.semibold,
    color: colors.emeraldSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  summaryLabelPaid: {
    fontSize: fontSize.xs - 1,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  summaryLabelUnpaid: {
    fontSize: fontSize.xs - 1,
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
    color: colors.warning,
    marginTop: 2,
  },

  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    marginBottom: spacing.lg,
  },
  filterLabel: { fontSize: fontSize.base, fontFamily: fontFamily.semibold, color: colors.ink },
  segmentTrack: {
    flexDirection: "row",
    backgroundColor: colors.mist,
    borderRadius: radius.pill,
    padding: 3,
  },
  segmentItem: {
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
  },
  segmentItemActive: {
    backgroundColor: colors.emerald,
  },
  segmentText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.textSecondary,
  },
  segmentTextActive: {
    color: colors.white,
  },

  centeredBox: { flex: 1, justifyContent: "center", alignItems: "center" },
  card: {
    flex: 1,
  },
  cardHeader: {
    backgroundColor: colors.emeraldSoft,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xl - 2,
    paddingVertical: spacing.md + 2,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  cardHeaderText: { fontSize: fontSize.base, fontFamily: fontFamily.semibold, color: colors.emerald },

  tenantCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xl - 2,
    paddingVertical: spacing.lg,
    marginBottom: spacing.sm + 2,
  },
  rowLeft: { flex: 1, flexShrink: 1 },
  rowMetaWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowMeta: { fontSize: fontSize.xs, fontFamily: fontFamily.medium, color: colors.textMuted },
  rowName: { fontSize: fontSize.base, fontFamily: fontFamily.bold, color: colors.textPrimary, marginTop: spacing.xs + 2 },

  setPaidBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    width: 92,
    borderRadius: radius.pill,
    backgroundColor: colors.emerald,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    ...shadow.card,
  },
  setPaidBtnIcon: { marginRight: 6 },
  setPaidBtnOnline: { backgroundColor: colors.warningSoft },
  setPaidBtnText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.white,
    textAlign: "center",
  },
  setPaidBtnTextOnline: { color: colors.warning },
  btnPressed: { opacity: 0.8 },

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
  modalTitle: {
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
    marginBottom: spacing.lg - 1,
    color: colors.ink,
  },
  modalTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.lg - 1,
  },
  modalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.sm - 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  coversBox: {
    backgroundColor: colors.emeraldSoft,
    borderRadius: radius.sm - 2,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md - 2,
    marginTop: spacing.sm + 2,
  },
  coversBoxText: {
    fontSize: fontSize.xs + 1,
    color: colors.emerald,
    fontFamily: fontFamily.medium,
  },
  modalLabel: { fontSize: fontSize.sm, fontFamily: fontFamily.regular, color: colors.textSecondary },
  modalValue: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.ink },
  rentAmountBox: { alignItems: "flex-end" },
  dueBreakdownText: { fontSize: fontSize.xs, fontFamily: fontFamily.regular, color: colors.textMuted, marginTop: 2 },
  modalBodyText: { fontSize: fontSize.base, fontFamily: fontFamily.regular, color: colors.textSecondary, marginBottom: spacing.lg },
  receiptLine: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    color: colors.ink,
    paddingVertical: spacing.xs + 1,
  },
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
  modalBtnSecondaryText: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.textSecondary },
  modalBtnPrimary: {
    backgroundColor: colors.emerald,
    borderRadius: radius.sm - 2,
    paddingVertical: spacing.sm + 1,
    paddingHorizontal: spacing.lg + 2,
    ...shadow.button,
  },
  modalBtnPrimaryText: { fontSize: fontSize.sm, fontFamily: fontFamily.bold, color: colors.white },

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
    backgroundColor: colors.white,
    borderRadius: radius.xl + 4,
    padding: spacing.xl,
    ...shadow.raised,
  },
  payModalTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  payModalBadge: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  payModalBadgeText: {
    fontSize: fontSize.lg,
    fontFamily: fontFamily.extrabold,
    color: colors.white,
  },
  payModalTitle: {
    flex: 1,
    fontSize: fontSize.lg,
    fontFamily: fontFamily.extrabold,
    color: colors.ink,
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
  payModalBtnSecondaryText: { fontSize: fontSize.base, fontFamily: fontFamily.semibold, color: colors.emerald },
  payModalBtnPrimary: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.ink,
    borderRadius: radius.pill,
    paddingVertical: spacing.md - 1,
    ...shadow.button,
  },
  payModalBtnPrimaryText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.white,
    textAlign: "center",
  },

});
