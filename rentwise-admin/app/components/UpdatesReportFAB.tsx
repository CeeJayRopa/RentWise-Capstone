import { useRef, useState } from "react";
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
  Animated,
  PanResponder,
  Dimensions,
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
import { Ionicons } from "@expo/vector-icons";

import { db } from "../../shared/services/firestore";

const FAB_SIZE = 56;
const FAB_MARGIN = 20;

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
};

export default function UpdatesReportFAB({
  disabled = false,
  color = "#0C2D6B",
  icon,
}: UpdatesReportFABProps) {
  const insets = useSafeAreaInsets();

  const [visible, setVisible] = useState(false);
  const [updates, setUpdates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [buildingOpen, setBuildingOpen] = useState(true);
  const [financeOpen, setFinanceOpen] = useState(true);
  const [archiveOpen, setArchiveOpen] = useState(true);

  // ── Draggable FAB position ─────────────────────────────────────────────────
  const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
  const posRef = useRef({
    x: SCREEN_W - FAB_SIZE - FAB_MARGIN,
    y: SCREEN_H - FAB_SIZE - FAB_MARGIN - insets.bottom,
  });
  const pan = useRef(new Animated.ValueXY(posRef.current)).current;
  const dragStart = useRef({ x: 0, y: 0 });
  const dragged = useRef(false);

  const clamp = (val: number, min: number, max: number) =>
    Math.min(Math.max(val, min), max);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onPanResponderGrant: () => {
        dragged.current = false;
        dragStart.current = { x: posRef.current.x, y: posRef.current.y };
      },
      onPanResponderMove: (_evt, gestureState) => {
        if (Math.abs(gestureState.dx) > 4 || Math.abs(gestureState.dy) > 4) {
          dragged.current = true;
        }
        const nextX = clamp(
          dragStart.current.x + gestureState.dx,
          FAB_MARGIN,
          SCREEN_W - FAB_SIZE - FAB_MARGIN,
        );
        const nextY = clamp(
          dragStart.current.y + gestureState.dy,
          insets.top + FAB_MARGIN,
          SCREEN_H - FAB_SIZE - insets.bottom - FAB_MARGIN,
        );
        posRef.current = { x: nextX, y: nextY };
        pan.setValue({ x: nextX, y: nextY });
      },
      onPanResponderRelease: () => {
        if (!dragged.current) {
          if (!disabled) openModal();
          return;
        }
        // Snap to whichever side the finger was closest to, like Messenger's
        // chat heads — stays on the same row (y), just settles to the edge.
        const targetX =
          posRef.current.x + FAB_SIZE / 2 < SCREEN_W / 2
            ? FAB_MARGIN
            : SCREEN_W - FAB_SIZE - FAB_MARGIN;
        posRef.current = { x: targetX, y: posRef.current.y };
        Animated.spring(pan, {
          toValue: { x: targetX, y: posRef.current.y },
          friction: 6,
          useNativeDriver: false,
        }).start();
      },
    }),
  ).current;

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
    <>
      {/* FAB — draggable anywhere on screen, tap (without dragging) opens the modal */}
      <Animated.View
        style={[
          styles.fab,
          { backgroundColor: color },
          disabled && styles.fabDisabled,
          { transform: pan.getTranslateTransform() },
        ]}
        {...panResponder.panHandlers}
      >
        {icon ?? (
          <Ionicons
            name="create-outline"
            size={24}
            color={disabled ? "#B5D4F4" : "#FFFFFF"}
          />
        )}
      </Animated.View>

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
                <ActivityIndicator color="#2E6FD9" size="large" />
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
                  columns={["Building No.", "Space No.", "Field Changed", "Change"]}
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
    left: 0,
    top: 0,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: "#0C2D6B",
    justifyContent: "center",
    alignItems: "center",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    zIndex: 50,
  },
  fabDisabled: {
    opacity: 0.4,
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
    borderWidth: 0.5,
    borderColor: "#B5D4F4",
    width: "100%",
    maxHeight: "90%",
    overflow: "hidden",
  },

  titleBar: {
    backgroundColor: "#E6F1FB",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0C2D6B",
  },

  loadingBox: { paddingVertical: 48, alignItems: "center" },
  emptyBox: { paddingVertical: 48, alignItems: "center" },
  emptyBoxText: { fontSize: 14, color: "#888780" },

  scrollArea: { flexGrow: 0, maxHeight: 420 },
  scrollContent: { padding: 14, gap: 10 },

  btnRow: {
    flexDirection: "row",
    gap: 10,
    padding: 16,
    borderTopWidth: 0.5,
    borderTopColor: "#E6F1FB",
  },
  btn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 42,
  },
  btnOutline: { borderWidth: 1.5, borderColor: "#0C2D6B" },
  btnOutlineText: { fontSize: 14, fontWeight: "600", color: "#0C2D6B" },
  btnPrimary: { backgroundColor: "#2E6FD9" },
  btnPrimaryText: { fontSize: 14, fontWeight: "600", color: "#FFFFFF" },
  btnDisabled: { opacity: 0.5 },
});

const sectionStyles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderColor: "#B5D4F4",
    borderRadius: 10,
    overflow: "hidden",
    marginBottom: 2,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#E6F1FB",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  headerText: { fontSize: 14, fontWeight: "500", color: "#0C2D6B" },
  arrow: { fontSize: 11, color: "#2E6FD9" },
  body: { backgroundColor: "#FFFFFF" },
  tableRow: { flexDirection: "row", paddingHorizontal: 12, paddingVertical: 9 },
  colHeaderRow: {
    backgroundColor: "#F0F4FA",
    borderBottomWidth: 1,
    borderBottomColor: "#E6F1FB",
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: "#E6F1FB" },
  colHeaderCell: {
    fontWeight: "700",
    color: "#0C2D6B",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  cell: { flex: 1, fontSize: 12, color: "#444441", paddingRight: 4 },
  emptyText: { padding: 14, fontSize: 13, color: "#888780", textAlign: "center" },
});
