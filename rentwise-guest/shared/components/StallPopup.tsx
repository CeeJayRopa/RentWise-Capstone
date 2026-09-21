import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";

const PRIMARY = "#0E7C5A";
const OCCUPIED = "#C0392B";
const TEXT_DARK = "#252826";
const TEXT_MUTED = "#6B716D";
const BORDER = "#E4E7E2";

interface Stall {
  id: string;
  name?: string;
  status?: string;
  buildingNumber?: string;
  category?: string;
  marketType?: string;
  spaceDimension?: string;
  width?: number;
  length?: number;
  price?: number;
}

interface Props {
  stall: Stall;
  onClose: () => void;
  onViewOthers?: () => void;
  // Paint-only rotation used by the existing mobile/tablet map layout.
  rotate90?: boolean;
  showClose?: boolean;
  tooltip?: boolean;
  caretPlacement?: "top" | "bottom";
}

function formatCategory(category?: string): string {
  if (!category) return "Market Stall";
  return category
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function marketLabel(stall: Stall): string {
  if (stall.marketType) return formatCategory(stall.marketType);
  const building = String(stall.buildingNumber ?? stall.name ?? "");
  if (/(?:^|\b)B(?:uilding)?\s*[- ]?\s*1(?:\b|$)/i.test(building)) return "Wet Market";
  if (/(?:^|\b)B(?:uilding)?\s*[- ]?\s*2(?:\b|$)/i.test(building)) return "Dry Market";
  return formatCategory(stall.category);
}

export default function StallPopup({
  stall,
  onClose,
  rotate90,
  showClose = true,
  tooltip = false,
  caretPlacement = "bottom",
}: Props) {
  const { width } = useWindowDimensions();
  const isMobile = width <= 480;
  const isVacant = stall.status?.trim().toLowerCase() !== "occupied";
  const statusColor = isVacant ? PRIMARY : OCCUPIED;
  const formattedPrice =
    typeof stall.price === "number" ? stall.price.toLocaleString("en-PH") : "—";

  return (
    <View style={[
      styles.card,
      isMobile && styles.cardMobile,
      tooltip && styles.cardTooltip,
      rotate90 && { transform: [{ rotate: "90deg" }] },
    ]}>
      {showClose && <TouchableOpacity
        style={[styles.closeIconBtn, isMobile && styles.closeIconBtnMobile]}
        onPress={onClose}
        hitSlop={8}
        accessibilityLabel="Close stall details"
      >
        <Ionicons name="close" size={isMobile ? 13 : 16} color={TEXT_MUTED} />
      </TouchableOpacity>}

      <View style={styles.headerRow}>
        <View style={styles.statusRow}>
          <View style={[styles.dotHalo, { backgroundColor: `${statusColor}24` }]}>
            <View style={[styles.dot, { backgroundColor: statusColor }]} />
          </View>
          <Text style={[styles.statusText, isMobile && styles.statusTextMobile, { color: statusColor }]}>
            {isVacant ? "Vacant" : "Occupied"}
          </Text>
        </View>
        <Text style={[styles.categoryText, isMobile && styles.categoryTextMobile]} numberOfLines={1}>
          {marketLabel(stall)}
        </Text>
      </View>

      <View style={[styles.rentBox, isMobile && styles.rentBoxMobile]}>
        <Text style={[styles.rentLabel, isMobile && styles.rentLabelMobile]}>Market rental</Text>
        <View style={styles.rentValueRow}>
          <Text style={[styles.rentValue, isMobile && styles.rentValueMobile]}>₱{formattedPrice}</Text>
          <Text style={[styles.rentUnit, isMobile && styles.rentUnitMobile]}>/ day</Text>
        </View>
      </View>

      <View style={[styles.dimensionsRow, isMobile && styles.dimensionsRowMobile]}>
        <View style={styles.dimensionItem}>
          <Text style={[styles.dimensionLabel, isMobile && styles.dimensionLabelMobile]}>Length</Text>
          <Text style={[styles.dimensionValue, isMobile && styles.dimensionValueMobile]}>{stall.length ?? "—"}</Text>
        </View>
        <View style={styles.dimensionDivider} />
        <View style={styles.dimensionItem}>
          <Text style={[styles.dimensionLabel, isMobile && styles.dimensionLabelMobile]}>Width</Text>
          <Text style={[styles.dimensionValue, isMobile && styles.dimensionValueMobile]}>{stall.width ?? "—"}</Text>
        </View>
      </View>

      <View style={caretPlacement === "top" ? styles.caretTop : styles.caret} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 24,
    width: "90%",
    maxWidth: 360,
    alignSelf: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 8,
  },
  cardMobile: { padding: 16, maxWidth: 280, borderRadius: 18 },
  cardTooltip: { width: 320, maxWidth: 320 },
  closeIconBtn: {
    position: "absolute",
    top: -9,
    right: -9,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: BORDER,
    zIndex: 2,
  },
  closeIconBtnMobile: { top: -7, right: -7, width: 22, height: 22, borderRadius: 11 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  dotHalo: {
    width: 15,
    height: 15,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 16, fontWeight: "700" },
  statusTextMobile: { fontSize: 13 },
  categoryText: {
    flexShrink: 1,
    fontSize: 18,
    color: TEXT_DARK,
    fontWeight: "800",
    marginLeft: 12,
  },
  categoryTextMobile: { fontSize: 14 },
  rentBox: {
    backgroundColor: "#F7F8F6",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 13,
    paddingVertical: 15,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  rentBoxMobile: { paddingVertical: 11, paddingHorizontal: 12, marginBottom: 13, borderRadius: 10 },
  rentLabel: { fontSize: 13, color: TEXT_MUTED, fontWeight: "700" },
  rentLabelMobile: { fontSize: 10 },
  rentValueRow: { flexDirection: "row", alignItems: "baseline", gap: 5 },
  rentValue: { fontSize: 20, fontWeight: "800", color: TEXT_DARK },
  rentValueMobile: { fontSize: 16 },
  rentUnit: { fontSize: 12, color: TEXT_MUTED, fontWeight: "700" },
  rentUnitMobile: { fontSize: 9 },
  dimensionsRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 28 },
  dimensionsRowMobile: { paddingHorizontal: 12 },
  dimensionItem: { flex: 1, alignItems: "center" },
  dimensionDivider: { width: 1, height: 42, backgroundColor: BORDER },
  dimensionLabel: {
    fontSize: 10,
    color: "#90938F",
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  dimensionLabelMobile: { fontSize: 8, letterSpacing: 1 },
  dimensionValue: { fontSize: 20, color: TEXT_DARK, fontWeight: "800", marginTop: 4 },
  dimensionValueMobile: { fontSize: 16, marginTop: 2 },
  caret: {
    position: "absolute",
    bottom: -10,
    left: "50%",
    marginLeft: -10,
    width: 20,
    height: 20,
    backgroundColor: "#FFFFFF",
    transform: [{ rotate: "45deg" }],
  },
  caretTop: {
    position: "absolute",
    top: -10,
    left: "50%",
    marginLeft: -10,
    width: 20,
    height: 20,
    backgroundColor: "#FFFFFF",
    transform: [{ rotate: "45deg" }],
  },
});
