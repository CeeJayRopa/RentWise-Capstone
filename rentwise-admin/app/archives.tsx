import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { router } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import { Colors } from "../shared/constants/color";
import { restoreTenant } from "../shared/services/accountServices";
import Sidebar from "./components/Sidebar";
import UpdatesReportFAB from "./components/UpdatesReportFAB";

type ArchiveEntry = {
  uid: string;
  firstName: string;
  lastName: string;
  userName: string;
  contactNo: string;
  buildingNumber: string;
  spaceId: string;
  stallId: string;
  archivedAt: Timestamp | null;
};

const formatDate = (ts: Timestamp | null): string => {
  if (!ts) return "—";
  const d = ts.toDate();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
};

export default function Archives() {
  const insets = useSafeAreaInsets();

  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [archives, setArchives] = useState<ArchiveEntry[]>([]);

  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<ArchiveEntry | null>(null);
  const [checkingStall, setCheckingStall] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, "archives"));
      const entries: ArchiveEntry[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          uid: d.id,
          firstName: (data.firstName as string) ?? "",
          lastName: (data.lastName as string) ?? "",
          userName: (data.userName as string) ?? "",
          contactNo: (data.contactNo as string) ?? "",
          buildingNumber: (data.buildingNumber as string) ?? "",
          spaceId: (data.spaceId as string) ?? "",
          stallId: (data.stallId as string) ?? "",
          archivedAt: (data.archivedAt as Timestamp) ?? null,
        };
      });
      // Most recently archived first
      entries.sort((a, b) => {
        if (!a.archivedAt) return 1;
        if (!b.archivedAt) return -1;
        return b.archivedAt.seconds - a.archivedAt.seconds;
      });
      setArchives(entries);
    } catch (err) {
      console.error("ARCHIVES FETCH ERROR:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) { router.replace("/"); return; }
      setChecking(false);
      fetchData();
    });
    return unsubscribe;
  }, [fetchData]);

  const handleRestorePress = async (item: ArchiveEntry) => {
    setRestoreError("");
    if (item.stallId) {
      setCheckingStall(true);
      try {
        const stallSnap = await getDoc(doc(db, "stalls", item.stallId));
        if (stallSnap.exists() && stallSnap.data().status === "occupied") {
          router.push({
            pathname: "/tenant-relocation",
            params: {
              uid: item.uid,
              firstName: item.firstName,
              lastName: item.lastName,
              userName: item.userName,
              buildingNumber: item.buildingNumber,
              spaceId: item.spaceId,
              stallId: item.stallId,
            },
          } as any);
          return;
        }
      } catch {
        setRestoreError("Could not check stall availability. Try again.");
        return;
      } finally {
        setCheckingStall(false);
      }
    }
    setConfirmTarget(item);
  };

  const handleRestore = async () => {
    if (!confirmTarget) return;
    setRestoring(true);
    setRestoreError("");
    try {
      await restoreTenant(confirmTarget.uid);
      setConfirmTarget(null);
      fetchData();
    } catch {
      setRestoreError("Failed to restore. Please try again.");
    } finally {
      setRestoring(false);
    }
  };

  // ── Auth spinner ─────────────────────────────────────────────────────────

  if (checking) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => setSidebarVisible(true)}
          activeOpacity={0.7}
        >
          <Text style={styles.navIcon}>☰</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Account Archives</Text>
        <View style={styles.navBtn} />
      </View>

      {loading ? (
        <View style={styles.fullCenter}>
          <ActivityIndicator color={Colors.primary} size="large" />
        </View>
      ) : archives.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>No archived accounts found.</Text>
        </View>
      ) : (
        <FlatList
          data={archives}
          keyExtractor={(item) => item.uid}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + 24 },
          ]}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardInfo}>
                <Text style={styles.cardName}>
                  {item.firstName} {item.lastName}
                </Text>
                <Text style={styles.cardSub}>@{item.userName}</Text>
                <Text style={styles.cardSub}>
                  Building {item.buildingNumber} · Space {item.spaceId}
                </Text>
                <Text style={styles.cardDate}>
                  Archived: {formatDate(item.archivedAt)}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.restoreBtn}
                onPress={() => handleRestorePress(item)}
                activeOpacity={0.7}
                disabled={checkingStall}
              >
                {checkingStall ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.restoreBtnText}>Restore</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      <UpdatesReportFAB />

      {/* Restore confirmation modal */}
      <Modal
        visible={!!confirmTarget}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!restoring) setConfirmTarget(null); }}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => { if (!restoring) setConfirmTarget(null); }}
          />
          {confirmTarget && (
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Restore Tenant</Text>
              <Text style={styles.modalBody}>
                Restore{" "}
                <Text style={styles.boldText}>
                  {confirmTarget.firstName} {confirmTarget.lastName}
                </Text>
                ? Their account will be reactivated. If Building{" "}
                {confirmTarget.buildingNumber} · Space {confirmTarget.spaceId} is
                still available, it will be reassigned to them.
              </Text>
              {restoreError ? (
                <Text style={styles.errorText}>{restoreError}</Text>
              ) : null}
              <View style={styles.modalBtns}>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.outlineBtn]}
                  onPress={() => setConfirmTarget(null)}
                  activeOpacity={0.7}
                  disabled={restoring}
                >
                  <Text style={styles.outlineBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modalBtn,
                    styles.confirmBtn,
                    restoring && styles.btnDisabled,
                  ]}
                  onPress={handleRestore}
                  activeOpacity={0.8}
                  disabled={restoring}
                >
                  {restoring ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.confirmBtnText}>Restore</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>

      <Sidebar
        visible={sidebarVisible}
        onClose={() => setSidebarVisible(false)}
      />
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  fullCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.background,
  },

  // Header
  header: {
    backgroundColor: Colors.primary,
    paddingBottom: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navBtn: { width: 36, alignItems: "center", justifyContent: "center" },
  navIcon: { fontSize: 22, color: "#FFFFFF" },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#FFFFFF" },

  // Empty state
  emptyBox: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyText: { fontSize: 15, color: Colors.textMuted },

  // Archive list
  listContent: { padding: 16, gap: 12 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardInfo: { flex: 1 },
  cardName: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginBottom: 3,
  },
  cardSub: { fontSize: 13, color: Colors.textSecondary, marginBottom: 2 },
  cardDate: { fontSize: 12, color: Colors.textMuted, marginTop: 4 },

  restoreBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignSelf: "center",
    marginLeft: 12,
  },
  restoreBtnText: { fontSize: 13, fontWeight: "600", color: "#FFFFFF" },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginBottom: 10,
  },
  modalBody: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 21,
    marginBottom: 20,
  },
  boldText: { fontWeight: "700", color: Colors.textPrimary },
  errorText: { fontSize: 13, color: Colors.error, textAlign: "center", marginBottom: 12 },
  modalBtns: { flexDirection: "row", gap: 10 },
  modalBtn: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  outlineBtn: { borderWidth: 1.5, borderColor: Colors.border },
  outlineBtnText: { fontSize: 14, fontWeight: "600", color: Colors.textSecondary },
  confirmBtn: { backgroundColor: Colors.primary },
  confirmBtnText: { fontSize: 14, fontWeight: "600", color: "#FFFFFF" },
  btnDisabled: { backgroundColor: Colors.disabled },
});
