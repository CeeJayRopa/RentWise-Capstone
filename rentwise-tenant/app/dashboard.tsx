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
import { useCallback, useRef, useState } from "react";

import { auth } from "../shared/firebaseConfig";
import { getTenantData } from "../services/tenantService";
import { createOnlinePayment } from "../services/paymentService";
import { setPendingCheckoutSession } from "../services/pendingPayment";

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
  const [dropdownTop, setDropdownTop] = useState(0);
  const [dropdownLeft, setDropdownLeft] = useState(0);

  const monthPillRef = useRef<View>(null);

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
    const user = auth.currentUser;
    if (!user) return;

    try {
      setRedirecting(true);
      const tenantName = tenant ? `${tenant.firstName} ${tenant.lastName}` : "";
      const tenantEmail = tenant?.email || auth.currentUser?.email || "";
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
      >
        {/* CARD 1 — Rental payment information */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Rental payment information</Text>

          <View style={[styles.infoRow, styles.infoRowBorder]}>
            <Text style={styles.infoLabel}>Payment</Text>
            <Text style={styles.infoValue}>₱{totalPayment.toLocaleString()}</Text>
          </View>

          <View style={[styles.infoRow, styles.infoRowBorder]}>
            <Text style={styles.infoLabel}>Pending</Text>
            <Text style={styles.infoValue}>₱{pendingPayment.toLocaleString()}</Text>
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
                    <Text style={[styles.receiptFieldValue, styles.textApproved]}>
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
});
