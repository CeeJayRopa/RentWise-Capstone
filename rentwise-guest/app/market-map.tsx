import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { useEffect, useState } from "react";
import { router } from "expo-router";
import StallDetails from "./stall-details";
import StallPopup from "../shared/components/StallPopup";
import { getStalls } from "../services/stallService";
import { MARKET_LAYOUT, normalizeStallName } from "../shared/constants/marketLayout";

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
  spaceDimension?: string;
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
                            ? "rgba(76,175,80,0.35)"
                            : isVacant === false
                            ? "rgba(198,40,40,0.35)"
                            : "rgba(120,120,120,0.25)",
                      },
                    ]}
                    onPress={() =>
                      setSelectedStall(stall ?? { id: hotspot.name, name: hotspot.name, status: "Unknown" })
                    }
                  />
                );
              })
            )}
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
