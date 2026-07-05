import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Modal,
  Image,
  Alert,
  RefreshControl,
} from "react-native";
import * as Print from "expo-print";
import RNBlobUtil from "react-native-blob-util";

import { useEffect, useState } from "react";
import { useLocalSearchParams, router } from "expo-router";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";

import { db } from "../shared/services/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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

export default function TenantPreview() {
  const insets = useSafeAreaInsets();

  const { tenantId } = useLocalSearchParams<{
    tenantId: string;
  }>();

  const [tenant, setTenant] = useState<any>(null);
  const [stall, setStall] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [generatingReceipt, setGeneratingReceipt] = useState(false);
  const [imageViewerUrl, setImageViewerUrl] = useState<string | null>(null);
  const [digitalReceipt, setDigitalReceipt] = useState<any>(null);

  useEffect(() => {
    loadTenant();
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    await loadTenant();
    setRefreshing(false);
  }

  async function loadTenant() {
    try {
      if (!tenantId) return;

      // GET USER

      // GET USER

      const userSnap = await getDoc(doc(db, "users", tenantId));

      if (userSnap.exists()) {
        const userData = userSnap.data();

        setTenant({
          id: userSnap.id,
          ...userData,
        });

        // GET STALL

        if (userData.stallId) {
          const stallSnap = await getDoc(doc(db, "stalls", userData.stallId));

          if (stallSnap.exists()) {
            setStall({
              id: stallSnap.id,
              ...stallSnap.data(),
            });
          }
        }
      }

      // GET PAYMENTS

      const q = query(
        collection(db, "payments"),
        where("userId", "==", tenantId),
      );

      const snap = await getDocs(q);

      const list: any[] = [];

      snap.forEach((d) => {
        list.push({
          id: d.id,
          ...d.data(),
        });
      });

      // Latest payment first — Firestore doesn't guarantee doc order, and
      // sorting client-side avoids needing a composite index for the
      // userId + date query.
      list.sort((a, b) => {
        const aMs = a.date?.toMillis ? a.date.toMillis() : 0;
        const bMs = b.date?.toMillis ? b.date.toMillis() : 0;
        return bMs - aMs;
      });

      setPayments(list);
    } catch (error) {
      console.log(error);
    } finally {
      setLoading(false);
    }
  }

  async function downloadOnlineReceipt(rd: any) {
    if (generatingReceipt || !rd) return;
    setGeneratingReceipt(true);
    try {
      const html = `
        <html><body style="font-family:Arial;padding:30px;">
          <h1 style="text-align:center;">RentWise</h1>
          <h2 style="text-align:center;">Online Payment Receipt</h2>
          <hr/>
          <p><b>Receipt No:</b> ${rd.receiptNo ?? ""}</p>
          <p><b>Tenant Name:</b> ${rd.tenantName ?? ""}</p>
          <p><b>Building Number:</b> ${rd.buildingNumber ?? ""}</p>
          <p><b>Space ID:</b> ${rd.spaceId ?? ""}</p>
          <p><b>Date:</b> ${rd.date ? new Date(rd.date).toLocaleDateString() : ""}</p>
          <p><b>Payment Method:</b> ${rd.paymentMethod ?? ""}</p>
          <p><b>Rent Amount:</b> ₱${rd.rentAmount ?? 0}</p>
          <p><b>Amount Paid:</b> ₱${rd.payment ?? 0}</p>
          ${rd.change > 0 ? `<p><b>Change:</b> ₱${rd.change}</p>` : ""}
          <p><b>Approval Status:</b> ${rd.status ?? ""}</p>
          <hr/>
          <h3 style="text-align:center;">Pending Admin Approval</h3>
        </body></html>
      `;

      const { base64 } = await Print.printToFileAsync({ html, base64: true });
      const fileName = `online-receipt-${rd.receiptNo ?? Date.now()}.pdf`;
      const cachePath = `${RNBlobUtil.fs.dirs.CacheDir}/${fileName}`;
      await RNBlobUtil.fs.writeFile(cachePath, base64!, "base64");
      await RNBlobUtil.MediaCollection.copyToMediaStore(
        { name: fileName, parentFolder: "", mimeType: "application/pdf" },
        "Download",
        cachePath,
      );
      RNBlobUtil.fs.unlink(cachePath).catch(() => {});

      Alert.alert("Downloaded", "Receipt saved to your Downloads folder.");
    } catch (err) {
      console.log("ONLINE RECEIPT ERROR", err);
      Alert.alert("Error", "Failed to generate receipt.");
    } finally {
      setGeneratingReceipt(false);
    }
  }

  function formatDate(date: any) {
    if (!date) return "-";

    const d = date.toDate ? date.toDate() : new Date(date);

    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  }

  // Month-scoped balance — mirrors rentwise-tenant/app/dashboard.tsx exactly,
  // so the admin sees the same numbers the tenant sees on their own screen.
  const dailyRate = Number(stall?.price || 0);
  const paymentSchedule = stall?.paymentSchedule ?? "monthly";
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthTotalCharge = dailyRate * daysInMonth;

  const paidThisMonth = payments.reduce((sum, p) => {
    if (p.status !== "approved") return sum;
    const d = p.date?.toDate ? p.date.toDate() : p.date ? new Date(p.date) : null;
    if (!d || d.getFullYear() !== year || d.getMonth() !== month) return sum;
    return sum + Number(p.amount || 0);
  }, 0);

  const remainingBill = monthTotalCharge - paidThisMonth;
  const chargedToDate = chargedSinceMonthStart(dailyRate, paymentSchedule, today);
  const paymentDue = chargedToDate - paidThisMonth;

  const NOTIFY_MESSAGE =
    "The Market Administrator sent you a reminder regarding your rental account. Please check your payment status or contact the market office if you have any questions.";

  const handleNotifyTenant = async () => {
    if (!tenantId) return;
    setSending(true);
    try {
      // Create in-app notification (Cloud Function trigger sends the push)
      await addDoc(collection(db, "notifications"), {
        userId: tenantId,
        message: NOTIFY_MESSAGE,
        read: false,
        createdAt: serverTimestamp(),
      });

      Alert.alert("Success", "Notification sent successfully.");
    } catch (err) {
      console.error("[PUSH FAILED]", err);
      Alert.alert("Error", "Failed to send notification. Please try again.");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0C2D6B" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* HEADER */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color="#E6F1FB" />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Tenant Preview</Text>

        <Pressable
          style={({ pressed }) => [
            styles.notifyBtn,
            sending && styles.notifyBtnDisabled,
            pressed && !sending && styles.notifyBtnPressed,
          ]}
          onPress={handleNotifyTenant}
          disabled={sending}
        >
          <Text style={styles.notifyBtnText}>
            {sending ? "Sending..." : "Notify tenant"}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.body,
          { paddingBottom: insets.bottom + 32 },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* PROFILE BANNER */}
        <View style={styles.banner}>
          <View>
            <Text style={styles.bannerWelcome}>Welcome, tenant!</Text>
            <Text style={styles.bannerName}>
              {tenant?.firstName} {tenant?.lastName}
            </Text>
            <Text style={styles.bannerContact}>
              {tenant?.contactNo ? `+63 ${tenant.contactNo}` : ""}
            </Text>
          </View>
        </View>

        {/* CARD 1 — RENTAL PAYMENT INFORMATION */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Rental Payment Information</Text>

          <InfoRow
            label="Payment"
            value={`${paymentDue < 0 ? "-" : ""}₱${Math.abs(paymentDue).toLocaleString()}`}
          />
          <InfoRow
            label="Payment Schedule"
            value={
              paymentSchedule
                ? paymentSchedule.charAt(0).toUpperCase() + paymentSchedule.slice(1)
                : "—"
            }
          />
          <InfoRow
            label="Remaining Bill"
            value={`₱${remainingBill.toLocaleString()}`}
            isLast
            danger
          />
        </View>

        {/* CARD 2 — MONTHLY PAYMENT HISTORY */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Monthly Payment History</Text>

          {/* Table header */}
          <View style={styles.tableHeader}>
            <Text style={[styles.colHeader, { flex: 2 }]}>Date</Text>
            <Text style={[styles.colHeader, { flex: 2 }]}>Status</Text>
            <Text style={[styles.colHeader, { flex: 1, textAlign: "right" }]}>Receipt</Text>
          </View>

          {payments.length === 0 ? (
            <Text style={styles.empty}>No payments yet.</Text>
          ) : (
            payments.map((item, index) => (
              <View
                key={item.id}
                style={[
                  styles.paymentRow,
                  index === payments.length - 1 && { borderBottomWidth: 0 },
                ]}
              >
                {/* Date */}
                <Text style={[styles.paymentDate, { flex: 2 }]}>
                  {formatDate(item.date)}
                </Text>

                {/* Status badge */}
                <View style={{ flex: 2 }}>
                  <View
                    style={[
                      styles.statusBadge,
                      item.status === "approved"
                        ? styles.badgeApproved
                        : item.status === "pending"
                          ? styles.badgePending
                          : styles.badgeRejected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusText,
                        item.status === "approved"
                          ? styles.textApproved
                          : item.status === "pending"
                            ? styles.textPending
                            : styles.textRejected,
                      ]}
                    >
                      {item.status?.toUpperCase()}
                    </Text>
                  </View>
                </View>

                {/* Receipt */}
                <View style={{ flex: 1, alignItems: "flex-end" }}>
                  {item.receipt ? (
                    <TouchableOpacity
                      onPress={() => setImageViewerUrl(item.receipt)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="receipt-outline" size={20} color="#1D9E75" />
                    </TouchableOpacity>
                  ) : item.receiptData ? (
                    <TouchableOpacity
                      onPress={() => setDigitalReceipt(item.receiptData)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="receipt-outline" size={20} color="#1D9E75" />
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.paymentDate}>—</Text>
                  )}
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* CASH RECEIPT IMAGE VIEWER */}
      <Modal visible={!!imageViewerUrl} transparent animationType="fade">
        <Pressable
          style={styles.imageViewerBg}
          onPress={() => setImageViewerUrl(null)}
        >
          {imageViewerUrl && (
            <Image
              source={{ uri: imageViewerUrl }}
              style={styles.imageViewerImage}
              resizeMode="contain"
            />
          )}
        </Pressable>
      </Modal>

      {/* ONLINE PAYMENT DIGITAL RECEIPT */}
      <Modal visible={!!digitalReceipt} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Tenant's Digital Receipt</Text>

            <Text style={styles.modalRow}>Receipt No: {digitalReceipt?.receiptNo ?? ""}</Text>
            <Text style={styles.modalRow}>Tenant Name: {digitalReceipt?.tenantName ?? ""}</Text>
            <Text style={styles.modalRow}>Building Number: {digitalReceipt?.buildingNumber ?? ""}</Text>
            <Text style={styles.modalRow}>Space ID: {digitalReceipt?.spaceId ?? ""}</Text>
            <Text style={styles.modalRow}>
              Date: {digitalReceipt?.date ? new Date(digitalReceipt.date).toLocaleDateString() : ""}
            </Text>
            <Text style={styles.modalRow}>Payment Method: {digitalReceipt?.paymentMethod ?? ""}</Text>
            <Text style={styles.modalRow}>Rent Amount: ₱{digitalReceipt?.rentAmount ?? 0}</Text>
            <Text style={styles.modalRow}>Amount Paid: ₱{digitalReceipt?.payment ?? 0}</Text>
            {digitalReceipt?.change > 0 && (
              <Text style={styles.modalRow}>Change: ₱{digitalReceipt.change}</Text>
            )}
            <Text style={styles.modalRow}>Approval Status: {digitalReceipt?.status ?? ""}</Text>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalBtnSecondary}
                onPress={() => setDigitalReceipt(null)}
              >
                <Text style={styles.modalBtnSecondaryText}>Close</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalBtnPrimary}
                onPress={() => downloadOnlineReceipt(digitalReceipt)}
                disabled={generatingReceipt}
              >
                {generatingReceipt ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalBtnPrimaryText}>Download Receipt</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function InfoRow({
  label,
  value,
  isLast = false,
  danger = false,
}: {
  label: string;
  value: string;
  isLast?: boolean;
  danger?: boolean;
}) {
  return (
    <View style={[styles.infoRow, !isLast && styles.infoRowBorder]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, danger && styles.infoValueDanger]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F0F4FA",
  },

  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  // ── Header ────────────────────────────────────────────────────────────────────

  header: {
    backgroundColor: "#0C2D6B",
    paddingHorizontal: 20,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "500",
    flex: 1,
    textAlign: "center",
  },

  notifyBtn: {
    backgroundColor: "#EF9F27",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    transform: [{ scale: 1 }],
  },

  notifyBtnPressed: {
    backgroundColor: "#BA7517",
    transform: [{ scale: 0.97 }],
  },

  notifyBtnDisabled: {
    opacity: 0.5,
  },

  notifyBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "500",
  },

  // ── Body ─────────────────────────────────────────────────────────────────────

  body: {
    paddingHorizontal: 16,
    paddingTop: 20,
    gap: 16,
  },

  // ── Profile banner ────────────────────────────────────────────────────────────

  banner: {
    backgroundColor: "#1A4DA0",
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },

  bannerWelcome: {
    color: "#B5D4F4",
    fontSize: 12,
  },

  bannerName: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "500",
    marginTop: 2,
  },

  bannerContact: {
    color: "#B5D4F4",
    fontSize: 13,
    marginTop: 2,
  },

  // ── Card ─────────────────────────────────────────────────────────────────────

  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 18,
    borderWidth: 0.5,
    borderColor: "#B5D4F4",
  },

  cardTitle: {
    fontSize: 15,
    fontWeight: "500",
    color: "#085041",
    marginBottom: 14,
  },

  // ── Info rows (Card 1) ────────────────────────────────────────────────────────

  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },

  infoRowBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: "#E6F1FB",
  },

  infoLabel: {
    fontSize: 14,
    color: "#888780",
  },

  infoValue: {
    fontSize: 14,
    fontWeight: "500",
    color: "#0C2D6B",
  },

  infoValueDanger: {
    color: "#E24B4A",
  },

  // ── Payment history table (Card 2) ────────────────────────────────────────────

  tableHeader: {
    backgroundColor: "#F0F4FA",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    marginBottom: 4,
  },

  colHeader: {
    fontSize: 12,
    fontWeight: "500",
    color: "#5F5E5A",
  },

  paymentRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: "#E6F1FB",
  },

  paymentDate: {
    fontSize: 14,
    color: "#444441",
  },

  // Status badges

  statusBadge: {
    alignSelf: "flex-start",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },

  badgeApproved: { backgroundColor: "#E1F5EE" },
  badgePending: { backgroundColor: "#FAEEDA" },
  badgeRejected: { backgroundColor: "#FCEBEB" },

  statusText: {
    fontSize: 11,
    fontWeight: "500",
  },

  textApproved: { color: "#0F6E56" },
  textPending: { color: "#BA7517" },
  textRejected: { color: "#A32D2D" },

  // Empty state

  empty: {
    paddingVertical: 24,
    textAlign: "center",
    fontSize: 14,
    color: "#B4B2A9",
  },

  // ── Receipt viewers ──────────────────────────────────────────────────────────

  imageViewerBg: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    alignItems: "center",
  },

  imageViewerImage: {
    width: "100%",
    height: "80%",
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
    color: "#0C2D6B",
  },

  modalRow: {
    fontSize: 14,
    color: "#444441",
    marginBottom: 6,
  },

  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 16,
    gap: 10,
  },

  modalBtnSecondary: {
    borderWidth: 1,
    borderColor: "#B5D4F4",
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 18,
  },

  modalBtnSecondaryText: { fontSize: 14, color: "#0C2D6B" },

  modalBtnPrimary: {
    backgroundColor: "#0C2D6B",
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 18,
    minWidth: 130,
    alignItems: "center",
  },

  modalBtnPrimaryText: { fontSize: 14, fontWeight: "600", color: "#FFFFFF" },
});
