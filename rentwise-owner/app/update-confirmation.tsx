import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  Alert,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";

type UpdateDoc = {
  id: string;
  // Legacy schema
  category?: "building" | "finance" | "archive";
  status?: string;
  change?: string;
  // New schema
  module?: string;
  type?: string;
  fieldChanged?: string;
  targetId?: string;
  tenantId?: string;
  paymentMethod?: string;
  paymentAmount?: number;
  oldValue?: string;
  newValue?: string;
  // Common
  spaceNo?: string;
  buildingNo?: string;
  tenantName?: string;
  adminId?: string;
  adminName?: string;
  changedBy?: string;
  approvalStatus?: string;
  createdAt?: any;
};

function categoryLabel(cat: string): string {
  if (cat === "building") return "Building Management Update";
  if (cat === "finance") return "Finance Update";
  return "Account Archive Update";
}

function formatDate(ts: any): string {
  if (!ts) return "—";
  const d: Date = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

async function markLinkedNotifications(
  updateId: string,
  status: "Acknowledged" | "Rejected",
) {
  const snap = await getDocs(
    query(collection(db, "notifications"), where("updateId", "==", updateId)),
  );
  const batch = writeBatch(db);
  snap.docs.forEach((d) =>
    batch.update(doc(db, "notifications", d.id), { status }),
  );
  await batch.commit();
}

export default function UpdateConfirmation() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [update, setUpdate] = useState<UpdateDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchUpdate(id);
  }, [id]);

  const fetchUpdate = async (docId: string) => {
    try {
      const snap = await getDoc(doc(db, "updates", docId));
      if (snap.exists()) setUpdate({ id: snap.id, ...snap.data() } as UpdateDoc);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const approveOne = async () => {
    if (!update || !auth.currentUser) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "updates", update.id), {
        approvalStatus: "approved",
      });
      await markLinkedNotifications(update.id, "Acknowledged");
      if (update.changedBy) {
        const label =
          update.type ?? update.module ?? categoryLabel(update.category ?? "archive");
        await addDoc(collection(db, "notifications"), {
          userId: update.changedBy,
          message: `Your "${label}" update was acknowledged by the owner.`,
          read: false,
          createdAt: serverTimestamp(),
        });
      }
      await addDoc(collection(db, "dailyReports"), {
        type: update.module
          ? (update.type ?? update.module ?? "Update")
          : categoryLabel(update.category ?? "archive"),
        updateId: update.id,
        spaceNo: update.spaceNo ?? null,
        tenantName: update.tenantName ?? null,
        approvedBy: "Owner",
        date: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      Alert.alert("Acknowledged", "Update has been acknowledged.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "Failed to approve. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator color="#0C2D6B" size="large" />
      </View>
    );
  }

  if (!update) {
    return (
      <View style={styles.fullCenter}>
        <Text style={styles.errorText}>Update not found.</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backLink}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isAlreadyDecided =
    update.approvalStatus === "approved" ||
    update.approvalStatus === "rejected";

  const isNewSchema = !!update.module;
  const updateTitle = isNewSchema
    ? (update.type ?? update.module ?? "Update")
    : categoryLabel(update.category ?? "archive");

  // Build detail rows
  const details: { label: string; value: string }[] = [];
  details.push({ label: "Update Type", value: updateTitle });

  if (isNewSchema) {
    if (update.tenantName) details.push({ label: "Tenant", value: update.tenantName });
    if (update.spaceNo) details.push({ label: "Space", value: update.spaceNo });
    if (update.buildingNo) details.push({ label: "Building", value: update.buildingNo });
    if (update.fieldChanged) details.push({ label: "Field Changed", value: update.fieldChanged });
    if (update.paymentMethod) {
      details.push({
        label: "Payment Method",
        value: update.paymentMethod.charAt(0).toUpperCase() + update.paymentMethod.slice(1),
      });
    }
    if (update.paymentAmount != null) {
      details.push({ label: "Amount", value: `₱${Number(update.paymentAmount).toLocaleString()}` });
    }
    if (update.oldValue) details.push({ label: "Previous Value", value: update.oldValue });
    if (update.newValue) details.push({ label: "New Value", value: update.newValue });
  } else if (update.category === "building") {
    if (update.spaceNo) details.push({ label: "Space", value: update.spaceNo });
    if (update.buildingNo) details.push({ label: "Building", value: update.buildingNo });
    details.push({ label: "Change", value: update.change ?? "—" });
    details.push({ label: "Result", value: update.status ?? "—" });
  } else if (update.category === "finance") {
    if (update.tenantName) details.push({ label: "Tenant", value: update.tenantName });
    if (update.spaceNo) details.push({ label: "Space", value: update.spaceNo });
    details.push({ label: "Change", value: update.change ?? "—" });
    details.push({ label: "Status", value: update.status ?? "—" });
  } else {
    if (update.tenantName) details.push({ label: "Tenant", value: update.tenantName });
    details.push({ label: "Change", value: update.change ?? "—" });
    details.push({ label: "Status", value: update.status ?? "—" });
  }

  details.push({ label: "Changed By", value: update.adminName ?? "Admin" });
  details.push({ label: "Date", value: formatDate(update.createdAt) });

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={22} color="#E6F1FB" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>RentWise</Text>
        <View style={styles.backBtn} />
      </View>

      {/* Sub-header */}
      <View style={styles.subHeader}>
        <Text style={styles.subHeaderText}>Update Report</Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32 },
        ]}
      >
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardHeader}>{updateTitle}</Text>
            {update.approvalStatus === "approved" && (
              <View style={[styles.statusChip, styles.chipApproved]}>
                <Text style={styles.chipText}>Acknowledged</Text>
              </View>
            )}
            {update.approvalStatus === "rejected" && (
              <View style={[styles.statusChip, styles.chipRejected]}>
                <Text style={styles.chipText}>Rejected</Text>
              </View>
            )}
          </View>

          {details.map((row, i) => (
            <View key={row.label}>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>{row.label}</Text>
                <Text style={styles.rowValue}>{row.value}</Text>
              </View>
              {i < details.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>

        {!isAlreadyDecided && (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[
                styles.actionBtn,
                styles.approveBtn,
                saving && styles.btnDisabled,
              ]}
              onPress={approveOne}
              disabled={saving}
              activeOpacity={0.8}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.actionBtnText}>Acknowledge</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {isAlreadyDecided && (
          <TouchableOpacity
            style={styles.backBtnBottom}
            onPress={() => router.back()}
            activeOpacity={0.8}
          >
            <Text style={styles.backBtnBottomText}>Go Back</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
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
  header: {
    backgroundColor: "#0C2D6B",
    paddingHorizontal: 20,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  backBtn: { width: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: "#fff",
    fontSize: 18,
    fontWeight: "500",
  },

  subHeader: {
    backgroundColor: "#1A4DA0",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  subHeaderText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "500",
    textAlign: "center",
  },

  content: { padding: 16, paddingTop: 20 },

  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    borderWidth: 0.5,
    borderColor: "#B5D4F4",
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    gap: 8,
  },
  cardHeader: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0C2D6B",
    flex: 1,
  },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  chipApproved: { backgroundColor: "#E1F5EE" },
  chipRejected: { backgroundColor: "#FCEBEB" },
  chipText: { fontSize: 11, fontWeight: "700", color: "#0C2D6B" },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 11,
  },
  rowLabel: {
    fontSize: 13,
    color: "#888780",
    fontWeight: "500",
    flex: 1,
  },
  rowValue: {
    fontSize: 13,
    color: "#0C2D6B",
    fontWeight: "600",
    flex: 2,
    textAlign: "right",
  },
  divider: { height: 1, backgroundColor: "#E6F1FB" },

  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  approveBtn: { backgroundColor: "#0C2D6B" },
  actionBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },

  backBtnBottom: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#B5D4F4",
  },
  backBtnBottomText: {
    color: "#0C2D6B",
    fontSize: 15,
    fontWeight: "600",
  },

  btnDisabled: { opacity: 0.5 },
  errorText: { fontSize: 16, color: "#888780", marginBottom: 12 },
  backLink: { fontSize: 14, color: "#2E6FD9", fontWeight: "600" },
});
