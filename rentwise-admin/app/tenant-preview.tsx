import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  FlatList,
  Image,
  Linking,
  Alert,
} from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";

import { useEffect, useState } from "react";
import { useLocalSearchParams, router } from "expo-router";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";

import { db } from "../shared/services/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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

export default function TenantPreview() {
  const insets = useSafeAreaInsets();

  const { tenantId } = useLocalSearchParams<{
    tenantId: string;
  }>();

  const [tenant, setTenant] = useState<any>(null);
  const [stall, setStall] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTenant();
  }, []);

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

      console.log("TENANT PAYMENTS", list);
      setPayments(list);
    } catch (error) {
      console.log(error);
    } finally {
      setLoading(false);
    }
  }

  async function viewOnlineReceipt(payment: any) {
    try {
      const rd = payment.receiptData;
      if (!rd) return;

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
          <p><b>Approval Status:</b> ${rd.status ?? ""}</p>
          <hr/>
          <h3 style="text-align:center;">Pending Admin Approval</h3>
        </body></html>
      `;

      const { base64 } = await Print.printToFileAsync({ html, base64: true });
      const destFile = new File(Paths.cache, `online-receipt-${rd.receiptNo ?? Date.now()}.pdf`);
      destFile.write(base64!, { encoding: "base64" });

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(destFile.uri, {
          mimeType: "application/pdf",
          dialogTitle: "View Receipt",
          UTI: "com.adobe.pdf",
        });
      } else {
        Alert.alert("Not Available", "Sharing is not supported on this device.");
      }
    } catch (err) {
      console.log("ONLINE RECEIPT ERROR", err);
      Alert.alert("Error", "Failed to generate receipt.");
    }
  }

  function formatDate(date: any) {
    if (!date) return "-";

    const d = date.toDate ? date.toDate() : new Date(date);

    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  }

  const approved = payments.filter((p) => p.status === "approved");

  const pending = payments.filter((p) => p.status === "pending");

  const totalPayment = approved.reduce(
    (sum, p) => sum + Number(p.amount || 0),
    0,
  );

  const pendingPayment = pending.reduce(
    (sum, p) => sum + Number(p.amount || 0),
    0,
  );

  const monthlyRent = Number(stall?.price || 0);

  const remaining = monthlyRent - totalPayment;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* HEADER */}

      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 15,
          },
        ]}
      >
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>

        <Text style={styles.title}>RentWise Preview</Text>

        <View style={{ width: 30 }} />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingBottom: 30,
        }}
      >
        {/* TENANT BANNER */}

        <View style={styles.banner}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>👤</Text>
          </View>

          <View>
            <Text style={styles.welcome}>Welcome, tenant!</Text>

            <Text style={styles.name}>
              {tenant?.firstName} {tenant?.lastName}
            </Text>

            <Text style={styles.contact}>{tenant?.contactNo}</Text>
          </View>
        </View>

        {/* PAYMENT INFORMATION */}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Rental Payment Information</Text>

          <Row label="Payment" value={`₱${totalPayment.toLocaleString()}`} />

          <Row label="Pending" value={`₱${pendingPayment.toLocaleString()}`} />

          <Row
            label="Remaining Bill"
            value={`₱${remaining.toLocaleString()}`}
          />
        </View>

        {/* PAYMENT HISTORY */}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Monthly Payment History</Text>

          <View style={styles.tableHeader}>
            <Text style={styles.cell}>Date</Text>

            <Text style={styles.cell}>Status</Text>

            <Text style={styles.cell}>Receipt</Text>
          </View>

          {payments.length === 0 ? (
            <Text style={styles.empty}>No payments yet</Text>
          ) : (
            <FlatList
              scrollEnabled={false}
              data={payments}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={styles.row}>
                  <Text style={styles.cell}>{formatDate(item.date)}</Text>

                  <Text
                    style={[
                      styles.cell,

                      item.status === "approved"
                        ? styles.green
                        : item.status === "pending"
                          ? styles.orange
                          : styles.red,
                    ]}
                  >
                    {item.status?.toUpperCase()}
                  </Text>

                  {item.receipt ? (
                    <TouchableOpacity
                      style={styles.cell}
                      onPress={() => Linking.openURL(item.receipt)}
                    >
                      <Image
                        source={{ uri: item.receipt }}
                        style={styles.receiptThumb}
                        resizeMode="cover"
                      />
                    </TouchableOpacity>
                  ) : item.receiptData ? (
                    <TouchableOpacity
                      style={styles.cell}
                      onPress={() => viewOnlineReceipt(item)}
                    >
                      <Text style={styles.receiptIcon}>📄</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.cell}>—</Text>
                  )}
                </View>
              )}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text>{label}</Text>

      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#E8E8E8",
  },

  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  header: {
    backgroundColor: "#1A1A1A",
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  back: {
    color: "#fff",
    fontSize: 24,
  },

  title: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },

  banner: {
    backgroundColor: "#B5A89A",
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
  },

  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#ccc",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 15,
  },

  avatarText: {
    fontSize: 30,
  },

  welcome: {
    color: "#fff",
  },

  name: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "bold",
  },

  contact: {
    color: "#fff",
  },

  card: {
    backgroundColor: "#fff",
    margin: 16,
    padding: 16,
    borderRadius: 10,
  },

  cardTitle: {
    fontWeight: "bold",
    fontSize: 15,
    marginBottom: 15,
  },

  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
  },

  value: {
    fontWeight: "bold",
  },

  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f2f2f2",
    padding: 10,
  },

  row: {
    flexDirection: "row",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: "#eee",
  },

  cell: {
    flex: 1,
    fontSize: 13,
  },

  green: {
    color: "#27AE60",
  },

  orange: {
    color: "#E67E22",
  },

  red: {
    color: "#C0392B",
  },

  empty: {
    textAlign: "center",
    padding: 20,
    color: "#777",
  },

  receiptThumb: {
    width: 48,
    height: 48,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#ddd",
  },

  receiptIcon: {
    fontSize: 24,
  },
});
