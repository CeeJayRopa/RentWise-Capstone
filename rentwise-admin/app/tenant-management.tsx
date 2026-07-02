import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from "react-native";
import { router } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import {
  archiveTenant,
  resetTenantPasswordToDefault,
  DEFAULT_TENANT_PASSWORD,
} from "../shared/services/accountServices";
import Sidebar from "./components/Sidebar";
import UpdatesReportFAB from "./components/UpdatesReportFAB";
import NotificationBell from "./components/NotificationBell";

type Tenant = {
  uid: string;
  firstName: string;
  lastName: string;
  username: string;
  contactNo: string;
  stallId: string;
  buildingNumber: string;
  spaceId: string;
};

export default function TenantManagement() {
  const insets = useSafeAreaInsets();

  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [sidebarVisible, setSidebarVisible] = useState(false);

  // Archive modal state
  const [archiveTarget, setArchiveTarget] = useState<Tenant | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState("");

  // Reset password modal state
  const [resetTarget, setResetTarget] = useState<Tenant | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [usersSnap, stallsSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, "users"),
            where("role", "==", "tenant"),
            where("status", "==", "active"),
          ),
        ),
        getDocs(collection(db, "stalls")),
      ]);

      const stallMap = new Map<string, { buildingNumber: string; spaceId: string }>();
      stallsSnap.docs.forEach((d) => {
        const sd = d.data();
        stallMap.set(d.id, {
          buildingNumber: String(sd.buildingNumber ?? ""),
          spaceId: (sd.spaceId as string) ?? "",
        });
      });

      const list: Tenant[] = usersSnap.docs.map((d) => {
        const data = d.data();
        const stall = stallMap.get(data.stallId as string) ?? {
          buildingNumber: "",
          spaceId: "",
        };
        return {
          uid: d.id,
          firstName: (data.firstName as string) ?? "",
          lastName: (data.lastName as string) ?? "",
          username: (data.username as string) ?? "",
          contactNo: (data.contactNo as string) ?? "",
          stallId: (data.stallId as string) ?? "",
          buildingNumber: stall.buildingNumber,
          spaceId: stall.spaceId,
        };
      });

      list.sort((a, b) =>
        `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
      );

      setTenants(list);
    } catch (err) {
      console.error("TENANT MANAGEMENT FETCH ERROR:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) { router.replace("/"); return; }
      setChecking(false);
      fetchData();
    });
    return unsub;
  }, [fetchData]);

  const handleArchive = async () => {
    if (!archiveTarget) return;
    setArchiving(true);
    setArchiveError("");
    try {
      await archiveTenant(archiveTarget.uid);
      setArchiveTarget(null);
      fetchData();
    } catch {
      setArchiveError("Failed to archive tenant. Please try again.");
    } finally {
      setArchiving(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetTarget) return;
    setResetting(true);
    setResetError("");
    try {
      await resetTenantPasswordToDefault(resetTarget.uid);
      setResetTarget(null);
      Alert.alert(
        "Password Reset",
        `${resetTarget.firstName} ${resetTarget.lastName}'s password has been reset to ${DEFAULT_TENANT_PASSWORD}.`,
      );
    } catch {
      setResetError("Failed to reset password. Please try again.");
    } finally {
      setResetting(false);
    }
  };


  if (checking) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator color="#0C2D6B" size="large" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* HEADER */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => setSidebarVisible(true)} activeOpacity={0.7}>
          <Ionicons name="menu" size={24} color="#E6F1FB" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Tenant Management</Text>
        <NotificationBell />
      </View>

      {/* BANNER */}
      <View style={styles.banner}>
        <Text style={styles.bannerText}>
          Ka Domeng Talipapa Wet and Dry Market
        </Text>
      </View>

      {/* BODY */}
      <View style={styles.body}>
        {loading ? (
          <View style={styles.fullCenter}>
            <ActivityIndicator color="#0C2D6B" size="large" />
          </View>
        ) : tenants.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons
              name="people-outline"
              size={40}
              color="#B5D4F4"
              style={{ marginBottom: 10 }}
            />
            <Text style={styles.emptyText}>No tenants found.</Text>
          </View>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 40 }]}
          >
            {tenants.map((item) => (
              <View key={item.uid} style={styles.card}>
                {/* LEFT INFO */}
                <View style={styles.cardInfo}>
                  <Text style={styles.cardName}>
                    {item.firstName} {item.lastName}
                  </Text>
                  <Text style={styles.cardUsername}>{item.username}@rentwise.app</Text>
                  {item.buildingNumber ? (
                    <Text style={styles.cardStall}>
                      Building {item.buildingNumber} {"·"} Space {item.spaceId}
                    </Text>
                  ) : null}
                  {item.contactNo ? (
                    <Text style={styles.cardContact}>{item.contactNo}</Text>
                  ) : null}
                </View>

                {/* RIGHT ACTIONS */}
                <View style={styles.cardActions}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.resetBtn,
                      pressed && styles.resetBtnPressed,
                    ]}
                    onPress={() => {
                      setResetError("");
                      setResetTarget(item);
                    }}
                  >
                    <Text style={styles.resetBtnText}>Reset password</Text>
                  </Pressable>

                  <Pressable
                    style={({ pressed }) => [
                      styles.archiveBtn,
                      pressed && styles.archiveBtnPressed,
                    ]}
                    onPress={() => {
                      setArchiveError("");
                      setArchiveTarget(item);
                    }}
                  >
                    <Text style={styles.archiveBtnText}>Archive</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      <UpdatesReportFAB disabled={sidebarVisible} />

      <Sidebar visible={sidebarVisible} onClose={() => setSidebarVisible(false)} />

      {/* RESET PASSWORD CONFIRMATION MODAL */}
      <Modal
        visible={!!resetTarget}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!resetting) setResetTarget(null); }}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => { if (!resetting) setResetTarget(null); }}
          />
          {resetTarget && (
            <View style={styles.modalCard}>
              <View style={styles.modalTitleBar}>
                <Text style={styles.modalTitle}>Reset password?</Text>
              </View>
              <View style={styles.modalBody}>
                <Text style={styles.modalMessage}>
                  This will reset the tenant's password to {DEFAULT_TENANT_PASSWORD}.
                </Text>
                {resetError ? (
                  <Text style={styles.modalError}>{resetError}</Text>
                ) : null}
                <View style={styles.modalBtns}>
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.modalBtnOutline]}
                    onPress={() => setResetTarget(null)}
                    activeOpacity={0.7}
                    disabled={resetting}
                  >
                    <Text style={styles.modalBtnOutlineText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.modalBtnPrimary, resetting && styles.modalBtnDisabled]}
                    onPress={handleResetPassword}
                    activeOpacity={0.8}
                    disabled={resetting}
                  >
                    {resetting ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.modalBtnPrimaryText}>Reset</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* ARCHIVE CONFIRMATION MODAL */}
      <Modal
        visible={!!archiveTarget}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!archiving) setArchiveTarget(null); }}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => { if (!archiving) setArchiveTarget(null); }}
          />
          {archiveTarget && (
            <View style={styles.modalCard}>
              <View style={styles.modalTitleBar}>
                <Text style={styles.modalTitle}>Archive tenant?</Text>
              </View>
              <View style={styles.modalBody}>
                <Text style={styles.modalMessage}>
                  This will archive the tenant's account. They will no longer have access to the app.
                </Text>
                {archiveError ? (
                  <Text style={styles.modalError}>{archiveError}</Text>
                ) : null}
                <View style={styles.modalBtns}>
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.modalBtnOutline]}
                    onPress={() => setArchiveTarget(null)}
                    activeOpacity={0.7}
                    disabled={archiving}
                  >
                    <Text style={styles.modalBtnOutlineText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.modalBtnDanger, archiving && styles.modalBtnDisabled]}
                    onPress={handleArchive}
                    activeOpacity={0.8}
                    disabled={archiving}
                  >
                    {archiving ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.modalBtnDangerText}>Archive</Text>
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
  screen: {
    flex: 1,
    backgroundColor: "#F0F4FA",
  },

  fullCenter: {
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
  },

  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "500",
    flex: 1,
    textAlign: "center",
  },

  // ── Banner ────────────────────────────────────────────────────────────────────

  banner: {
    backgroundColor: "#1A4DA0",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },

  bannerText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
  },

  // ── Body ─────────────────────────────────────────────────────────────────────

  body: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },

  listContent: {
    gap: 12,
  },

  // ── Empty state ───────────────────────────────────────────────────────────────

  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
  },

  emptyText: {
    fontSize: 15,
    color: "#888780",
    textAlign: "center",
  },

  // ── Tenant card ───────────────────────────────────────────────────────────────

  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    borderWidth: 0.5,
    borderColor: "#B5D4F4",
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },

  cardInfo: {
    flex: 1,
  },

  cardName: {
    fontSize: 16,
    fontWeight: "500",
    color: "#0C2D6B",
  },

  cardUsername: {
    fontSize: 13,
    color: "#2E6FD9",
    marginTop: 2,
  },

  cardStall: {
    fontSize: 13,
    color: "#888780",
    marginTop: 2,
  },

  cardContact: {
    fontSize: 13,
    color: "#B4B2A9",
    marginTop: 4,
  },

  cardActions: {
    gap: 8,
    alignItems: "stretch",
  },

  // ── Reset Password button ─────────────────────────────────────────────────────

  resetBtn: {
    backgroundColor: "#0C2D6B",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignItems: "center",
    transform: [{ scale: 1 }],
  },

  resetBtnPressed: {
    backgroundColor: "#091f4a",
    transform: [{ scale: 0.97 }],
  },

  resetBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
  },

  // ── Archive button ────────────────────────────────────────────────────────────

  archiveBtn: {
    backgroundColor: "#FCEBEB",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#F5C2C2",
    transform: [{ scale: 1 }],
  },

  archiveBtnPressed: {
    backgroundColor: "#F5C2C2",
    transform: [{ scale: 0.97 }],
  },

  archiveBtnText: {
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
