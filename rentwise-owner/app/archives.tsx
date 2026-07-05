import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Timestamp } from "firebase/firestore";

import { Ionicons } from "@expo/vector-icons";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import {
  restoreTenant,
  deleteArchivedTenant,
} from "../shared/services/accountServices";

import OwnerSidebar from "./components/OwnerSidebar";

type ArchiveEntry = {
  uid: string;
  firstName: string;
  lastName: string;
  username: string;
  contactNo: string;
  buildingNumber: string;
  spaceId: string;
  stallId: string;
  archivedAt: Timestamp | null;
};

function formatDate(ts: Timestamp | null): string {
  if (!ts) return '—';
  const d = ts.toDate();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export default function Archives() {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [archives, setArchives] = useState<ArchiveEntry[]>([]);
  const [sidebarVisible, setSidebarVisible] = useState(false);

  const [confirmTarget, setConfirmTarget] = useState<ArchiveEntry | null>(null);
  const [checkingStall, setCheckingStall] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<ArchiveEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

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
          username: (data.username as string) ?? (data.userName as string) ?? "",
          contactNo: (data.contactNo as string) ?? "",
          buildingNumber: (data.buildingNumber as string) ?? "",
          spaceId: (data.spaceId as string) ?? "",
          stallId: (data.stallId as string) ?? "",
          archivedAt: (data.archivedAt as Timestamp) ?? null,
        };
      });
      entries.sort((a, b) => {
        if (!a.archivedAt) return 1;
        if (!b.archivedAt) return -1;
        return b.archivedAt.seconds - a.archivedAt.seconds;
      });
      setArchives(entries);
    } catch (err) {
      console.error("OWNER ARCHIVES ERROR:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) { router.replace("/login"); return; }
      setChecking(false);
      fetchData();
    });
    return unsub;
  }, [fetchData]);

  useFocusEffect(useCallback(() => { if (!checking) fetchData(); }, [checking, fetchData]));

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
              username: item.username,
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

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteArchivedTenant(deleteTarget.uid);
      setDeleteTarget(null);
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      setDeleteError(msg);
    } finally {
      setDeleting(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  if (checking) {
    return <View style={styles.fullCenter}><ActivityIndicator color="#0C2D6B" size="large" /></View>;
  }

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => setSidebarVisible(true)} activeOpacity={0.7}>
          <Ionicons name="menu" size={24} color="#E6F1FB" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>RentWise</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Sub-header */}
      <View style={styles.subHeader}>
        <Text style={styles.pageTitle}>Account archives</Text>
        <View style={styles.countPill}>
          <Text style={styles.countPillText}>{archives.length} Archived</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color="#0C2D6B" size="large" style={styles.loader} />
      ) : archives.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="archive-outline" size={40} color="#B5D4F4" style={{ marginBottom: 10 }} />
          <Text style={styles.emptyText}>No archived accounts.</Text>
        </View>
      ) : (
        <FlatList
          data={archives}
          keyExtractor={(item) => item.uid}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarInitial}>
                  {item.firstName ? item.firstName[0].toUpperCase() : "?"}
                </Text>
              </View>
              <View style={styles.cardInfo}>
                <Text style={styles.cardName}>{item.firstName} {item.lastName}</Text>
                <Text style={styles.cardUsername}>@{item.username}</Text>
                <Text style={styles.cardStall}>
                  Building {item.buildingNumber} {"·"} Space {item.spaceId}
                </Text>
                <Text style={styles.cardDate}>Archived: {formatDate(item.archivedAt)}</Text>
              </View>
              <View style={styles.cardActions}>
                <Pressable
                  style={({ pressed }) => [
                    styles.restoreBtn,
                    pressed && styles.restoreBtnPressed,
                  ]}
                  onPress={() => handleRestorePress(item)}
                  disabled={checkingStall}
                >
                  {checkingStall ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.restoreBtnText}>Restore</Text>
                  )}
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.deleteBtn,
                    pressed && styles.deleteBtnPressed,
                  ]}
                  onPress={() => { setDeleteError(""); setDeleteTarget(item); }}
                >
                  <Text style={styles.deleteBtnText}>Delete</Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}

      <OwnerSidebar visible={sidebarVisible} onClose={() => setSidebarVisible(false)} />

      {/* RESTORE CONFIRMATION MODAL */}
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
              <View style={styles.modalTitleBar}>
                <Text style={styles.modalTitle}>Restore account?</Text>
              </View>
              <View style={styles.modalBody}>
                <Text style={styles.modalMessage}>
                  This will restore the tenant's account and they will regain access to the app.
                </Text>
                {restoreError ? (
                  <Text style={styles.modalError}>{restoreError}</Text>
                ) : null}
                <View style={styles.modalBtns}>
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.modalBtnOutline]}
                    onPress={() => setConfirmTarget(null)}
                    activeOpacity={0.7}
                    disabled={restoring}
                  >
                    <Text style={styles.modalBtnOutlineText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.modalBtn,
                      styles.modalBtnPrimary,
                      restoring && styles.modalBtnDisabled,
                    ]}
                    onPress={handleRestore}
                    activeOpacity={0.8}
                    disabled={restoring}
                  >
                    {restoring ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.modalBtnPrimaryText}>Restore</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* DELETE CONFIRMATION MODAL */}
      <Modal
        visible={!!deleteTarget}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!deleting) setDeleteTarget(null); }}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => { if (!deleting) setDeleteTarget(null); }}
          />
          {deleteTarget && (
            <View style={styles.modalCard}>
              <View style={styles.modalTitleBar}>
                <Text style={styles.modalTitle}>Permanently delete?</Text>
              </View>
              <View style={styles.modalBody}>
                <Text style={styles.modalMessage}>
                  This action cannot be undone. The tenant's account and all data will be permanently removed.
                </Text>
                {deleteError ? (
                  <Text style={styles.modalError}>{deleteError}</Text>
                ) : null}
                <View style={styles.modalBtns}>
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.modalBtnOutline]}
                    onPress={() => setDeleteTarget(null)}
                    activeOpacity={0.7}
                    disabled={deleting}
                  >
                    <Text style={styles.modalBtnOutlineText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.modalBtn,
                      styles.modalBtnDanger,
                      deleting && styles.modalBtnDisabled,
                    ]}
                    onPress={handleDelete}
                    activeOpacity={0.8}
                    disabled={deleting}
                  >
                    {deleting ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.modalBtnDangerText}>Delete</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F0F4FA" },
  fullCenter: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F0F4FA" },

  header: {
    backgroundColor: "#0C2D6B",
    paddingBottom: 14,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "500",
    color: "#FFFFFF",
    textAlign: "center",
  },

  subHeader: {
    backgroundColor: "#1A4DA0",
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pageTitle: { fontSize: 16, fontWeight: "500", color: "#FFFFFF" },
  countPill: {
    backgroundColor: "#0C2D6B",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  countPillText: { fontSize: 12, fontWeight: "500", color: "#B5D4F4" },

  loader: { marginTop: 60 },

  list: { paddingHorizontal: 16, paddingTop: 16, gap: 10 },

  emptyBox: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  emptyText: { fontSize: 15, color: "#888780", textAlign: "center" },

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderWidth: 0.5,
    borderColor: "#B5D4F4",
  },

  avatarCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#E6F1FB",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: { fontSize: 18, fontWeight: "500", color: "#0C2D6B" },

  cardInfo: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: "500", color: "#0C2D6B" },
  cardUsername: { fontSize: 13, color: "#2E6FD9", marginTop: 1 },
  cardStall: { fontSize: 13, color: "#888780", marginTop: 2 },
  cardDate: { fontSize: 12, color: "#B4B2A9", marginTop: 4 },

  cardActions: {
    gap: 8,
    alignItems: "stretch",
  },

  restoreBtn: {
    backgroundColor: "#0C2D6B",
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 9,
    alignItems: "center",
    transform: [{ scale: 1 }],
  },
  restoreBtnPressed: {
    backgroundColor: "#091f4a",
    transform: [{ scale: 0.97 }],
  },
  restoreBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
  },

  deleteBtn: {
    backgroundColor: "#FCEBEB",
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 9,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#F5C2C2",
    transform: [{ scale: 1 }],
  },
  deleteBtnPressed: {
    backgroundColor: "#F5C2C2",
    transform: [{ scale: 0.97 }],
  },
  deleteBtnText: {
    color: "#A32D2D",
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
  },

  // ── Confirmation modals ───────────────────────────────────────────────────────

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },

  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: "#B5D4F4",
    width: "100%",
    overflow: "hidden",
  },

  modalTitleBar: {
    backgroundColor: "#E6F1FB",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },

  modalTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#0C2D6B",
  },

  modalBody: {
    padding: 20,
  },

  modalMessage: {
    fontSize: 14,
    color: "#444441",
    lineHeight: 22,
    marginBottom: 20,
  },

  modalError: {
    fontSize: 13,
    color: "#A32D2D",
    marginBottom: 12,
    textAlign: "center",
  },

  modalBtns: {
    flexDirection: "row",
    gap: 10,
  },

  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },

  modalBtnOutline: {
    borderWidth: 1.5,
    borderColor: "#B5D4F4",
  },

  modalBtnOutlineText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0C2D6B",
  },

  modalBtnPrimary: {
    backgroundColor: "#0C2D6B",
  },

  modalBtnPrimaryText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },

  modalBtnDanger: {
    backgroundColor: "#A32D2D",
  },

  modalBtnDangerText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },

  modalBtnDisabled: {
    opacity: 0.5,
  },
});

