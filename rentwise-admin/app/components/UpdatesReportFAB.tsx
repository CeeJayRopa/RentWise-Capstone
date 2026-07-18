import { useState } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  LayoutAnimation,
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
import { Pencil, ChevronUp, ChevronDown } from "lucide-react-native";

import { db } from "../../shared/services/firestore";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";

const FAB_SIZE = 56;
const FAB_MARGIN = 20;

// Reserve this much bottom padding (on top of insets.bottom) in any
// scrollable content sharing a screen with this FAB, so its fixed
// bottom-right position never overlaps the last item.
export const FAB_CLEARANCE = FAB_SIZE + FAB_MARGIN + spacing.sm; // 56 + 20 + 8 = 84

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

type UpdatesReportFABProps = {
  disabled?: boolean;
  color?: string;
  icon?: React.ReactNode;
  // Extra clearance above the safe-area bottom inset, for screens that dock
  // a BottomNav bar — keeps the fixed FAB from resting under it.
  bottomOffset?: number;
  // Lets a HelpTour target the FAB directly.
  fabRef?: React.RefObject<View | null>;
};

export default function UpdatesReportFAB({
  disabled = false,
  color = colors.emerald,
  icon,
  bottomOffset = 0,
  fabRef,
}: UpdatesReportFABProps) {
  const insets = useSafeAreaInsets();

  const [visible, setVisible] = useState(false);
  const [updates, setUpdates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [buildingOpen, setBuildingOpen] = useState(true);
  const [financeOpen, setFinanceOpen] = useState(true);
  const [archiveOpen, setArchiveOpen] = useState(true);

  // Fixed in the bottom-right corner (previously draggable — now static per
  // design decision, so pages can reserve a predictable, constant footprint
  // for it via the exported FAB_CLEARANCE, instead of it being movable out
  // of the way of their content).
  //
  // Once a BottomNav is present, bottomOffset alone reserves the space for
  // it — stacking FAB_MARGIN on top too would leave a needless gap above
  // the nav bar.
  const bottomClearance = bottomOffset > 0 ? bottomOffset : FAB_MARGIN;

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
        "All changes have already been acknowledged.",
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
              status: "To be Acknowledged",
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
        `${pendingUpdates.length} update(s) submitted to the Owner for acknowledgment.`,
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
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* FAB — fixed bottom-right, tap opens the modal */}
      <TouchableOpacity
        ref={fabRef}
        activeOpacity={0.85}
        onPress={openModal}
        disabled={disabled}
        style={[
          styles.fab,
          { backgroundColor: color, right: FAB_MARGIN, bottom: insets.bottom + bottomClearance },
          disabled && styles.fabDisabled,
        ]}
      >
        {icon ?? (
          <Pencil
            size={22}
            color={disabled ? colors.emeraldSoft : colors.white}
          />
        )}
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
            <View style={styles.titleBar}>
              <Text style={styles.title}>Updates Report</Text>
            </View>

            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={colors.emerald} size="large" />
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
                  columns={["BLDG", "Space", "Field", "Change"]}
                  rows={buildingUpdates.map((u) => [
                    u.buildingNo ?? "—",
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
                  columns={["Tenant", "Method", "Amount"]}
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
                  columns={["Tenant", "Type", "Change"]}
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
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <Text style={styles.btnPrimaryText}>Apply Changes</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Accordion Section ─────────────────────────────────────────────────────────

type AccordionSectionProps = {
  title: string;
  open: boolean;
  onToggle: () => void;
  columns: string[];
  rows: string[][];
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
        {open ? (
          <ChevronUp size={16} color={colors.emerald} />
        ) : (
          <ChevronDown size={16} color={colors.emerald} />
        )}
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
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: colors.emerald,
    justifyContent: "center",
    alignItems: "center",
    elevation: 8,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    zIndex: 50,
  },
  fabDisabled: {
    opacity: 0.4,
  },

  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
  },

  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    width: "100%",
    maxHeight: "90%",
    overflow: "hidden",
    ...shadow.raised,
  },

  titleBar: {
    backgroundColor: colors.emeraldSoft,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md + 2,
  },
  title: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.bold,
    color: colors.emerald,
  },

  loadingBox: { paddingVertical: 48, alignItems: "center" },
  emptyBox: { paddingVertical: 48, alignItems: "center" },
  emptyBoxText: { fontSize: fontSize.base, fontFamily: fontFamily.regular, color: colors.textSecondary },

  scrollArea: { flexGrow: 0, maxHeight: 420 },
  scrollContent: { padding: spacing.md + 2, gap: spacing.sm + 2 },

  btnRow: {
    flexDirection: "row",
    gap: spacing.sm + 2,
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  btn: {
    flex: 1,
    paddingVertical: spacing.md - 1,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 42,
  },
  btnOutline: { borderWidth: 1.5, borderColor: colors.emerald },
  btnOutlineText: { fontSize: fontSize.base, fontFamily: fontFamily.semibold, color: colors.emerald },
  btnPrimary: { backgroundColor: colors.emerald, ...shadow.button },
  btnPrimaryText: { fontSize: fontSize.base, fontFamily: fontFamily.semibold, color: colors.white },
  btnDisabled: { opacity: 0.5 },
});

const sectionStyles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    overflow: "hidden",
    marginBottom: 2,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.emeraldSoft,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
  },
  headerText: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.emerald },
  body: { backgroundColor: colors.white },
  tableRow: { flexDirection: "row", paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 1 },
  colHeaderRow: {
    backgroundColor: colors.mist,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  colHeaderCell: {
    fontFamily: fontFamily.bold,
    color: colors.emerald,
    fontSize: fontSize.xs - 1,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  cell: { flex: 1, fontSize: fontSize.xs + 1, fontFamily: fontFamily.regular, color: colors.ink, paddingRight: 4 },
  emptyText: { padding: spacing.md + 2, fontSize: fontSize.sm, fontFamily: fontFamily.regular, color: colors.textSecondary, textAlign: "center" },
});
