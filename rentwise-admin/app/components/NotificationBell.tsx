import { useState } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";

import { db } from "../../shared/services/firestore";
import { auth } from "../../shared/services/auth";

type BellItem =
  | {
      id: string;
      kind: "passwordReset";
      tenantName?: string;
      email?: string;
      spaceId?: string;
      createdAt?: any;
    }
  | {
      id: string;
      kind: "message";
      message: string;
      createdAt?: any;
    };

function formatDate(date: any) {
  if (!date) return "-";
  const d = date.toDate ? date.toDate() : new Date(date);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

export default function NotificationBell() {
  const [visible, setVisible] = useState(false);
  const [requests, setRequests] = useState<BellItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const openModal = async () => {
    setVisible(true);
    setLoading(true);
    try {
      const passwordResetSnap = await getDocs(
        collection(db, "passwordResetRequests"),
      );
      const passwordResetItems: BellItem[] = passwordResetSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as any)
        .filter((r: any) => r.status === "pending")
        .map((r: any) => ({
          id: r.id,
          kind: "passwordReset" as const,
          tenantName: r.tenantName,
          email: r.email,
          spaceId: r.spaceId,
          createdAt: r.createdAt,
        }));

      const uid = auth.currentUser?.uid;
      let messageItems: BellItem[] = [];
      if (uid) {
        const messageSnap = await getDocs(
          query(collection(db, "notifications"), where("userId", "==", uid)),
        );
        messageItems = messageSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as any)
          .filter((r: any) => r.read !== true)
          .map((r: any) => ({
            id: r.id,
            kind: "message" as const,
            message: r.message,
            createdAt: r.createdAt,
          }));
      }

      const combined = [...passwordResetItems, ...messageItems].sort(
        (a, b) => {
          const aTs = a.createdAt?.seconds ?? 0;
          const bTs = b.createdAt?.seconds ?? 0;
          return bTs - aTs;
        },
      );
      setRequests(combined);
    } catch (err) {
      console.error("NotificationBell fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  const closeModal = () => setVisible(false);

  const resolveItem = async (item: BellItem) => {
    setResolvingId(item.id);
    try {
      if (item.kind === "passwordReset") {
        await updateDoc(doc(db, "passwordResetRequests", item.id), {
          status: "resolved",
        });
      } else {
        await updateDoc(doc(db, "notifications", item.id), {
          read: true,
        });
      }
      setRequests((prev) => prev.filter((r) => r.id !== item.id));
    } catch (err) {
      console.error("resolveItem error:", err);
      Alert.alert("Error", "Failed to update notification.");
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <>
      <TouchableOpacity
        style={styles.bellBtn}
        onPress={openModal}
        activeOpacity={0.7}
      >
        <Ionicons name="notifications-outline" size={24} color="#E6F1FB" />
        {requests.length > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {requests.length > 9 ? "9+" : requests.length}
            </Text>
          </View>
        )}
      </TouchableOpacity>

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
              <Text style={styles.title}>Notifications</Text>
            </View>

            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color="#2E6FD9" size="large" />
              </View>
            ) : requests.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyBoxText}>No new notifications.</Text>
              </View>
            ) : (
              <ScrollView
                style={styles.scrollArea}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
              >
                {requests.map((r) => (
                  <View key={r.id} style={styles.item}>
                    <View style={{ flex: 1 }}>
                      {r.kind === "passwordReset" ? (
                        <>
                          <Text style={styles.itemTitle}>
                            Password reset — {r.tenantName || "Unknown tenant"}
                          </Text>
                          <Text style={styles.itemSub}>{r.email}</Text>
                          <Text style={styles.itemSub}>
                            Space: {r.spaceId || "—"}
                          </Text>
                        </>
                      ) : (
                        <Text style={styles.itemTitle}>{r.message}</Text>
                      )}
                      <Text style={styles.itemDate}>
                        {formatDate(r.createdAt)}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[
                        styles.resolveBtn,
                        resolvingId === r.id && styles.btnDisabled,
                      ]}
                      onPress={() => resolveItem(r)}
                      disabled={resolvingId === r.id}
                    >
                      {resolvingId === r.id ? (
                        <ActivityIndicator color="#0C2D6B" size="small" />
                      ) : (
                        <Text style={styles.resolveBtnText}>
                          Mark resolved
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}

            <View style={styles.btnRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnOutline,
                  pressed && styles.btnOutlinePressed,
                ]}
                onPress={closeModal}
              >
                <Text style={styles.btnOutlineText}>Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bellBtn: {
    width: 24,
    height: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#D64545",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 3,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700",
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

  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "#B5D4F4",
    borderRadius: 10,
    padding: 12,
  },
  itemTitle: { fontSize: 13, fontWeight: "600", color: "#0C2D6B" },
  itemSub: { fontSize: 12, color: "#444441", marginTop: 2 },
  itemDate: { fontSize: 11, color: "#888780", marginTop: 4 },
  resolveBtn: {
    borderWidth: 1.5,
    borderColor: "#0C2D6B",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  resolveBtnText: { fontSize: 12, fontWeight: "600", color: "#0C2D6B" },

  btnRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    padding: 16,
    borderTopWidth: 0.5,
    borderTopColor: "#E6F1FB",
  },
  btn: {
    width: "50%",
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 42,
  },
  btnOutline: { borderWidth: 1.5, borderColor: "#0C2D6B" },
  btnOutlinePressed: {
    backgroundColor: "#E6F1FB",
    transform: [{ scale: 0.96 }],
  },
  btnOutlineText: { fontSize: 14, fontWeight: "600", color: "#0C2D6B" },
  btnDisabled: { opacity: 0.5 },
});
