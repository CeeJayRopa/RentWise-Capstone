import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
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
import { Menu } from "lucide-react-native";
import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import { Colors } from "../shared/constants/color";
import { logUpdate } from "../shared/services/updatesService";
import Sidebar from "./components/Sidebar";
import UpdatesReportFAB from "./components/UpdatesReportFAB";
import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

type StatusFilter = "All" | "Paid" | "Unpaid" | "Online Payment";

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
  console.log("WEEK CHECK", a, b, startA.getTime() === startB.getTime());
  return startA.getTime() === startB.getTime();
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

      console.log("================================");
      console.log("TENANT DOC ID:", d.id);
      console.log("TENANT NAME:", `${u.firstName} ${u.lastName}`);
      console.log("STALL:", stall);
      console.log(
        "MATCHING PAYMENTS:",
        tenantPayments.map((p) => ({
          id: p.id,
          userId: p.userId,
          status: p.status,
          date: p.date,
        })),
      );

      let tenantStatus: "paid" | "unpaid" | "online" = "unpaid";
      let paymentId: null | string = null;

      for (const p of tenantPayments) {
        const paymentDate = p.date?.toDate?.();

        console.log("PAYMENT STATUS:", p.status);
        console.log("PAYMENT DATE:", paymentDate);
        console.log("PAYMENT SCHEDULE:", stall?.paymentSchedule);

        if (!paymentDate) continue;

        let valid = false;
        if (stall?.paymentSchedule === "daily")
          valid = isSameDay(paymentDate, today);
        if (stall?.paymentSchedule === "weekly")
          valid = isSameWeek(paymentDate, today);
        if (stall?.paymentSchedule === "monthly")
          valid = isSameMonth(paymentDate, today);

        console.log("VALID:", valid);
        console.log("BEFORE STATUS:", tenantStatus);

        if (!valid) continue;

        paymentId = p.id;
        if (p.status === "pending") tenantStatus = "online";
        if (p.status === "approved") tenantStatus = "paid";

        console.log("AFTER STATUS:", tenantStatus);
      }

      console.log("FINAL TENANT STATUS:", d.id, tenantStatus);

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
              console.log(
                "FINANCIALS payments snapshot:",
                allPayments.length,
                "docs →",
                allPayments.map((p) => ({
                  id: p.id,
                  userId: p.userId,
                  status: p.status,
                  method: p.method,
                })),
              );
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

      console.log("Generating PDF...");
      const { base64 } = await Print.printToFileAsync({ html, base64: true });
      console.log("PDF generated");

      const destFile = new File(Paths.cache, `receipt-${receiptNo}.pdf`);
      destFile.write(base64!, { encoding: "base64" });
      console.log("PDF written to:", destFile.uri);

      const canShare = await Sharing.isAvailableAsync();
      console.log("Sharing available:", canShare);

      if (canShare) {
        console.log("Sharing PDF...");
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
    return monthlyRent;
  };

  const confirmOnlinePayment = async (row: TenantRow) => {
    if (!row.paymentId) return;

    try {
      const paymentRef = doc(db, "payments", row.paymentId);

      const paymentSnap = await getDoc(paymentRef);

      if (!paymentSnap.exists()) {
        console.log("Payment not found");
        return;
      }

      const payment = paymentSnap.data();

      console.log("ONLINE PAYMENT DATA:", payment);

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

          if (filter === "Online Payment") return r.status === "online";

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
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => setSidebarVisible(true)}
        >
          <Menu size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>RentWise</Text>
        <View style={styles.iconBtn} />
      </View>

      {/* BANNER */}
      <View style={styles.banner}>
        <Text style={styles.bannerLine1}>Ka Domeng Talipapa</Text>
        <Text style={styles.bannerLine2}>Wet and Dry Market</Text>
      </View>

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
            <Text style={styles.filterArrow}> ▽</Text>
          </TouchableOpacity>
          {dropdownOpen && (
            <View style={styles.dropdown}>
              {(
                ["All", "Paid", "Unpaid", "Online Payment"] as StatusFilter[]
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

      {/* TABLE */}
      <View style={styles.tableArea}>
        {loading ? (
          <View style={styles.centeredBox}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        ) : (
          <View style={styles.tableCard}>
            <View style={styles.colHeader}>
              <Text style={styles.colHeaderText}>Tenant Info</Text>

              <Text style={styles.colHeaderAction}>Action</Text>
            </View>

            {filteredRows.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>No tenants found.</Text>
              </View>
            ) : (
              <FlatList
                data={filteredRows}
                keyExtractor={(item) => item.id}
                renderItem={({ item, index }) => (
                  <View
                    style={[
                      styles.row,
                      index < filteredRows.length - 1 && styles.rowDivider,
                    ]}
                  >
                    {/* TENANT INFO */}
                    <View style={styles.rowLeft}>
                      <Text style={styles.rowText}>
                        Building Number: {item.buildingNumber}
                      </Text>

                      <Text style={styles.rowText}>
                        Space ID: {item.spaceId}
                      </Text>

                      <Text style={styles.rowText}>Name: {item.name}</Text>

                      <Text style={styles.rowText}>
                        Rent: ₱{item.rent.toLocaleString()}
                      </Text>
                    </View>

                    {/* VIEW INFO BUTTON */}
                    <TouchableOpacity
                      style={styles.profileBtn}
                      onPress={() => {
                        router.push({
                          pathname: "/tenant-preview",

                          params: {
                            tenantId: item.id,
                          },
                        });
                      }}
                    >
                      <Text style={styles.profileBtnText}>View Info</Text>
                    </TouchableOpacity>

                    {/* PAYMENT BUTTON */}
                    <TouchableOpacity
                      style={[
                        styles.toggleBtn,

                        item.status !== "unpaid" && styles.toggleBtnPaid,
                      ]}
                      onPress={async () => {
                        if (item.status === "online") {
                          setSelectedTenant(item);

                          // DEBUG: surface every pending doc for this tenant so
                          // stale docs with wrong rentAmount are visible in logs
                          const debugSnap = await getDocs(
                            query(
                              collection(db, "payments"),
                              where("userId", "==", item.id),
                              where("status", "==", "pending"),
                            ),
                          );
                          console.log(
                            "ADMIN DEBUG — pending docs for",
                            item.id,
                            "count:",
                            debugSnap.docs.length,
                          );
                          debugSnap.docs.forEach((d) => {
                            const p = d.data();
                            console.log(
                              "  id:", d.id,
                              "| amount:", p.amount,
                              "| rentAmount:", p.rentAmount,
                              "| createdAt:", p.createdAt,
                            );
                          });

                          // Fetch the exact payment computeRows already identified
                          // instead of guessing via docs[0]
                          if (!item.paymentId) return;

                          const paymentSnap = await getDoc(
                            doc(db, "payments", item.paymentId),
                          );

                          if (!paymentSnap.exists()) {
                            console.log(
                              "ADMIN: payment not found, id:",
                              item.paymentId,
                            );
                            return;
                          }

                          const onlinePayment = paymentSnap.data();

                          console.log(
                            "ADMIN: fetched paymentId:", item.paymentId,
                            "| amount:", onlinePayment.amount,
                            "| rentAmount:", onlinePayment.rentAmount,
                          );

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
                          styles.toggleBtnText,

                          item.status !== "unpaid" && styles.toggleBtnTextPaid,
                        ]}
                      >
                        {item.status === "unpaid"
                          ? "Set to Paid"
                          : item.status === "online"
                            ? "Confirm"
                            : "Paid"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              />
            )}
          </View>
        )}
      </View>
      <UpdatesReportFAB />

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
                    void logUpdate({
                      category: "finance",
                      tenantName: selectedTenant.name,
                      status: "Paid",
                      spaceNo: selectedTenant.spaceId,
                      change: "Receipt Generation",
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
  screen: { flex: 1, backgroundColor: "#F5F5F5" },
  fullCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F5F5F5",
  },
  profileBtn: {
    borderWidth: 1,
    borderColor: "#2D6A4F",
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 8,
    alignItems: "center",
  },

  profileBtnText: {
    color: "#2D6A4F",
    fontWeight: "600",
    fontSize: 13,
  },

  header: {
    backgroundColor: "#1A1A1A",
    paddingBottom: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconBtn: {
    width: 36,
    height: 36,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: { fontSize: 20, fontWeight: "700", color: "#FFFFFF" },

  banner: {
    backgroundColor: "#8FD4A8",
    paddingVertical: 18,
    alignItems: "center",
  },
  bannerLine1: { fontSize: 20, fontWeight: "700", color: "#1A1A1A" },
  bannerLine2: { fontSize: 18, fontWeight: "700", color: "#1A1A1A" },

  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  filterLabel: { fontSize: 14, color: "#1A1A1A", marginRight: 10 },
  filterBtnWrapper: { position: "relative" },
  filterBtn: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#AAAAAA",
    borderRadius: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#FFFFFF",
  },
  filterBtnText: { fontSize: 13, fontWeight: "600" },
  filterArrow: { fontSize: 12, color: "#555555" },

  dropdown: {
    position: "absolute",
    top: 36,
    left: 0,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#AAAAAA",
    borderRadius: 5,
    minWidth: 150,
    zIndex: 200,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  dropdownItem: { paddingVertical: 11, paddingHorizontal: 14 },
  dropdownItemActive: { backgroundColor: "#F0F0F0" },
  dropdownItemText: { fontSize: 13, color: "#1A1A1A" },
  dropdownItemTextActive: { fontWeight: "700", color: Colors.primary },
  dropdownBackdrop: { zIndex: 100 },

  tableArea: { flex: 1, padding: 14 },
  centeredBox: { flex: 1, justifyContent: "center", alignItems: "center" },
  tableCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#BBBBBB",
    borderRadius: 6,
    overflow: "hidden",
  },
  colHeader: {
    flexDirection: "row",
    backgroundColor: "#F0F0F0",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#BBBBBB",
  },
  colHeaderText: { fontWeight: "700", fontSize: 14, flex: 1 },
  colHeaderAction: { width: 110 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: "#EBEBEB" },
  rowLeft: { flex: 1, flexShrink: 1 },
  rowText: { fontSize: 13, color: "#1A1A1A", lineHeight: 20 },

  toggleBtn: {
    borderWidth: 1,
    borderColor: "#1A1A1A",
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    minWidth: 100,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    flexShrink: 0,
    marginLeft: 8,
  },
  toggleBtnPaid: { backgroundColor: "#EBF5EB", borderColor: "#2D6A4F" },
  toggleBtnText: { fontSize: 13, fontWeight: "600", color: "#1A1A1A" },
  toggleBtnTextPaid: { color: "#2D6A4F" },

  emptyBox: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyText: { color: "#999" },

  fab: {
    position: "absolute",
    right: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#F4C430",
    justifyContent: "center",
    alignItems: "center",
    elevation: 6,
  },

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

  rentBox: {
    borderWidth: 1,
    borderColor: "#2D6A4F",
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginLeft: 8,
    backgroundColor: "#FFFFFF",
  },

  rentText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#2D6A4F",
  },

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
