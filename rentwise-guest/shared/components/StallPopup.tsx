import { View, Text, StyleSheet, TouchableOpacity } from "react-native";

interface Stall {
  id: string;
  name?: string;
  status?: string;
  buildingNumber?: string;
  spaceDimension?: string;
  price?: number;
}

interface Props {
  stall: Stall;
  onClose: () => void;
}

export default function StallPopup({ stall, onClose }: Props) {
  const isVacant = stall.status?.toLowerCase() !== "occupied";

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <View style={[styles.dot, { backgroundColor: isVacant ? "#4CAF50" : "#c62828" }]} />
        <Text style={styles.stallName}>{stall.name ?? "Stall"}</Text>
      </View>

      <View style={styles.fields}>
        <Text style={styles.field}>
          <Text style={styles.label}>Status: </Text>
          {stall.status ?? "Unknown"}
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
    maxWidth: 320,
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
  dot: { width: 12, height: 12, borderRadius: 6 },
  stallName: { fontSize: 16, fontWeight: "bold" },
  fields: { gap: 6, marginBottom: 16 },
  field: { fontSize: 13, color: "#333", lineHeight: 20 },
  label: { fontWeight: "600" },
  closeBtn: {
    alignSelf: "center",
    paddingVertical: 8,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: "#555",
    borderRadius: 20,
  },
  closeBtnText: { fontSize: 13, color: "#333" },
});
