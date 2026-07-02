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

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import { Colors } from "../shared/constants/color";

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
  status: "Approved" | "Rejected",
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
      await markLinkedNotifications(update.id, "Approved");
      if (update.changedBy) {
        const label =
          update.type ?? update.module ?? categoryLabel(update.category ?? "archive");
        await addDoc(collection(db, "notifications"), {
          userId: update.changedBy,
          message: `Your "${label}" update was approved by the owner.`,
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
      Alert.alert("Approved", "Update has been approved.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "Failed to approve. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const doRejectOne = async () => {
    if (!update || !auth.currentUser) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "updates", update.id), {
        approvalStatus: "rejected",
      });
      await markLinkedNotifications(update.id, "Rejected");
      if (update.changedBy) {
        const label =
          update.type ?? update.module ?? categoryLabel(update.category ?? "archive");
        await addDoc(collection(db, "notifications"), {
          userId: update.changedBy,
          message: `Your "${label}" update was rejected by the owner.`,
          read: false,
          createdAt: serverTimestamp(),
        });
      }
      Alert.alert("Rejected", "Update has been rejected.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "Failed to reject. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const rejectOne = () => {
    Alert.alert(
      "Reject Update",
      "Are you sure you want to reject this update?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Reject", style: "destructive", onPress: doRejectOne },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator color={Colors.primary} size="large" />
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
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Text style={styles.backArrow}>◄</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>RentWise</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32 },
        ]}
      >
        <Text style={styles.pageTitle}>Update Report</Text>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardHeader}>{updateTitle}</Text>
            {update.approvalStatus === "approved" && (
              <View style={[styles.statusChip, styles.chipApproved]}>
                <Text style={styles.chipText}>Approved</Text>
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
                <Text style={styles.actionBtnText}>Approve</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.actionBtn,
                styles.rejectBtn,
                saving && styles.btnDisabled,
              ]}
              onPress={rejectOne}
              disabled={saving}
              activeOpacity={0.8}
            >
              <Text style={styles.rejectBtnText}>Reject</Text>
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
  screen: { flex: 1, backgroundColor: Colors.background },
  fullCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.background,
  },
  header: {
    backgroundColor: "#1A1A1A",
    paddingBottom: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: { width: 36 },
  backArrow: { fontSize: 18, color: "#FFFFFF", fontWeight: "bold" },
  headerTitle: { fontSize: 20, fontWeight: "700", color: "#FFFFFF" },

  content: { padding: 16 },
  pageTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginBottom: 16,
  },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 3,
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
    fontWeight: "700",
    color: Colors.primary,
    flex: 1,
  },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  chipApproved: { backgroundColor: "#D4EDDA" },
  chipRejected: { backgroundColor: "#F8D7DA" },
  chipText: { fontSize: 11, fontWeight: "700", color: "#1A1A1A" },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 11,
  },
  rowLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: "500",
    flex: 1,
  },
  rowValue: {
    fontSize: 13,
    color: Colors.textPrimary,
    fontWeight: "600",
    flex: 2,
    textAlign: "right",
  },
  divider: { height: 1, backgroundColor: Colors.border },

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
  approveBtn: { backgroundColor: Colors.success },
  rejectBtn: {
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.error,
  },
  actionBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  rejectBtnText: { color: Colors.error, fontSize: 15, fontWeight: "700" },

  backBtnBottom: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  backBtnBottomText: {
    color: Colors.textSecondary,
    fontSize: 15,
    fontWeight: "700",
  },

  btnDisabled: { opacity: 0.5 },
  errorText: { fontSize: 16, color: Colors.textSecondary, marginBottom: 12 },
  backLink: { fontSize: 14, color: Colors.primary, fontWeight: "600" },
});
