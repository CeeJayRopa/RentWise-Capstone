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
  Linking,
} from "react-native";

import BellIcon from "./components/BellIcon";

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import { db } from "../shared/services/firestore";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback, useEffect, useRef, useState } from "react";

import { auth } from "../shared/firebaseConfig";
import { getTenantData } from "../services/tenantService";
import { createOnlinePayment } from "../services/paymentService";
import { setPendingCheckoutSession } from "../services/pendingPayment";

import { logoutUser } from "../services/authService";

import { router, useFocusEffect } from "expo-router";

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

export default function Dashboard() {
  const insets = useSafeAreaInsets();

  const topInset =
    insets.top > 0 ? insets.top : (StatusBar.currentHeight ?? 24);

  const [tenant, setTenant] = useState<any>(null);

  const [stall, setStall] = useState<any>(null);

  const [payments, setPayments] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);

  const [selectedMonth, setSelectedMonth] = useState(
    MONTHS[new Date().getMonth()],
  );

  const [showMonthPicker, setShowMonthPicker] = useState(false);

  const [showMenu, setShowMenu] = useState(false);

  const [showPayModal, setShowPayModal] = useState(false);

  const [showReceiptModal, setShowReceiptModal] = useState(false);

  const [selectedPayment, setSelectedPayment] = useState<any>(null);

  const [payAmount, setPayAmount] = useState("");

  const [redirecting, setRedirecting] = useState(false);

  const monthlyRent = Number(stall?.price || 0);

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

  async function handleSignOut() {
    setShowMenu(false);

    await logoutUser();

    router.replace("/");
  }

  async function handlePayNow() {
    if (!payAmount || Number(payAmount) <= 0) {
      Alert.alert("Error", "Please enter a valid amount");
      return;
    }
    const user = auth.currentUser;
    if (!user) return;

    try {
      setRedirecting(true);
      const tenantName = tenant ? `${tenant.firstName} ${tenant.lastName}` : "";
      const tenantEmail = tenant?.email || auth.currentUser?.email || "";
      console.log("[PayNow] tenantName:", tenantName, "email:", tenantEmail);
      const { checkoutSessionId, checkoutUrl } = await createOnlinePayment(
        Number(payAmount),
        { name: tenantName, email: tenantEmail },
      );
      setPendingCheckoutSession(checkoutSessionId);
      setShowPayModal(false);
      setPayAmount("");
      await Linking.openURL(checkoutUrl);
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

  const totalPayment = successfulPayments.reduce(
    (sum, p) => sum + Number(p.amount || 0),
    0,
  );

  const pendingPayment = pendingPayments.reduce(
    (sum, p) => sum + Number(p.amount || 0),
    0,
  );

  const remainingBill = monthlyRent - totalPayment;

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
        <ActivityIndicator size="large" color="#1A1A1A" />
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

      <View
        style={[
          styles.header,
          {
            paddingTop: topInset,
          },
        ]}
      >
        <View style={styles.headerSpacer} />

        <Text style={styles.headerTitle}>RentWise</Text>

        <BellIcon />
      </View>

      {/* BODY */}

      <ScrollView
        style={styles.body}
        contentContainerStyle={[
          styles.bodyContent,

          {
            paddingBottom: insets.bottom + 16,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* TENANT BANNER */}

        <View style={styles.banner}>
          <View style={styles.avatarCircle}>
            <View style={styles.avatarHead} />

            <View style={styles.avatarBody} />
          </View>

          <View style={styles.bannerInfo}>
            <Text style={styles.bannerWelcome}>Welcome, tenant!</Text>

            <Text style={styles.bannerName}>
              {tenant?.firstName} {tenant?.lastName}
            </Text>

            <Text style={styles.bannerContact}>{tenant?.contactNo}</Text>
          </View>

          <TouchableOpacity
            style={styles.menuBtn}
            onPress={() => setShowMenu(true)}
          >
            <Text style={styles.menuDots}>•••</Text>
          </TouchableOpacity>
        </View>

        {/* PAYMENT INFORMATION */}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Rental Payment Information</Text>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Payment</Text>

            <Text style={styles.infoValue}>
              ₱{totalPayment.toLocaleString()}
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Pending</Text>

            <Text style={styles.infoValue}>
              ₱{pendingPayment.toLocaleString()}
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Remaining Bill</Text>

            <Text style={[styles.infoValue, styles.remaining]}>
              ₱{remainingBill.toLocaleString()}
            </Text>
          </View>
        </View>

        {/* PAYMENT HISTORY */}

        <View style={styles.historyCard}>
          <Text style={styles.cardTitle}>Monthly Payment History</Text>

          <TouchableOpacity
            style={styles.monthPickerBtn}
            onPress={() => setShowMonthPicker(true)}
          >
            <Text style={styles.monthPickerLabel}>Month:</Text>

            <Text style={styles.monthPickerValue}>{selectedMonth}</Text>

            <Text style={styles.monthPickerArrow}>▼</Text>
          </TouchableOpacity>

          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, styles.colDate]}>Date</Text>

            <Text style={[styles.tableHeaderCell, styles.colStatus]}>
              Status
            </Text>

            <Text style={[styles.tableHeaderCell, styles.colReceipt]}>
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
              renderItem={({ item }) => (
                <View style={styles.tableRow}>
                  <Text style={[styles.tableCell, styles.colDate]}>
                    {formatDate(item.date)}
                  </Text>

                  <Text
                    style={[
                      styles.tableCell,

                      styles.colStatus,

                      item.status === "approved"
                        ? styles.statusSuccess
                        : item.status === "rejected"
                          ? styles.statusRejected
                          : styles.statusPending,
                    ]}
                  >
                    {item.status.toUpperCase()}
                  </Text>

                  <View style={[styles.colReceipt, styles.receiptIconWrap]}>
                    {item.receiptData || item.receipt ? (
                      <TouchableOpacity
                        style={styles.receiptCell}
                        onPress={() => openReceipt(item)}
                      >
                        <View style={styles.receiptIcon}>
                          <View style={styles.receiptLine} />

                          <View style={styles.receiptLine} />

                          <View style={styles.receiptLine} />
                        </View>
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

      {/* MENU MODAL */}

      <Modal visible={showMenu} transparent animationType="fade">
        <TouchableOpacity
          style={styles.menuOverlay}
          activeOpacity={1}
          onPress={() => setShowMenu(false)}
        >
          <View
            style={[
              styles.menuCard,
              {
                top: insets.top + 60,
                right: 16,
              },
            ]}
          >
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

                setShowPayModal(true);
              }}
            >
              <Text style={styles.menuItemText}>Pay Online</Text>
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

      <Modal visible={showPayModal} transparent animationType="slide">
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

            <TouchableOpacity
              style={[
                styles.payNowBtn,
                redirecting && styles.payNowBtnDisabled,
              ]}
              disabled={redirecting}
              onPress={handlePayNow}
            >
              <Text style={styles.payNowText}>
                {redirecting
                  ? "Redirecting to PayMongo..."
                  : "Pay Now via GCash/Maya"}
              </Text>
            </TouchableOpacity>

            <Text style={styles.payHint}>
              You will be redirected to PayMongo to complete your payment via
              GCash or Maya. A receipt will be generated automatically after
              successful payment.
            </Text>

            <TouchableOpacity
              style={[styles.cancelBtn, { marginTop: 8 }]}
              onPress={() => {
                setShowPayModal(false);
                setPayAmount("");
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
                <View style={styles.receiptFields}>
                  <View style={styles.receiptFieldRow}>
                    <Text style={styles.receiptFieldLabel}>Receipt No</Text>
                    <Text style={styles.receiptFieldValue}>
                      {selectedPayment.receiptData.receiptNo}
                    </Text>
                  </View>
                  <View style={styles.receiptFieldRow}>
                    <Text style={styles.receiptFieldLabel}>Tenant Name</Text>
                    <Text style={styles.receiptFieldValue}>
                      {selectedPayment.receiptData.tenantName}
                    </Text>
                  </View>
                  <View style={styles.receiptFieldRow}>
                    <Text style={styles.receiptFieldLabel}>Building No</Text>
                    <Text style={styles.receiptFieldValue}>
                      {selectedPayment.receiptData.buildingNumber}
                    </Text>
                  </View>
                  <View style={styles.receiptFieldRow}>
                    <Text style={styles.receiptFieldLabel}>Space ID</Text>
                    <Text style={styles.receiptFieldValue}>
                      {selectedPayment.receiptData.spaceId}
                    </Text>
                  </View>
                  {selectedPayment.receiptData.paymentMethod && (
                    <View style={styles.receiptFieldRow}>
                      <Text style={styles.receiptFieldLabel}>Payment Method</Text>
                      <Text style={styles.receiptFieldValue}>
                        {selectedPayment.receiptData.paymentMethod}
                      </Text>
                    </View>
                  )}
                  <View style={styles.receiptFieldRow}>
                    <Text style={styles.receiptFieldLabel}>Date</Text>
                    <Text style={styles.receiptFieldValue}>
                      {new Date(
                        selectedPayment.receiptData.date,
                      ).toLocaleDateString()}
                    </Text>
                  </View>
                  <View style={styles.receiptFieldRow}>
                    <Text style={styles.receiptFieldLabel}>Rent Amount</Text>
                    <Text style={styles.receiptFieldValue}>
                      ₱{selectedPayment.receiptData.rentAmount}
                    </Text>
                  </View>
                  <View style={styles.receiptFieldRow}>
                    <Text style={styles.receiptFieldLabel}>Payment</Text>
                    <Text style={styles.receiptFieldValue}>
                      ₱{selectedPayment.receiptData.payment}
                    </Text>
                  </View>
                  <View style={styles.receiptFieldRow}>
                    <Text style={styles.receiptFieldLabel}>Change</Text>
                    <Text style={styles.receiptFieldValue}>
                      ₱{selectedPayment.receiptData.change}
                    </Text>
                  </View>
                  <View style={styles.receiptFieldRow}>
                    <Text style={styles.receiptFieldLabel}>Status</Text>
                    <Text
                      style={[styles.receiptFieldValue, styles.statusSuccess]}
                    >
                      {selectedPayment.receiptData.status}
                    </Text>
                  </View>
                </View>
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

      {/* MONTH PICKER */}

      <Modal visible={showMonthPicker} transparent animationType="fade">
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>Select Month</Text>

            <ScrollView>
              {MONTHS.map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[
                    styles.pickerItem,

                    m === selectedMonth && styles.pickerItemActive,
                  ]}
                  onPress={() => {
                    setSelectedMonth(m);

                    setShowMonthPicker(false);
                  }}
                >
                  <Text
                    style={[
                      styles.pickerItemText,

                      m === selectedMonth && styles.pickerItemTextActive,
                    ]}
                  >
                    {m}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#1A1A1A",
  },

  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#E8E8E8",
  },

  header: {
    backgroundColor: "#1A1A1A",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },

  headerSpacer: {
    width: 36,
  },

  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
  },

  bellBtn: {
    width: 36,
    alignItems: "flex-end",
  },

  bellIcon: {
    fontSize: 18,
  },

  body: {
    flex: 1,
    backgroundColor: "#E8E8E8",
  },

  bodyContent: {
    paddingHorizontal: 16,
    paddingTop: 0,
  },

  banner: {
    backgroundColor: "#B5A89A",
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    marginHorizontal: -16,
    marginBottom: 14,
  },

  avatarCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#C8C8C8",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "flex-end",
    marginRight: 12,
  },

  avatarHead: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#6B6B6B",
    position: "absolute",
    top: 10,
  },

  avatarBody: {
    width: 40,
    height: 28,
    borderRadius: 20,
    backgroundColor: "#6B6B6B",
  },

  bannerInfo: {
    flex: 1,
  },

  bannerWelcome: {
    color: "#fff",
    fontSize: 13,
  },

  bannerName: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },

  bannerContact: {
    color: "#fff",
    fontSize: 13,
  },

  menuBtn: {
    paddingLeft: 12,
    paddingVertical: 4,
  },

  menuDots: {
    color: "#fff",
    fontSize: 20,
  },

  card: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 16,
    marginBottom: 14,
  },

  historyCard: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 16,
  },

  cardTitle: {
    fontSize: 15,
    fontWeight: "bold",
    marginBottom: 12,
  },

  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
  },

  infoLabel: {
    color: "#555",
  },

  infoValue: {
    fontWeight: "600",
  },

  remaining: {
    color: "#C0392B",
  },

  divider: {
    height: 1,
    backgroundColor: "#eee",
  },

  colDate: {
    flex: 2,
  },

  colStatus: {
    flex: 2,
  },

  colReceipt: {
    flex: 1,
    alignItems: "center",
  },

  tableRow: {
    flexDirection: "row",
    paddingVertical: 10,
    alignItems: "center",
  },

  tableCell: {
    fontSize: 13,
  },

  statusSuccess: {
    color: "#27AE60",
  },

  statusPending: {
    color: "#E67E22",
  },

  statusRejected: {
    color: "#C0392B",
  },

  receiptLine: {
    width: 20,
    height: 2,
    backgroundColor: "#555",
    marginBottom: 3,
  },

  emptyRow: {
    padding: 20,
    alignItems: "center",
  },

  emptyText: {
    color: "#888",
  },

  menuOverlay: {
    flex: 1,
  },

  menuCard: {
    position: "absolute",
    backgroundColor: "#fff",
    borderRadius: 10,
    overflow: "hidden",
  },

  menuItem: {
    padding: 15,
  },

  menuItemText: {
    color: "#1A1A1A",
  },

  signOutText: {
    color: "#C0392B",
  },

  menuDivider: {
    height: 1,
    backgroundColor: "#eee",
  },

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
  },

  payInput: {
    borderWidth: 1,
    borderColor: "#ccc",
    padding: 12,
    borderRadius: 8,
  },

  payNowBtn: {
    backgroundColor: "#F5C518",
    padding: 12,
    borderRadius: 8,
    marginTop: 10,
  },

  payNowBtnDisabled: {
    opacity: 0.5,
  },

  payNowText: {
    textAlign: "center",
    fontWeight: "bold",
  },

  payDivider: {
    height: 1,
    backgroundColor: "#eee",
    marginVertical: 15,
  },

  uploadBtn: {
    backgroundColor: "#F5C518",
    padding: 12,
    borderRadius: 8,
  },

  uploadBtnText: {
    textAlign: "center",
  },

  receiptNameText: {
    textAlign: "center",
    marginVertical: 10,
  },

  payActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },

  submitBtn: {
    flex: 1,
    backgroundColor: "#7CB87A",
    padding: 12,
    borderRadius: 8,
  },

  cancelBtn: {
    backgroundColor: "#E74C3C",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },

  submitBtnText: {
    color: "#fff",
    textAlign: "center",
  },

  cancelBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
  },

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

  receiptImage: {
    width: "100%",
    height: 350,
    resizeMode: "contain",
  },

  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,.5)",
    justifyContent: "center",
    padding: 40,
  },

  pickerCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 10,
  },

  pickerTitle: {
    textAlign: "center",
    fontWeight: "bold",
    padding: 10,
  },

  pickerItem: {
    padding: 12,
  },

  pickerItemActive: {
    backgroundColor: "#E8F5E9",
  },

  pickerItemText: {
    fontSize: 15,
  },

  pickerItemTextActive: {
    color: "#27AE60",
    fontWeight: "bold",
  },

  monthPickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F0F0F0",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
    alignSelf: "flex-start",
  },

  monthPickerLabel: {
    fontSize: 13,
    color: "#555",
  },

  monthPickerValue: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1A1A1A",
  },

  monthPickerArrow: {
    fontSize: 10,
    color: "#555",
    marginLeft: 4,
  },

  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#F5F5F5",
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 6,
    marginBottom: 4,
  },

  tableHeaderCell: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#333",
  },

  receiptIconWrap: {
    justifyContent: "center",
  },

  receiptCell: {
    padding: 4,
  },

  receiptIcon: {
    gap: 3,
  },

  noReceipt: {
    color: "#AAA",
    fontSize: 13,
  },

  payLabel: {
    fontSize: 13,
    color: "#555",
    marginBottom: 6,
    marginTop: 10,
    fontWeight: "500",
  },

  payHint: {
    fontSize: 12,
    color: "#888",
    marginBottom: 8,
    lineHeight: 17,
  },

  receiptScrollArea: {
    maxHeight: 360,
    marginBottom: 12,
  },
  receiptCloseBtn: {
    backgroundColor: "#E74C3C",
    paddingVertical: 13,
    borderRadius: 8,
    alignItems: "center",
  },
  receiptCloseBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },
  receiptFields: {
    width: "100%",
    marginBottom: 12,
  },

  receiptFieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F0",
  },

  receiptFieldLabel: {
    fontSize: 13,
    color: "#555",
  },

  receiptFieldValue: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1A1A1A",
    flexShrink: 1,
    textAlign: "right",
  },
});
