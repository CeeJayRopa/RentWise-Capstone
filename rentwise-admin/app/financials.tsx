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
import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

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
};

type StallInfo = {
  buildingNumber: string;
  spaceId: string;
  price: number;
  paymentSchedule: string;
};

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}
function isSameWeek(a: Date, b: Date): boolean {
  // Normalize to midnight so time-of-day differences don't affect the comparison
  const startA = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  startA.setDate(startA.getDate() - startA.getDay());
  const startB = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  startB.setDate(startB.getDate() - startB.getDay());
  return startA.getTime() === startB.getTime();
}
function isSameSemiMonth(a: Date, b: Date): boolean {
  const halfOf = (d: Date) => (d.getDate() <= 15 ? 0 : 1);
  return isSameMonth(a, b) && halfOf(a) === halfOf(b);
}

export default function Financials() {
  const insets = useSafeAreaInsets();

  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("Unpaid");
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

    const tenantList: TenantRow[] = userDocs.map((d) => {
      const u = d.data();
      const stall = stallMap.get(u.stallId);
      const tenantPayments = allPayments.filter((p) => p.userId === d.id);

      let tenantStatus: "paid" | "unpaid" | "online" = "unpaid";
      let paymentId: null | string = null;

      for (const p of tenantPayments) {
        const paymentDate = p.date?.toDate?.();

        if (!paymentDate) continue;

        let valid = false;
        if (stall?.paymentSchedule === "daily")
          valid = isSameDay(paymentDate, today);
        if (stall?.paymentSchedule === "weekly")
          valid = isSameWeek(paymentDate, today);
        if (stall?.paymentSchedule === "semi-monthly")
          valid = isSameSemiMonth(paymentDate, today);
        if (stall?.paymentSchedule === "monthly")
          valid = isSameMonth(paymentDate, today);

        if (!valid) continue;

        paymentId = p.id;
        if (p.status === "pending") tenantStatus = "online";
        if (p.status === "approved") tenantStatus = "paid";
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
      };
    });

    tenantList.sort((a, b) => {
      const spaceA = Number(a.spaceId.split("-")[1]);
      const spaceB = Number(b.spaceId.split("-")[1]);
      return spaceA - spaceB;
    });

    setRows(tenantList);
  };

  // On every screen focus: refresh users+stalls then open a live payments listener
  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      let unsubPayments: (() => void) | undefined;

      const setup = async () => {
        try {
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

          // Real-time payments listener — fires immediately then on every change
          unsubPayments = onSnapshot(
            collection(db, "payments"),
            (paymentsSnap) => {
              const allPayments: any[] = paymentsSnap.docs.map((d) => ({
                id: d.id,
                ...d.data(),
              }));
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

      const destFile = new File(Paths.cache, `receipt-${receiptNo}.pdf`);
      destFile.write(base64!, { encoding: "base64" });

      const canShare = await Sharing.isAvailableAsync();

      if (canShare) {
        await Sharing.shareAsync(destFile.uri, {
          mimeType: "application/pdf",
          dialogTitle: "Save Receipt",
          UTI: "com.adobe.pdf",
        });
      } else {
        Alert.alert(
          "Not Available",
          "Sharing is not supported on this device.",
        );
      }
    } catch (error) {
      console.log("PDF ERROR", error);
      Alert.alert("Error", "Failed to generate or share the receipt.");
    }
  };

  const confirmCashPayment = async () => {
    if (!selectedTenant) return;

    const received = Number(cashReceived);

    if (received < selectedTenant.rent) {
      alert("Insufficient payment");

      return;
    }

    setProcessing(true);

    try {
      const receiptNo = "RW-" + Date.now().toString().slice(-8);

      await addDoc(collection(db, "payments"), {
        userId: selectedTenant.id,

        amount: selectedTenant.rent,

        rentAmount: selectedTenant.rent,

        cashReceived: received,

        change: received - selectedTenant.rent,

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

  const computeRentAmount = (monthlyRent: number, schedule: string): number => {
    if (schedule === "daily") {
      const now = new Date();
      const daysInMonth = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
      ).getDate();
      return Math.round(monthlyRent / daysInMonth);
    }
    if (schedule === "weekly") {
      return Math.round(monthlyRent / 4);
    }
    if (schedule === "semi-monthly") {
      return Math.round(monthlyRent / 2);
    }
    return monthlyRent;
  };

  const confirmOnlinePayment = async (row: TenantRow) => {
    if (!row.paymentId) return;

    try {
      const paymentRef = doc(db, "payments", row.paymentId);

      const paymentSnap = await getDoc(paymentRef);

      if (!paymentSnap.exists()) return;

      const payment = paymentSnap.data();

      setSelectedTenant(row);

      setReceiptData({
        tenantName: row.name,
        buildingNumber: row.buildingNumber,
        spaceId: row.spaceId,

        // IMPORTANT PART
        rentAmount: payment.rentAmount,
        payment: payment.amount,

        status: payment.status,
      });

      setOnlineConfirmModal(true);
    } catch (error) {
      console.log("OPEN RECEIPT ERROR:", error);
    }
  };

  const computedRent = selectedTenant
    ? computeRentAmount(selectedTenant.rent, selectedTenant.paymentSchedule)
    : 0;
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
                            setSelectedTenant(item);

                            if (!item.paymentId) return;

                            const paymentSnap = await getDoc(
                              doc(db, "payments", item.paymentId),
                            );

                            if (!paymentSnap.exists()) return;

                            const onlinePayment = paymentSnap.data();

                            setReceiptData({
                              tenantName: item.name,
                              buildingNumber: item.buildingNumber,
                              spaceId: item.spaceId,
                              rentAmount: computeRentAmount(
                                item.rent,
                                item.paymentSchedule,
                              ),
                              payment: onlinePayment.amount ?? 0,
                              receipt: onlinePayment.receipt,
                              paymentId: item.paymentId,
                            });

                            setOnlineConfirmModal(true);
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
                      amount: payment,
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
                      paymentAmount: payment,
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
              <Text style={styles.modalValue}>₱{selectedTenant?.rent}</Text>
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
                    rentAmount: selectedTenant?.rent,
                    payment: Number(cashReceived),
                    change: Number(cashReceived) - Number(selectedTenant?.rent),
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

            <View
              style={{
                height: 150,
                backgroundColor: "#ddd",
                marginVertical: 20,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Text>Payment Receipt Image</Text>
            </View>

            <Text>Rent Amount: ₱{receiptData?.rentAmount}</Text>

            <Text>Payment: ₱{receiptData?.payment}</Text>

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
