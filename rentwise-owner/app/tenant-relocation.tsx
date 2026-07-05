import { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { db } from "../shared/services/firestore";
import { restoreTenantToNewStall } from "../shared/services/accountServices";

type StallOption = {
  id: string;
  buildingNumber: string;
  spaceId: string;
  name: string;
  price: number;
  paymentSchedule: string;
};

export default function TenantRelocation() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    uid: string;
    firstName: string;
    lastName: string;
    username: string;
    buildingNumber: string;
    spaceId: string;
    stallId: string;
  }>();

  const { uid, firstName, lastName, username, buildingNumber, spaceId } = params;
  const fullName = `${firstName} ${lastName}`.trim();

  const [stalls, setStalls] = useState<StallOption[]>([]);
  const [selectedStall, setSelectedStall] = useState<StallOption | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    fetchUnoccupiedStalls();
  }, []);

  const fetchUnoccupiedStalls = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, "stalls"), where("status", "==", "unoccupied")),
      );
      const list: StallOption[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          buildingNumber: String(data.buildingNumber ?? ""),
          spaceId: String(data.spaceId ?? ""),
          name: String(data.name ?? ""),
          price: Number(data.price ?? 0),
          paymentSchedule: String(data.paymentSchedule ?? ""),
        };
      });
      list.sort((a, b) => {
        const bn = a.buildingNumber.localeCompare(b.buildingNumber);
        if (bn !== 0) return bn;
        return a.spaceId.localeCompare(b.spaceId);
      });
      setStalls(list);
    } catch (err) {
      console.log("RELOCATION FETCH ERROR:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!selectedStall) {
      Alert.alert("No Stall Selected", "Please select an available stall first.");
      return;
    }
    setRestoring(true);
    try {
      await restoreTenantToNewStall(uid, selectedStall.id);
      Alert.alert(
        "Account Restored",
        `${fullName} has been assigned to Building ${selectedStall.buildingNumber} · Space ${selectedStall.spaceId}.`,
        [{ text: "OK", onPress: () => router.replace("/archives") }],
      );
    } catch (err: any) {
      const msg =
        err?.message === "Selected stall is no longer available."
          ? "That stall was just taken. Please choose another."
          : "Failed to restore tenant. Please try again.";
      Alert.alert("Error", msg);
      fetchUnoccupiedStalls();
      setSelectedStall(null);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <View style={styles.screen}>
      {/* HEADER */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.7}
          disabled={restoring}
        >
          <Ionicons name="arrow-back" size={22} color="#E6F1FB" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Tenant Relocation</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* SCROLLABLE BODY */}
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ARCHIVED TENANT CARD */}
        <View style={styles.infoCard}>
          <Text style={styles.cardLabel}>Archived tenant</Text>
          <Text style={styles.infoName}>{fullName}</Text>
          <Text style={styles.infoUsername}>{username}@rentwise.app</Text>
          <View style={styles.infoDivider} />
          <Text style={styles.infoNotice}>
            Previous stall{" "}
            <Text style={styles.infoBold}>
              Building {buildingNumber} {"·"} Space {spaceId}
            </Text>
            {" "}is currently occupied. Select a new available stall below.
          </Text>
        </View>

        {/* AVAILABLE STALLS */}
        <Text style={styles.sectionLabel}>Available stalls</Text>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#0C2D6B" size="large" />
          </View>
        ) : stalls.length === 0 ? (
          <Text style={styles.emptyText}>No available stalls at the moment.</Text>
        ) : (
          stalls.map((item) => {
            const selected = selectedStall?.id === item.id;
            return (
              <TouchableOpacity
                key={item.id}
                style={[styles.stallCard, selected && styles.stallCardSelected]}
                onPress={() => setSelectedStall(item)}
                activeOpacity={0.75}
                disabled={restoring}
              >
                <View style={styles.stallInfo}>
                  <Text style={styles.stallTitle}>
                    Building {item.buildingNumber} {"·"} Space {item.spaceId}
                  </Text>
                  <Text style={styles.stallSub}>
                    ₱{item.price.toLocaleString()} {"·"} {item.paymentSchedule}
                  </Text>
                </View>
                <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
                  {selected && <View style={styles.radioInner} />}
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* FOOTER — RESTORE BUTTON */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 28 }]}>
        <Pressable
          style={({ pressed }) => [
            styles.restoreBtn,
            (!selectedStall || restoring) && styles.restoreBtnDisabled,
            pressed && !!selectedStall && !restoring && styles.restoreBtnPressed,
          ]}
          onPress={handleRestore}
          disabled={!selectedStall || restoring}
        >
          {restoring ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.restoreBtnText}>Restore account</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F0F4FA",
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

  // ── Body ─────────────────────────────────────────────────────────────────────

  body: {
    flex: 1,
  },

  bodyContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 100,
  },

  // ── Archived tenant card ──────────────────────────────────────────────────────

  infoCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 18,
    borderWidth: 0.5,
    borderColor: "#B5D4F4",
    marginBottom: 24,
  },

  cardLabel: {
    fontSize: 11,
    fontWeight: "500",
    color: "#2E6FD9",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 8,
  },

  infoName: {
    fontSize: 18,
    fontWeight: "500",
    color: "#0C2D6B",
  },

  infoUsername: {
    fontSize: 14,
    color: "#2E6FD9",
    marginTop: 2,
  },

  infoDivider: {
    height: 0.5,
    backgroundColor: "#E6F1FB",
    marginVertical: 14,
  },

  infoNotice: {
    fontSize: 14,
    color: "#444441",
    lineHeight: 20,
  },

  infoBold: {
    fontWeight: "500",
    color: "#0C2D6B",
  },

  // ── Section label ─────────────────────────────────────────────────────────────

  sectionLabel: {
    fontSize: 11,
    fontWeight: "500",
    color: "#2E6FD9",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 12,
  },

  // ── Stall option card ─────────────────────────────────────────────────────────

  stallCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1.5,
    borderColor: "#B5D4F4",
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
  },

  stallCardSelected: {
    borderColor: "#0C2D6B",
  },

  stallInfo: {
    flex: 1,
  },

  stallTitle: {
    fontSize: 15,
    fontWeight: "500",
    color: "#0C2D6B",
  },

  stallSub: {
    fontSize: 13,
    color: "#888780",
    marginTop: 4,
  },

  // ── Radio button ──────────────────────────────────────────────────────────────

  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#B5D4F4",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },

  radioOuterSelected: {
    borderColor: "#0C2D6B",
    backgroundColor: "#0C2D6B",
  },

  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#fff",
  },

  // ── Empty / loading ───────────────────────────────────────────────────────────

  center: {
    alignItems: "center",
    paddingTop: 40,
  },

  emptyText: {
    fontSize: 14,
    color: "#888780",
    textAlign: "center",
    marginTop: 20,
  },

  // ── Footer restore button ─────────────────────────────────────────────────────

  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#F0F4FA",
    paddingHorizontal: 16,
    paddingTop: 12,
  },

  restoreBtn: {
    width: "100%",
    backgroundColor: "#0C2D6B",
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ scale: 1 }],
  },

  restoreBtnPressed: {
    backgroundColor: "#091f4a",
    transform: [{ scale: 0.97 }],
  },

  restoreBtnDisabled: {
    backgroundColor: "#B5D4F4",
  },

  restoreBtnText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#fff",
    textAlign: "center",
  },
});
