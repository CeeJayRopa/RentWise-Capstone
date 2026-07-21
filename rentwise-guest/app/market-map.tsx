import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
  Animated,
  Platform,
} from "react-native";
import { useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import StallDetails from "./stall-details";
import StallPopup from "../shared/components/StallPopup";
import { getStalls } from "../services/stallService";
import { MARKET_LAYOUT, normalizeStallName, StallHotspot } from "../shared/constants/marketLayout";

// Matches the blueprint's real pixel size (assets/market-2Dlayout.png) so hotspot
// percentages line up correctly regardless of screen width.
const BLUEPRINT_ASPECT_RATIO = 1053 / 708;
// The blueprint's rendered size fills the available screen space (so there's no big empty
// margin), but stays within a sensible range: never smaller than 700 wide (below that,
// individual stalls get too small to tap — horizontal scroll takes over instead of shrinking
// further), never bigger than 1400 (avoids an absurdly huge render on ultra-wide monitors).
const MIN_BLUEPRINT_WIDTH = 700;
const MAX_BLUEPRINT_WIDTH = 1600;
// Actual height taken up by the header and bottom action bar (matches their real styled
// sizes below, not padded with extra buffer), so sizing can fit the blueprint into the space
// actually left over — without this, a wide landscape image can fit the screen's *width*
// fine but still overflow its *height*, forcing a scroll/zoom-out to see the whole thing.
const HEADER_HEIGHT = 84;
const BOTTOM_BAR_HEIGHT = 78;
const SCREEN_PADDING = 12;
// Hotspots are rendered slightly smaller than their measured size (same center) so rotated
// boxes never touch/overlap a neighbor — an overlap would double up their semi-transparent
// fill into a visibly darker seam where they combine.
const HOTSPOT_SHRINK = 0.94;

interface Stall {
  id: string;
  name?: string;
  status?: string;
  buildingNumber?: string;
  category?: string;
  spaceDimension?: string;
  width?: number;
  length?: number;
  price?: number;
}

export default function MarketMap() {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const availableWidth = windowWidth - SCREEN_PADDING;
  const availableHeight = windowHeight - HEADER_HEIGHT - BOTTOM_BAR_HEIGHT - SCREEN_PADDING;
  // Fit within BOTH the available width and height (like resizeMode="contain" applied to the
  // whole layout area), then clamp to the min/max range.
  const widthConstrainedByHeight = availableHeight * BLUEPRINT_ASPECT_RATIO;
  const blueprintWidth = Math.max(
    MIN_BLUEPRINT_WIDTH,
    Math.min(availableWidth, widthConstrainedByHeight, MAX_BLUEPRINT_WIDTH)
  );

  const [showVacant, setShowVacant] = useState(false);
  const [stalls, setStalls] = useState<Stall[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStall, setSelectedStall] = useState<Stall | null>(null);

  // Mouse-hover tooltip (web only — native has no hover concept, so
  // hoveredStall simply never gets set on those platforms since the
  // onMouseEnter/onMouseLeave handlers below are only attached on web).
  const [hoveredStall, setHoveredStall] = useState<{
    hotspot: StallHotspot;
    stall: Stall | null;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const hoverAnim = useRef(new Animated.Value(0)).current;

  const handleHoverIn = (
    hotspot: StallHotspot,
    stall: Stall | null,
    left: number,
    top: number,
    width: number,
    height: number
  ) => {
    setHoveredStall({ hotspot, stall, left, top, width, height });
    hoverAnim.stopAnimation();
    Animated.timing(hoverAnim, { toValue: 1, duration: 160, useNativeDriver: true }).start();
  };
  const handleHoverOut = () => {
    Animated.timing(hoverAnim, { toValue: 0, duration: 120, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setHoveredStall(null);
    });
  };

  useEffect(() => {
    getStalls()
      .then((data) => setStalls(data as Stall[]))
      .finally(() => setLoading(false));
  }, []);

  const stallsByName = new Map(stalls.map((s) => [normalizeStallName(s.name ?? ""), s]));

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          style={styles.backBtn}
        >
          <Text style={styles.backIcon}>◀</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>2D Market View</Text>
        <View style={styles.backBtn} />
      </View>

      {/* Blueprint area */}
      <ScrollView contentContainerStyle={styles.verticalScrollContent}>
        <ScrollView horizontal contentContainerStyle={styles.horizontalScrollContent}>
          <View
            style={[
              styles.blueprintContainer,
              { width: blueprintWidth, height: blueprintWidth / BLUEPRINT_ASPECT_RATIO },
            ]}
          >
            <Image
              source={require("../assets/market-2Dlayout.png")}
              style={styles.blueprintImage}
              resizeMode="contain"
            />

            {loading ? (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="small" color="#555" />
              </View>
            ) : (
              MARKET_LAYOUT.map((hotspot, index) => {
                const stall = stallsByName.get(normalizeStallName(hotspot.name));
                const isVacant = stall ? stall.status?.toLowerCase() !== "occupied" : null;

                // Only rotated hotspots risk overlapping a neighbor (which would stack their
                // semi-transparent fills into a visible dark seam) — axis-aligned ones were
                // measured to fit edge-to-edge already, so leave those at exact size/position.
                const shrink = hotspot.rotationDeg ? HOTSPOT_SHRINK : 1;
                const width = hotspot.widthPct * shrink;
                const height = hotspot.heightPct * shrink;
                const left = hotspot.xPct + (hotspot.widthPct - width) / 2;
                const top = hotspot.yPct + (hotspot.heightPct - height) / 2;

                return (
                  <TouchableOpacity
                    key={`${hotspot.name}-${index}`}
                    style={[
                      styles.hotspot,
                      {
                        left: `${left}%`,
                        top: `${top}%`,
                        width: `${width}%`,
                        height: `${height}%`,
                        transform: hotspot.rotationDeg ? [{ rotate: `${hotspot.rotationDeg}deg` }] : undefined,
                        backgroundColor:
                          isVacant === true
                            ? "rgba(76,175,80,0.55)"
                            : isVacant === false
                            ? "rgba(198,40,40,0.55)"
                            : "rgba(120,120,120,0.4)",
                      },
                    ]}
                    onPress={() =>
                      setSelectedStall(stall ?? { id: hotspot.name, name: hotspot.name, status: "Unknown" })
                    }
                    {...(Platform.OS === "web"
                      ? {
                          onMouseEnter: () => handleHoverIn(hotspot, stall ?? null, left, top, width, height),
                          onMouseLeave: handleHoverOut,
                        }
                      : {})}
                  />
                );
              })
            )}

            {hoveredStall && (() => {
              const hs = hoveredStall.stall;
              const isVac = hs ? hs.status?.toLowerCase() !== "occupied" : null;
              const statusColor = isVac === true ? "#0E7C5A" : isVac === false ? "#C0392B" : "#787878";
              const statusTint = isVac === true ? "#E4F3EC" : isVac === false ? "#FBEAE8" : "#EFEFEF";
              const statusLabel = isVac === true ? "Vacant" : isVac === false ? "Occupied" : "Unknown";
              // Most stalls open their tooltip above them (placement "top", the
              // default). The diagonal row sits right at the blueprint's top
              // edge though, so those are flagged "bottom": anchored at the
              // stall's BOTTOM edge instead, card dropping down below it.
              const placement = hoveredStall.hotspot.tooltipPlacement ?? "top";
              const anchorTop = placement === "bottom" ? hoveredStall.top + hoveredStall.height : hoveredStall.top;
              return (
                <View
                  pointerEvents="none"
                  style={[
                    styles.hoverTooltipAnchor,
                    {
                      left: `${hoveredStall.left + hoveredStall.width / 2}%`,
                      top: `${anchorTop}%`,
                      transform:
                        placement === "bottom"
                          ? [{ translateX: "-50%" as any }, { translateY: 12 }]
                          : [{ translateX: "-50%" as any }, { translateY: "-100%" as any }, { translateY: -12 }],
                    },
                  ]}
                >
                  <Animated.View
                    style={[
                      styles.hoverCardWrap,
                      {
                        opacity: hoverAnim,
                        transform: [
                          { translateY: hoverAnim.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) },
                          { scale: hoverAnim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
                        ],
                      },
                    ]}
                  >
                    {placement === "bottom" && <View style={styles.hoverCaretUp} />}
                    <View style={styles.hoverCard}>
                      <View style={[styles.hoverStatusPill, { backgroundColor: statusTint }]}>
                        <View style={[styles.hoverStatusDot, { backgroundColor: statusColor }]} />
                        <Text style={[styles.hoverStatusText, { color: statusColor }]}>{statusLabel}</Text>
                      </View>

                      <Text style={styles.hoverCategory}>{hs?.category || "—"}</Text>

                      <View style={styles.hoverDimsRow}>
                        <View style={styles.hoverDimsItem}>
                          <Text style={styles.hoverDimsLabel}>LENGTH</Text>
                          <Text style={styles.hoverDimsValue}>{hs?.length ?? "—"}</Text>
                        </View>
                        <View style={styles.hoverDimsDivider} />
                        <View style={styles.hoverDimsItem}>
                          <Text style={styles.hoverDimsLabel}>WIDTH</Text>
                          <Text style={styles.hoverDimsValue}>{hs?.width ?? "—"}</Text>
                        </View>
                      </View>
                    </View>
                    {placement !== "bottom" && <View style={styles.hoverCaret} />}
                  </Animated.View>
                </View>
              );
            })()}
          </View>
        </ScrollView>
      </ScrollView>

      {/* Tapped-stall popup */}
      {selectedStall && (
        <View style={styles.popupOverlay}>
          <StallPopup stall={selectedStall} onClose={() => setSelectedStall(null)} />
        </View>
      )}

      {/* Cycle-through-vacant-stalls popup (existing behavior, unchanged) */}
      {showVacant && (
        <View style={styles.popupOverlay}>
          <StallDetails onClose={() => setShowVacant(false)} />
        </View>
      )}

      {/* Bottom buttons */}
      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => setShowVacant(true)}>
          <Text style={styles.actionBtnText}>Vacant Stalls</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={() => router.push("/ar-view")}>
          <Text style={styles.actionBtnText}>AR Viewing</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },

  /* Header */
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1a1a1a",
    paddingHorizontal: 16,
    paddingVertical: 14,
    paddingTop: 48,
  },
  backBtn: { width: 36, alignItems: "center" },
  backIcon: { color: "#fff", fontSize: 20 },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "bold" },

  /* Blueprint */
  verticalScrollContent: { flexGrow: 1, backgroundColor: "#d4d4d4" },
  horizontalScrollContent: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  blueprintContainer: {
    position: "relative",
  },
  blueprintImage: { width: "100%", height: "100%" },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  hotspot: {
    position: "absolute",
  },

  /* Hover tooltip (web only) — transform (position + placement) computed
     inline per-render, see the hoveredStall block above. */
  hoverTooltipAnchor: {
    position: "absolute",
    zIndex: 60,
  },
  hoverCardWrap: { alignItems: "center" },
  hoverCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    minWidth: 138,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 14,
    elevation: 8,
  },
  hoverCaret: {
    width: 0,
    height: 0,
    marginTop: -1,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 8,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "#fff",
  },
  // Same triangle, pointing up instead — used for "bottom" placement
  // tooltips (the diagonal row), where the card sits below the stall and
  // the caret needs to point back up at it instead of down away from it.
  hoverCaretUp: {
    width: 0,
    height: 0,
    marginBottom: -1,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderBottomWidth: 8,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#fff",
  },
  hoverStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 20,
    marginBottom: 8,
  },
  hoverStatusDot: { width: 6, height: 6, borderRadius: 3 },
  hoverStatusText: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.3 },
  hoverCategory: {
    fontSize: 14,
    fontWeight: "800",
    color: "#171A19",
    marginBottom: 10,
    textAlign: "center",
  },
  hoverDimsRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FAFAF8",
    borderRadius: 10,
    paddingVertical: 7,
    width: "100%",
  },
  hoverDimsItem: { flex: 1, alignItems: "center" },
  hoverDimsDivider: { width: 1, height: 22, backgroundColor: "#E7E5DE" },
  hoverDimsLabel: { fontSize: 8.5, fontWeight: "700", color: "#8A928C", letterSpacing: 0.5, marginBottom: 2 },
  hoverDimsValue: { fontSize: 13, fontWeight: "800", color: "#171A19" },

  /* Popups */
  popupOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
  },

  /* Bottom bar */
  bottomBar: {
    flexDirection: "row",
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: "#fff",
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 14,
    backgroundColor: "#5a9e6f",
    borderRadius: 24,
    alignItems: "center",
  },
  actionBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
