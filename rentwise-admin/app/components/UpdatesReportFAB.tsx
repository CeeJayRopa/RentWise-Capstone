import { useState } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  UIManager,
  Alert,
  StyleSheet,
} from "react-native";
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FileEdit } from "lucide-react-native";

import { db } from "../../shared/services/firestore";
import { Colors } from "../../shared/constants/color";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function notifLocation(u: any): string {
  const module: string = u.module ?? "";
  const category: string = u.category ?? "";

  if (module === "Building Management" || category === "building") {
    return `Building ${u.buildingNo ?? u.spaceNo ?? ""} Stall Information`;
  }
  if (module === "Financials" || category === "finance") {
    return `${u.tenantName ?? "a tenant"}'s Payment`;
  }
  if (module === "Register Tenant") {
    return `Tenant Registration (${u.tenantName ?? ""})`;
  }
  if (module === "Manage Account") {
    return `${u.tenantName ?? "a tenant"}'s Account`;
  }
  if (module === "Account Archive") {
    return `${u.tenantName ?? "a tenant"}'s Account Restoration`;
  }
  return "Rental Information";
}

export default function UpdatesReportFAB() {
  const insets = useSafeAreaInsets();

  const [visible, setVisible] = useState(false);
  const [updates, setUpdates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [buildingOpen, setBuildingOpen] = useState(true);
  const [financeOpen, setFinanceOpen] = useState(true);
  const [archiveOpen, setArchiveOpen] = useState(true);

  const openModal = async () => {
    setVisible(true);
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, "updates"));
      const docs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        // hide updates already submitted to the owner
        .filter((d: any) => !d.notifiedAt)
        .sort((a: any, b: any) => {
          const aTs = a.createdAt?.seconds ?? 0;
          const bTs = b.createdAt?.seconds ?? 0;
          return bTs - aTs;
        });
      setUpdates(docs);
    } catch (err) {
      console.error("UpdatesReport fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  const closeModal = () => setVisible(false);

  const toggle = (setter: React.Dispatch<React.SetStateAction<boolean>>) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setter((v) => !v);
  };

  const applyChanges = async () => {
    const pendingUpdates = updates.filter(
      (u: any) => u.approvalStatus !== "approved",
    );

    if (pendingUpdates.length === 0) {
      Alert.alert(
        "No Pending Updates",
        "All changes have already been approved.",
      );
      return;
    }

    setApplying(true);
    try {
      const ownersSnap = await getDocs(
        query(collection(db, "users"), where("role", "==", "owner")),
      );

      if (ownersSnap.empty) {
        Alert.alert("No Owner Found", "No owner account found to notify.");
        setApplying(false);
        return;
      }

      // Deterministic notification IDs prevent duplicates if Apply Changes
      // is clicked more than once. Also stamp notifiedAt on each update so
      // the FAB hides them on the next open.
      const batch = writeBatch(db);
      for (const u of pendingUpdates) {
        const location = notifLocation(u);
        for (const ownerDoc of ownersSnap.docs) {
          const notifId = `notif_${u.id}_${ownerDoc.id}`;
          batch.set(
            doc(db, "notifications", notifId),
            {
              userId: ownerDoc.id,
              message: `Admin made some changes in ${location}.`,
              status: "To be Approved",
              read: false,
              updateId: u.id,
              createdAt: serverTimestamp(),
            },
            { merge: true },
          );
        }
        // Mark update as submitted so it no longer appears in the FAB
        batch.update(doc(db, "updates", u.id), {
          notifiedAt: serverTimestamp(),
        });
      }
      await batch.commit();

      // Clear local state immediately so the modal goes blank right away
      setUpdates([]);

      Alert.alert(
        "Changes Submitted",
        `${pendingUpdates.length} update(s) submitted to the Owner for approval.`,
        [{ text: "OK", onPress: closeModal }],
      );
    } catch (err) {
      console.error("applyChanges error:", err);
      Alert.alert("Error", "Failed to submit changes. Please try again.");
    } finally {
      setApplying(false);
    }
  };

  const buildingUpdates = updates.filter(
    (u) => u.category === "building" || u.module === "Building Management",
  );
  const financeUpdates = updates.filter(
    (u) => u.category === "finance" || u.module === "Financials",
  );
  const accountUpdates = updates.filter(
    (u) =>
      u.category === "archive" ||
      u.module === "Manage Account" ||
      u.module === "Register Tenant" ||
      u.module === "Account Archive",
  );

  return (
    <>
      {/* Yellow FAB */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 20 }]}
        onPress={openModal}
        activeOpacity={0.85}
      >
        <FileEdit size={24} color="#1A1A1A" />
      </TouchableOpacity>

      {/* Updates Report Modal */}
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
      >
        <View style={styles.overlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={closeModal}
          />

          <View style={styles.card}>
            <Text style={styles.title}>Updates Report</Text>

            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={Colors.primary} size="large" />
              </View>
            ) : updates.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyBoxText}>No updates yet.</Text>
              </View>
            ) : (
              <ScrollView
                style={styles.scrollArea}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
              >
                <AccordionSection
                  title="Building Management"
                  open={buildingOpen}
                  onToggle={() => toggle(setBuildingOpen)}
                  columns={["Space No.", "Field Changed", "Change"]}
                  rows={buildingUpdates.map((u) => [
                    u.spaceNo ?? "—",
                    u.module ? (u.fieldChanged ?? u.type ?? "—") : (u.status ?? "—"),
                    u.module
                      ? (u.oldValue && u.newValue ? `${u.oldValue} → ${u.newValue}` : "—")
                      : (u.change ?? "—"),
                  ])}
                />

                <AccordionSection
                  title="Finances"
                  open={financeOpen}
                  onToggle={() => toggle(setFinanceOpen)}
                  columns={["Tenant Name", "Method", "Amount"]}
                  rows={financeUpdates.map((u) => [
                    u.tenantName ?? "—",
                    u.module ? (u.paymentMethod ?? "cash") : (u.status ?? "—"),
                    u.module
                      ? (u.paymentAmount != null ? `₱${Number(u.paymentAmount).toLocaleString()}` : "—")
                      : (u.spaceNo ?? "—"),
                  ])}
                />

                <AccordionSection
                  title="Account Archives"
                  open={archiveOpen}
                  onToggle={() => toggle(setArchiveOpen)}
                  columns={["Tenant Name", "Type", "Change"]}
                  rows={accountUpdates.map((u) => [
                    u.tenantName ?? "—",
                    u.module ? (u.type ?? "—") : (u.status ?? "—"),
                    u.module
                      ? (u.oldValue && u.newValue ? `${u.oldValue} → ${u.newValue}` : "—")
                      : (u.change ?? "—"),
                  ])}
                />
              </ScrollView>
            )}

            <View style={styles.btnRow}>
              <TouchableOpacity
                style={[styles.btn, styles.btnOutline]}
                onPress={closeModal}
                activeOpacity={0.8}
                disabled={applying}
              >
                <Text style={styles.btnOutlineText}>Close</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.btn,
                  styles.btnPrimary,
                  applying && styles.btnDisabled,
                ]}
                onPress={applyChanges}
                activeOpacity={0.8}
                disabled={applying}
              >
                {applying ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.btnPrimaryText}>Apply Changes</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ── Accordion Section ─────────────────────────────────────────────────────────

type AccordionSectionProps = {
  title: string;
  open: boolean;
  onToggle: () => void;
  columns: [string, string, string];
  rows: [string, string, string][];
};

function AccordionSection({
  title,
  open,
  onToggle,
  columns,
  rows,
}: AccordionSectionProps) {
  return (
    <View style={sectionStyles.container}>
      <TouchableOpacity
        style={sectionStyles.header}
        onPress={onToggle}
        activeOpacity={0.7}
      >
        <Text style={sectionStyles.headerText}>{title}</Text>
        <Text style={sectionStyles.arrow}>{open ? "▲" : "▼"}</Text>
      </TouchableOpacity>

      {open && (
        <View style={sectionStyles.body}>
          <View style={[sectionStyles.tableRow, sectionStyles.colHeaderRow]}>
            {columns.map((col) => (
              <Text
                key={col}
                style={[sectionStyles.cell, sectionStyles.colHeaderCell]}
              >
                {col}
              </Text>
            ))}
          </View>

          {rows.length === 0 ? (
            <Text style={sectionStyles.emptyText}>No records yet.</Text>
          ) : (
            rows.map((row, i) => (
              <View
                key={i}
                style={[
                  sectionStyles.tableRow,
                  i < rows.length - 1 && sectionStyles.rowBorder,
                ]}
              >
                {row.map((cell, j) => (
                  <Text key={j} style={sectionStyles.cell} numberOfLines={2}>
                    {cell}
                  </Text>
                ))}
              </View>
            ))
          )}
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#F4C430",
    justifyContent: "center",
    alignItems: "center",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    zIndex: 50,
  },

  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    width: "100%",
    maxHeight: "90%",
  },

  title: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.textPrimary,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },

  loadingBox: { paddingVertical: 48, alignItems: "center" },
  emptyBox: { paddingVertical: 48, alignItems: "center" },
  emptyBoxText: { fontSize: 14, color: Colors.textMuted },

  scrollArea: { flexGrow: 0, maxHeight: 420 },
  scrollContent: { padding: 14, gap: 10 },

  btnRow: {
    flexDirection: "row",
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  btn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 42,
  },
  btnOutline: { borderWidth: 1.5, borderColor: Colors.border },
  btnOutlineText: { fontSize: 14, fontWeight: "600", color: Colors.textSecondary },
  btnPrimary: { backgroundColor: Colors.primary },
  btnPrimaryText: { fontSize: 14, fontWeight: "600", color: "#FFFFFF" },
  btnDisabled: { opacity: 0.5 },
});

const sectionStyles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    overflow: "hidden",
    marginBottom: 2,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: Colors.inputBackground,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  headerText: { fontSize: 14, fontWeight: "700", color: Colors.textPrimary },
  arrow: { fontSize: 11, color: Colors.textSecondary },
  body: { backgroundColor: "#FFFFFF" },
  tableRow: { flexDirection: "row", paddingHorizontal: 12, paddingVertical: 9 },
  colHeaderRow: {
    backgroundColor: "#F5F9FD",
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  colHeaderCell: {
    fontWeight: "700",
    color: Colors.textSecondary,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  cell: { flex: 1, fontSize: 12, color: Colors.textPrimary, paddingRight: 4 },
  emptyText: { padding: 14, fontSize: 13, color: Colors.textMuted, textAlign: "center" },
});
