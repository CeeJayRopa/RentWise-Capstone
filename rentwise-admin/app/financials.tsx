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
import { Ionicons } from "@expo/vector-icons";
import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import { Colors } from "../shared/constants/color";
import { logDetailedUpdate } from "../shared/services/updatesService";
import Sidebar from "./components/Sidebar";
import NotificationBell from "./components/NotificationBell";
import UpdatesReportFAB from "./components/UpdatesReportFAB";
import * as Print from "expo-print";
import RNBlobUtil from "react-native-blob-util";

type StatusFilter = "All" | "Paid" | "Unpaid" | "Pending";

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
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("All");
  const [dropdownOpen, setDropdownOpen] = useState(false);
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

  const userDocsRef = useRef<any[]>([]);
  const stallMapRef = useRef<Map<string, StallInfo>>(new Map());
  const paymentsRef = useRef<any[]>([]);

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

  const filteredRows =
    filter === "All"
      ? rows
      : rows.filter((r) => {
          if (filter === "Paid") return r.status === "paid";

          if (filter === "Pending") return r.status === "online";

          return r.status === "unpaid";
        });
  if (checking) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      {/* HEADER */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => setSidebarVisible(true)}
        >
          <Ionicons name="menu" size={24} color="#E6F1FB" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>RentWise</Text>
        <NotificationBell />
      </View>

      {/* BANNER */}
      <View style={styles.banner}>
        <Text style={styles.bannerLine1}>Ka Domeng Talipapa</Text>
        <Text style={styles.bannerLine2}>Wet and Dry Market</Text>
      </View>

      {/* BODY */}
      <View style={styles.body}>
        {/* FILTER */}
        <View style={[styles.filterRow, dropdownOpen && { zIndex: 150 }]}>
          <Text style={styles.filterLabel}>Status:</Text>
          <View style={styles.filterBtnWrapper}>
            <TouchableOpacity
              style={styles.filterBtn}
              onPress={() => setDropdownOpen((v) => !v)}
              activeOpacity={0.8}
            >
              <Text style={styles.filterBtnText}>{filter}</Text>
              <Ionicons name="chevron-down" size={14} color="#2E6FD9" />
            </TouchableOpacity>
            {dropdownOpen && (
              <View style={styles.dropdown}>
                {(
                  ["All", "Paid", "Unpaid", "Pending"] as StatusFilter[]
                ).map((opt) => (
                  <TouchableOpacity
                    key={opt}
                    style={[
                      styles.dropdownItem,
                      filter === opt && styles.dropdownItemActive,
                    ]}
                    onPress={() => {
                      setFilter(opt);
                      setDropdownOpen(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.dropdownItemText,
                        filter === opt && styles.dropdownItemTextActive,
                      ]}
                    >
                      {opt}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </View>

        {/* TENANT INFO CARD */}
        {loading ? (
          <View style={styles.centeredBox}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardHeaderText}>Tenant info</Text>
            </View>

            {filteredRows.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="people-outline" size={40} color="#B5D4F4" style={styles.emptyIcon} />
                <Text style={styles.emptyText}>No tenants found.</Text>
              </View>
            ) : (
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
                refreshControl={
                  <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                }
              >
                {filteredRows.map((item, index) => (
                  <View
                    key={item.id}
                    style={[
                      styles.row,
                      index < filteredRows.length - 1 && styles.rowBorder,
                    ]}
                  >
                    {/* TENANT INFO */}
                    <View style={styles.rowLeft}>
                      <Text style={styles.rowText}>
                        Building number: {item.buildingNumber}
                      </Text>

                      <Text style={styles.rowTextSpaced}>
                        Space ID: {item.spaceId}
                      </Text>

                      <Text style={styles.rowName}>Name: {item.name}</Text>
                    </View>

                    <View style={styles.rowDividerVertical} />

                    {/* ACTION BUTTONS — Set to Paid on top, View Info below */}
                    <View style={styles.actionBtns}>
                      {/* PAYMENT BUTTON */}
                      <Pressable
                        style={({ pressed }) => [
                          styles.setPaidBtn,
                          item.status !== "unpaid" && styles.setPaidBtnPaid,
                          pressed && styles.btnPressed,
                        ]}
                        onPress={async () => {
                          if (item.status === "online") {
                            await confirmOnlinePayment(item);
                          } else if (item.status === "unpaid") {
                            setSelectedTenant(item);
                            setCashReceived("");
                            setPaymentModal(true);
                          }
                        }}
                        disabled={item.status === "paid"}
                      >
                        <Text
                          style={[
                            styles.setPaidBtnText,
                            item.status !== "unpaid" && styles.setPaidBtnTextPaid,
                          ]}
                        >
                          {item.status === "unpaid"
                            ? "Set to Paid"
                            : item.status === "online"
                              ? "Confirm"
                              : "Paid"}
                        </Text>
                      </Pressable>

                      {/* VIEW INFO BUTTON */}
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
                        <Text style={styles.viewInfoBtnText}>View info</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        )}
      </View>
      <UpdatesReportFAB disabled={sidebarVisible} />

      {/* CASH PAYMENT MODAL */}
      <Modal visible={paymentModal} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Payment Confirmation</Text>
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
              <Text style={styles.modalValue}>{new Date().toDateString()}</Text>
            </View>
            <View style={styles.modalRow}>
              <Text style={styles.modalLabel}>Rent Amount</Text>
              <Text style={styles.modalValue}>₱{computedRent}</Text>
            </View>
            <View style={styles.modalRow}>
              <Text style={styles.modalLabel}>Cash Received</Text>

              <TextInput
                value={cashReceived}
                onChangeText={setCashReceived}
                keyboardType="numeric"
                placeholder="Enter amount"
                style={styles.cashInput}
              />
            </View>
            <View style={styles.modalRow}>
              <Text style={styles.modalLabel}>Change</Text>
              <Text style={styles.modalValue}>₱{change > 0 ? change : 0}</Text>
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalBtnSecondary}
                onPress={() => setPaymentModal(false)}
                disabled={processing}
              >
                <Text style={styles.modalBtnSecondaryText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalBtnPrimary}
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
                <Text style={styles.modalBtnPrimaryText}>
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
            <Text style={styles.modalTitle}>Tenant's Online Receipt</Text>

            <Text style={styles.modalRow}>Receipt No: {receiptData?.receiptNo}</Text>
            <Text style={styles.modalRow}>Tenant Name: {receiptData?.tenantName}</Text>
            <Text style={styles.modalRow}>Building Number: {receiptData?.buildingNumber}</Text>
            <Text style={styles.modalRow}>Space ID: {receiptData?.spaceId}</Text>
            <Text style={styles.modalRow}>
              Date: {receiptData?.date?.toLocaleDateString?.() ?? ""}
            </Text>
            <Text style={styles.modalRow}>Rent Amount: ₱{receiptData?.rentAmount}</Text>
            <Text style={styles.modalRow}>Payment: ₱{receiptData?.payment}</Text>
            {receiptData?.change > 0 && (
              <Text style={styles.modalRow}>Change: ₱{receiptData.change}</Text>
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
                <Text>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalBtnPrimary}
                onPress={async () => {
                  if (!selectedTenant?.paymentId) return;

                  await updateDoc(
                    doc(db, "payments", selectedTenant.paymentId),
                    {
                      status: "approved",
                      date: serverTimestamp(),
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
            <Text style={styles.modalTitle}>Tenant's Digital Receipt</Text>

            <Text>
              Tenant Name:
              {receiptData?.tenantName}
            </Text>

            <Text>
              Building Number:
              {receiptData?.buildingNumber}
            </Text>

            <Text>
              Space ID:
              {receiptData?.spaceId}
            </Text>

            <Text>
              Date:
              {receiptData?.date?.toDateString()}
            </Text>

            <Text>Rent Amount: ₱{receiptData?.rentAmount}</Text>

            <Text>Payment: ₱{receiptData?.payment}</Text>

            <Text>Change: ₱{receiptData?.change}</Text>

            <Text>
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
                <Text>Close</Text>
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

      {/* Dropdown backdrop — closes dropdown when tapping outside */}
      {dropdownOpen && (
        <TouchableOpacity
          style={[StyleSheet.absoluteFill, styles.dropdownBackdrop]}
          onPress={() => setDropdownOpen(false)}
          activeOpacity={1}
        />
      )}

      {/* Sidebar last — renders above everything */}
      <Sidebar
        visible={sidebarVisible}
        onClose={() => setSidebarVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F0F4FA" },
  fullCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F0F4FA",
  },
  actionBtns: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 8,
    marginLeft: 8,
    flexShrink: 0,
  },
  viewInfoBtn: {
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#2E6FD9",
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: "center",
  },
  viewInfoBtnText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#2E6FD9",
    textAlign: "center",
  },

  header: {
    backgroundColor: "#0C2D6B",
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  iconBtn: {
    width: 24,
    height: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "500",
    color: "#FFFFFF",
    flex: 1,
    textAlign: "center",
  },

  banner: {
    backgroundColor: "#1A4DA0",
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  bannerLine1: {
    fontSize: 20,
    fontWeight: "500",
    color: "#FFFFFF",
    textAlign: "center",
  },
  bannerLine2: {
    fontSize: 16,
    fontWeight: "500",
    color: "#B5D4F4",
    textAlign: "center",
    marginTop: 2,
  },

  body: {
    flex: 1,
    backgroundColor: "#F0F4FA",
    paddingHorizontal: 16,
    paddingTop: 18,
  },

  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
  },
  filterLabel: { fontSize: 14, fontWeight: "500", color: "#0C2D6B" },
  filterBtnWrapper: { position: "relative" },
  filterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#B5D4F4",
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  filterBtnText: { fontSize: 14, fontWeight: "500", color: "#0C2D6B" },

  dropdown: {
    position: "absolute",
    top: 44,
    left: 0,
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "#B5D4F4",
    borderRadius: 10,
    minWidth: 150,
    zIndex: 200,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    overflow: "hidden",
  },
  dropdownItem: { paddingVertical: 11, paddingHorizontal: 14 },
  dropdownItemActive: { backgroundColor: "#E6F1FB" },
  dropdownItemText: { fontSize: 13, color: "#0C2D6B" },
  dropdownItemTextActive: { fontWeight: "700", color: "#0C2D6B" },
  dropdownBackdrop: { zIndex: 100 },

  centeredBox: { flex: 1, justifyContent: "center", alignItems: "center" },
  card: {
    flex: 1,
    marginBottom: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: "#B5D4F4",
    overflow: "hidden",
  },
  cardHeader: {
    backgroundColor: "#E6F1FB",
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  cardHeaderText: { fontSize: 15, fontWeight: "500", color: "#0C2D6B" },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  rowBorder: { borderBottomWidth: 0.5, borderBottomColor: "#E6F1FB" },
  rowDividerVertical: {
    width: 1,
    height: "100%",
    backgroundColor: "#E6F1FB",
    marginHorizontal: 14,
  },
  rowLeft: { flex: 1, flexShrink: 1 },
  rowText: { fontSize: 14, color: "#444441" },
  rowTextSpaced: { fontSize: 14, color: "#444441", marginTop: 2 },
  rowName: { fontSize: 14, fontWeight: "500", color: "#0C2D6B", marginTop: 2 },

  setPaidBtn: {
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#0C2D6B",
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: "center",
  },
  setPaidBtnPaid: { borderColor: "#0C2D6B" },
  setPaidBtnText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#0C2D6B",
    textAlign: "center",
  },
  setPaidBtnTextPaid: { color: "#0C2D6B" },
  btnPressed: { backgroundColor: "#E6F1FB" },

  emptyBox: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  emptyIcon: { marginBottom: 10 },
  emptyText: { fontSize: 15, color: "#888780", textAlign: "center" },

  modalBg: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalBox: {
    width: "85%",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 15,
    color: "#1A1A1A",
  },
  modalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F0",
  },
  coversBox: {
    backgroundColor: "#F0F4FA",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 10,
  },
  coversBoxText: {
    fontSize: 12,
    color: "#1A4DA0",
    fontWeight: "500",
  },
  modalLabel: { fontSize: 13, color: "#555555" },
  modalValue: { fontSize: 13, fontWeight: "600", color: "#1A1A1A" },
  modalBodyText: { fontSize: 14, color: "#444444", marginBottom: 16 },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 20,
    gap: 10,
  },
  modalBtnSecondary: {
    borderWidth: 1,
    borderColor: "#AAAAAA",
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 18,
  },
  modalBtnSecondaryText: { fontSize: 14, color: "#555555" },
  modalBtnPrimary: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 18,
  },
  modalBtnPrimaryText: { fontSize: 14, fontWeight: "600", color: "#FFFFFF" },

  cashInput: {
    borderWidth: 1,
    borderColor: "#AAAAAA",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    width: 120,
    fontSize: 14,
    textAlign: "right",
    backgroundColor: "#FFFFFF",
  },

});
