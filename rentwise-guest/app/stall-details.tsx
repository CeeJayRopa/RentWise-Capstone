import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useEffect, useState } from "react";
import { getStalls } from "../services/stallService";

interface Props {
  onClose: () => void;
}

export default function StallDetails({ onClose }: Props) {
  const [vacantStalls, setVacantStalls] = useState<any[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getStalls()
      .then((data) => {
        setVacantStalls(data.filter((s: any) => s.status?.toLowerCase() !== "occupied"));
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator size="small" />
      </View>
    );
  }

  if (vacantStalls.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.emptyText}>No vacant stalls available.</Text>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeBtnText}>Close</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const stall = vacantStalls[index];

  return (
    <View style={styles.card}>
      {/* Title row */}
      <View style={styles.titleRow}>
        <View style={styles.dot} />
        <Text style={styles.stallName}>{stall.name ?? `Vacant Stall ${index + 1}`}</Text>
      </View>

      {/* Fields */}
      <View style={styles.fields}>
        <Text style={styles.field}>
          <Text style={styles.label}>Status: </Text>
          {stall.status ?? "Unoccupied"}
        </Text>
        <Text style={styles.field}>
          <Text style={styles.label}>Building Number: </Text>
          {stall.buildingNumber ?? "—"}
        </Text>
        <Text style={styles.field}>
          <Text style={styles.label}>Space Dimension: </Text>
          {stall.spaceDimension ?? "—"}
        </Text>
        <Text style={styles.field}>
          <Text style={styles.label}>Rent Amount: </Text>
          ₱{stall.price ?? "—"}/day
        </Text>
      </View>

      {/* Navigation (only when more than 1 stall) */}
      {vacantStalls.length > 1 && (
        <View style={styles.nav}>
          <TouchableOpacity
            onPress={() => setIndex(index === 0 ? vacantStalls.length - 1 : index - 1)}
          >
            <Text style={styles.navArrow}>◀</Text>
          </TouchableOpacity>
          <Text style={styles.navCount}>
            {index + 1} / {vacantStalls.length}
          </Text>
          <TouchableOpacity
            onPress={() => setIndex((index + 1) % vacantStalls.length)}
          >
            <Text style={styles.navArrow}>▶</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Close */}
      <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
        <Text style={styles.closeBtnText}>Close</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 20,
    width: "80%",
    maxWidth: 340,
    alignSelf: "center",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },

  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
    gap: 8,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#4CAF50",
  },
  stallName: {
    fontSize: 16,
    fontWeight: "bold",
  },

  fields: { gap: 6, marginBottom: 16 },
  field: { fontSize: 13, color: "#333", lineHeight: 20 },
  label: { fontWeight: "600" },

  nav: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 20,
    marginBottom: 12,
  },
  navArrow: { fontSize: 18, color: "#555" },
  navCount: { fontSize: 13, color: "#555" },

  closeBtn: {
    alignSelf: "center",
    paddingVertical: 8,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: "#555",
    borderRadius: 20,
  },
  closeBtnText: { fontSize: 13, color: "#333" },

  emptyText: { fontSize: 14, color: "#555", marginBottom: 16, textAlign: "center" },
});
