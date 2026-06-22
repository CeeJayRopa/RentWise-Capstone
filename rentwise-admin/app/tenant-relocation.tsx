import { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { db } from "../shared/services/firestore";
import { Colors } from "../shared/constants/color";
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
    userName: string;
    buildingNumber: string;
    spaceId: string;
    stallId: string;
  }>();

  const { uid, firstName, lastName, userName, buildingNumber, spaceId } = params;
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
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
          disabled={restoring}
        >
          <Text style={styles.navIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Tenant Relocation</Text>
        <View style={styles.navBtn} />
      </View>

      {/* Tenant info card */}
      <View style={styles.infoCard}>
        <Text style={styles.infoLabel}>Archived Tenant</Text>
        <Text style={styles.infoName}>{fullName}</Text>
        <Text style={styles.infoSub}>@{userName}</Text>
        <View style={styles.infoDivider} />
        <Text style={styles.infoNotice}>
          Previous stall{" "}
          <Text style={styles.infoBold}>
            Building {buildingNumber} · Space {spaceId}
          </Text>{" "}
          is currently occupied. Select a new available stall below.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Available Stalls</Text>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} size="large" />
        </View>
      ) : stalls.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No available stalls at the moment.</Text>
        </View>
      ) : (
        <FlatList
          data={stalls}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + 100 },
          ]}
          renderItem={({ item }) => {
            const selected = selectedStall?.id === item.id;
            return (
              <TouchableOpacity
                style={[styles.stallCard, selected && styles.stallCardSelected]}
                onPress={() => setSelectedStall(item)}
                activeOpacity={0.75}
                disabled={restoring}
              >
                <View style={styles.stallInfo}>
                  <Text style={[styles.stallTitle, selected && styles.stallTitleSelected]}>
                    Building {item.buildingNumber} · Space {item.spaceId}
                  </Text>
                  {item.name ? (
                    <Text style={styles.stallSub}>{item.name}</Text>
                  ) : null}
                  <Text style={styles.stallSub}>
                    ₱{item.price.toLocaleString()} · {item.paymentSchedule}
                  </Text>
                </View>
                <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
                  {selected && <View style={styles.radioInner} />}
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* Restore button */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[
            styles.restoreBtn,
            (!selectedStall || restoring) && styles.restoreBtnDisabled,
          ]}
          onPress={handleRestore}
          activeOpacity={0.85}
          disabled={!selectedStall || restoring}
        >
          {restoring ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.restoreBtnText}>Restore Account</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },

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

  // Info card
  infoCard: {
    margin: 16,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  infoLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: Colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  infoName: { fontSize: 18, fontWeight: "700", color: Colors.textPrimary },
  infoSub: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  infoDivider: { height: 1, backgroundColor: Colors.border, marginVertical: 12 },
  infoNotice: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  infoBold: { fontWeight: "700", color: Colors.textPrimary },

  // Section title
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginHorizontal: 16,
    marginBottom: 8,
  },

  // Stall list
  listContent: { paddingHorizontal: 16, gap: 10 },
  stallCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: Colors.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  stallCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: "#EEF4FB",
  },
  stallInfo: { flex: 1 },
  stallTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginBottom: 3,
  },
  stallTitleSelected: { color: Colors.primary },
  stallSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },

  // Radio button
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  radioOuterSelected: { borderColor: Colors.primary },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.primary,
  },

  // Empty / center
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyText: { fontSize: 14, color: Colors.textMuted },

  // Footer
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 6,
  },
  restoreBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  restoreBtnDisabled: { backgroundColor: Colors.disabled },
  restoreBtnText: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
});
