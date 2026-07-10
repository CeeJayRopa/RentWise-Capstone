import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";

const PRIMARY = "#0E7C5A";
const PRIMARY_TINT = "#E4F3EC";
const ACCENT = "#E8994A";
const ACCENT_TINT = "#FCF0E2";
const OCCUPIED = "#C0392B";
const OCCUPIED_TINT = "#FBEAE8";
const TEXT_DARK = "#171A19";
const TEXT_MUTED = "#5B6560";
const BORDER = "#E7E5DE";

interface Stall {
  id: string;
  name?: string;
  status?: string;
  buildingNumber?: string;
  spaceDimension?: string;
  width?: number;
  length?: number;
  price?: number;
}

interface Props {
  stall: Stall;
  onClose: () => void;
  onViewOthers?: () => void;
}

export default function StallPopup({ stall, onClose, onViewOthers }: Props) {
  const { width } = useWindowDimensions();
  const isMobile = width <= 480;
  const isVacant = stall.status?.toLowerCase() !== "occupied";
  const statusColor = isVacant ? PRIMARY : OCCUPIED;
  const statusTint = isVacant ? PRIMARY_TINT : OCCUPIED_TINT;

  return (
    <View style={[styles.card, isMobile && styles.cardMobile]}>
      <TouchableOpacity
        style={[styles.closeIconBtn, isMobile && styles.closeIconBtnMobile]}
        onPress={onClose}
        hitSlop={8}
      >
        <Ionicons name="close" size={isMobile ? 14 : 18} color={TEXT_MUTED} />
      </TouchableOpacity>

      <Text style={[styles.stallName, isMobile && styles.stallNameMobile]}>
        {stall.name ?? "Stall"}
      </Text>
      <View style={[styles.statusPill, isMobile && styles.statusPillMobile, { backgroundColor: statusTint }]}>
        <View style={[styles.dot, { backgroundColor: statusColor }]} />
        <Text style={[styles.statusText, { color: statusColor }]}>
          {isVacant ? "Vacant" : "Occupied"}
        </Text>
      </View>

      <View style={[styles.grid, isMobile && styles.gridMobile]}>
        <View style={[styles.gridItem, isMobile && styles.gridItemMobile]}>
          <Ionicons name="business-outline" size={isMobile ? 12 : 16} color={PRIMARY} />
          <Text style={[styles.gridLabel, isMobile && styles.gridLabelMobile]}>Building</Text>
          <Text style={[styles.gridValue, isMobile && styles.gridValueMobile]}>
            {stall.buildingNumber ?? "—"}
          </Text>
        </View>
        <View style={[styles.gridItem, isMobile && styles.gridItemMobile]}>
          <Ionicons name="resize-outline" size={isMobile ? 12 : 16} color={PRIMARY} />
          <Text style={[styles.gridLabel, isMobile && styles.gridLabelMobile]}>Width</Text>
          <Text style={[styles.gridValue, isMobile && styles.gridValueMobile]}>
            {stall.width ?? "—"}
          </Text>
        </View>
        <View style={[styles.gridItem, isMobile && styles.gridItemMobile]}>
          <Ionicons name="resize-outline" size={isMobile ? 12 : 16} color={PRIMARY} />
          <Text style={[styles.gridLabel, isMobile && styles.gridLabelMobile]}>Length</Text>
          <Text style={[styles.gridValue, isMobile && styles.gridValueMobile]}>
            {stall.length ?? "—"}
          </Text>
        </View>
      </View>

      <View style={[styles.rentBox, isMobile && styles.rentBoxMobile]}>
        <Text style={[styles.rentLabel, isMobile && styles.rentLabelMobile]}>RENT AMOUNT</Text>
        <Text style={[styles.rentValue, isMobile && styles.rentValueMobile]}>
          ₱{stall.price ?? "—"}/day
        </Text>
      </View>

      <View style={styles.actions}>
        {onViewOthers && (
          <TouchableOpacity
            style={[styles.viewOthersBtn, isMobile && styles.btnMobile]}
            onPress={onViewOthers}
          >
            <Text style={[styles.viewOthersBtnText, isMobile && styles.btnTextMobile]}>
              View Other Stalls
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.closeBtn, isMobile && styles.btnMobile]} onPress={onClose}>
          <Text style={[styles.closeBtnText, isMobile && styles.btnTextMobile]}>Close</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 24,
    width: "90%",
    maxWidth: 360,
    alignSelf: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 8,
  },
  cardMobile: {
    padding: 10,
    maxWidth: 280,
    borderRadius: 14,
  },
  closeIconBtn: {
    position: "absolute",
    top: 14,
    right: 14,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F2F1EC",
    zIndex: 1,
  },
  closeIconBtnMobile: { top: 8, right: 8, width: 20, height: 20, borderRadius: 10 },
  stallName: {
    fontSize: 18,
    fontWeight: "800",
    color: TEXT_DARK,
    marginBottom: 8,
    paddingRight: 28,
  },
  stallNameMobile: { fontSize: 13, marginBottom: 1, paddingRight: 22 },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 20,
    marginBottom: 18,
  },
  statusPillMobile: { marginBottom: 4, paddingVertical: 2, paddingHorizontal: 7 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: "700" },

  grid: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  gridMobile: { gap: 4, marginBottom: 4 },
  gridItem: {
    flex: 1,
    backgroundColor: "#FAFAF8",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
    gap: 4,
  },
  gridItemMobile: { paddingVertical: 5, paddingHorizontal: 4, borderRadius: 8, gap: 1 },
  gridLabel: { fontSize: 11, color: TEXT_MUTED, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  gridLabelMobile: { fontSize: 8, letterSpacing: 0.2 },
  gridValue: { fontSize: 14, color: TEXT_DARK, fontWeight: "700" },
  gridValueMobile: { fontSize: 12 },

  rentBox: {
    backgroundColor: ACCENT_TINT,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    marginBottom: 20,
  },
  rentBoxMobile: { paddingVertical: 5, marginBottom: 6, borderRadius: 8 },
  rentLabel: { fontSize: 11, color: TEXT_MUTED, fontWeight: "700", letterSpacing: 0.6, marginBottom: 4 },
  rentLabelMobile: { fontSize: 9, marginBottom: 2 },
  rentValue: { fontSize: 22, fontWeight: "800", color: ACCENT },
  rentValueMobile: { fontSize: 15 },

  actions: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
  },
  viewOthersBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: PRIMARY,
    borderRadius: 24,
  },
  viewOthersBtnText: { fontSize: 14, color: "#fff", fontWeight: "700" },
  btnMobile: { paddingVertical: 7 },
  btnTextMobile: { fontSize: 11 },
  closeBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 24,
  },
  closeBtnText: { fontSize: 14, color: TEXT_DARK, fontWeight: "600" },
});
