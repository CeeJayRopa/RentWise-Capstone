import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
} from "react-native";
import { useEffect, useState } from "react";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import StallDetails from "../../app/stall-details";
import StallPopup from "./StallPopup";
import { getStalls } from "../../services/stallService";
import { MARKET_LAYOUT, normalizeStallName } from "../constants/marketLayout";

// Same blueprint asset/geometry as app/market-map.tsx, but sized to sit inline
// inside a page section instead of filling the whole screen — no header/back
// button, no viewport-height fitting, just a responsive width-based render.
// Must match assets/market-2Dlayout.png's real pixel dimensions (1048x672) —
// any mismatch here makes resizeMode="contain" letterbox the image inside
// the container instead of filling it, showing up as a gap on the sides.
const BLUEPRINT_ASPECT_RATIO = 1048 / 672;
const MIN_BLUEPRINT_WIDTH = 700;
const HOTSPOT_SHRINK = 0.94;
const MAP_CARD_BORDER_WIDTH = 1;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

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
  maxWidth?: number;
  eyebrow?: string;
  title?: string;
  description?: string;
}

const PRIMARY = "#0E7C5A";
const PRIMARY_DARK = "#0B6247";
const TEXT_DARK = "#171A19";
const TEXT_MUTED = "#5B6560";
const CARD_BG = "#F4F8F5";

export default function MarketMapEmbed({ maxWidth = 620, eyebrow, title, description }: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const isMobile = windowWidth <= 480;
  // Below ~980 there isn't room for a 300px text column + the map's own
  // readable floor side by side, so the split layout collapses to a single
  // stacked column (text above, map below) instead.
  const isSplit = windowWidth > 980;
  // Split mode: the map column only has whatever's left of the window after
  // the outer card's padding + the fixed-width text column + its gap.
  const CARD_CHROME = 36 * 2 + 300 + 48;
  const available = isSplit ? windowWidth - CARD_CHROME : windowWidth - 32;
  // On phones, don't force the desktop-readability floor — let the map
  // shrink to fit so the whole layout is visible without horizontal
  // scrolling by default (tablet/desktop keep the floor since they have
  // the width to spare and benefit from the extra legibility).
  const blueprintWidth =
    isMobile || isSplit
      ? Math.min(available, maxWidth)
      : Math.max(MIN_BLUEPRINT_WIDTH, Math.min(available, maxWidth));
  const blueprintHeight = blueprintWidth / BLUEPRINT_ASPECT_RATIO;

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

  const blueprintContent = (
    <View
      style={[
        styles.blueprintContainer,
        { width: blueprintWidth, height: blueprintHeight },
      ]}
    >
      <Image
        source={require("../../assets/market-2Dlayout.png")}
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

          // Only rotated hotspots risk overlapping a neighbor — see
          // app/market-map.tsx for the fuller rationale, unchanged here.
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
  );

  const actions = (
    <View style={styles.actionCol}>
      <TouchableOpacity style={styles.actionBtnPrimary} onPress={() => setShowVacant(true)}>
        <Ionicons name="eye-outline" size={16} color="#fff" />
        <Text style={styles.actionBtnPrimaryText}>Vacant Stalls</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.actionBtnOutline} onPress={() => router.push("/ar-view")}>
        <Ionicons name="sparkles-outline" size={16} color={PRIMARY_DARK} />
        <Text style={styles.actionBtnOutlineText}>AR Viewing</Text>
      </TouchableOpacity>
    </View>
  );

  const textCol = (
    <View style={[styles.textCol, !isSplit && styles.textColStacked]}>
      {eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
      {title && <Text style={styles.blueprintTitle}>{title}</Text>}
      {description && <Text style={styles.blueprintDesc}>{description}</Text>}
      {actions}
    </View>
  );

  const mapColumn = (
    <View style={[styles.mapCol, !isSplit && styles.mapColStacked]}>
      <View style={styles.mapCardOuter}>
        <View style={styles.mapCard}>
          {Platform.OS === "web" ? (
            <TransformWrapper
              // react-zoom-pan-pinch's centerOnInit only ever runs once, the
              // moment this component first mounts -- on web, windowWidth
              // (and therefore blueprintWidth) can still read a stale/wrong
              // value on that very first render before hydration settles to
              // the real viewport size, especially on phones. When that
              // happens, centerOnInit computes its centering offset against
              // the WRONG size and never gets a chance to redo it once the
              // real size arrives a moment later, panning the content
              // off-center so one edge renders outside the clipped wrapper
              // bounds -- the "map looks cut off" symptom. Keying on the
              // final computed size forces a clean remount (and a fresh
              // centerOnInit) whenever it actually changes, instead of
              // trusting the library to notice on its own.
              key={`${Math.round(blueprintWidth)}x${Math.round(blueprintHeight)}`}
              initialScale={MIN_ZOOM}
              minScale={MIN_ZOOM}
              maxScale={MAX_ZOOM}
              centerOnInit
              limitToBounds
              // Without this, the library allows dragging up to 100% of the
              // wrapper size PAST the content's real edge (an elastic
              // "rubber-band" overscroll that only snaps back on release) —
              // that's what was showing as white space while actively
              // dragging. Zeroing it out makes the boundary rigid: panning
              // simply stops at the content edge, no overscroll at all.
              autoAlignment={{ sizeX: 0, sizeY: 0 }}
              doubleClick={{ mode: "toggle" }}
              wheel={{ step: 0.2 }}
              pinch={{ step: 5 }}
              panning={{ velocityDisabled: true }}
            >
              {({ resetTransform }) => (
                <>
                  {/* contentStyle deliberately omitted — sizing it to the same
                      fixed dimensions as wrapperStyle let the two drift out of
                      sync during a live gesture, which let panning escape the
                      map's actual bounds. Content sizes itself naturally from
                      blueprintContent's own width/height instead. Panning at
                      1x is a no-op on its own: limitToBounds + content being
                      exactly wrapper-sized there means there's nowhere to pan
                      to, so no need to actively disable it via state. */}
                  {/* Rounding + clipping here too (not just on the parent
                      mapCard) -- this is the actual DOM node whose bounds
                      define the pan/zoom viewport, so relying only on an
                      ancestor's overflow:hidden left the square corners of
                      the content poking past the card's rounded ones. */}
                  <TransformComponent
                    wrapperStyle={{
                      width: blueprintWidth,
                      height: blueprintHeight,
                      borderRadius: 18,
                      overflow: "hidden",
                    }}
                  >
                    {blueprintContent}
                  </TransformComponent>

                  <TouchableOpacity
                    style={styles.resetZoomBtn}
                    onPress={() => resetTransform()}
                    accessibilityLabel="Reset zoom"
                  >
                    <Ionicons name="refresh" size={16} color="#0E7C5A" />
                  </TouchableOpacity>
                </>
              )}
            </TransformWrapper>
          ) : (
            <ScrollView
              horizontal
              contentContainerStyle={styles.hScroll}
              showsHorizontalScrollIndicator={false}
            >
              {blueprintContent}
            </ScrollView>
          )}
        </View>

        {(selectedStall || showVacant) && (
          <View style={styles.popupOverlay}>
            <ScrollView
              style={styles.popupScroll}
              contentContainerStyle={styles.popupScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {selectedStall && (
                <StallPopup
                  stall={selectedStall}
                  onClose={() => setSelectedStall(null)}
                  onViewOthers={() => {
                    setSelectedStall(null);
                    setShowVacant(true);
                  }}
                />
              )}
              {showVacant && <StallDetails onClose={() => setShowVacant(false)} />}
            </ScrollView>
          </View>
        )}
      </View>

      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={styles.legendSwatchOccupied} />
          <Text style={styles.legendLabel}>Occupied</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={styles.legendSwatchVacant} />
          <Text style={styles.legendLabel}>Vacant</Text>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.wrap}>
      <View style={[styles.card, isSplit ? styles.cardSplit : styles.cardStacked]}>
        {textCol}
        {mapColumn}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", alignItems: "center" },
  card: {
    width: "100%",
    maxWidth: 1180,
    backgroundColor: "#FFFFFF",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "#EAEEE9",
    padding: 36,
  },
  cardSplit: { flexDirection: "row", alignItems: "flex-start", gap: 48 },
  cardStacked: { flexDirection: "column", padding: 24, gap: 28 },
  textCol: { width: 300, flexShrink: 0 },
  textColStacked: { width: "100%" },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
    color: TEXT_MUTED,
    marginBottom: 10,
  },
  blueprintTitle: {
    fontSize: 30,
    fontWeight: "800",
    color: TEXT_DARK,
    marginBottom: 14,
  },
  blueprintDesc: {
    fontSize: 15,
    lineHeight: 22,
    color: TEXT_MUTED,
    marginBottom: 24,
  },
  actionCol: { gap: 12 },
  actionBtnPrimary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    backgroundColor: PRIMARY_DARK,
    borderRadius: 28,
  },
  actionBtnPrimaryText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  actionBtnOutline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    backgroundColor: "#fff",
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: "#D9E0DB",
  },
  actionBtnOutlineText: { color: PRIMARY_DARK, fontSize: 15, fontWeight: "700" },
  mapCol: { flex: 1, minWidth: 0, alignItems: "center" },
  mapColStacked: { width: "100%" },
  legendRow: {
    flexDirection: "row",
    gap: 20,
    marginTop: 16,
    alignSelf: "flex-start",
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendSwatchOccupied: {
    width: 12,
    height: 12,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: "#C9D1CB",
    backgroundColor: "#fff",
  },
  legendSwatchVacant: {
    width: 12,
    height: 12,
    borderRadius: 3,
    backgroundColor: "rgba(76,175,80,0.55)",
  },
  legendLabel: { fontSize: 12.5, color: TEXT_MUTED, fontWeight: "600" },
  mapCardOuter: {
    position: "relative",
    alignSelf: "center",
    width: "100%",
    borderRadius: 18,
    // Clips the popup to the map card's own box — it should never visually
    // spill onto the "Vacant Stalls"/"AR Viewing" buttons below.
    overflow: "hidden",
  },
  mapCard: {
    alignSelf: "center",
    borderWidth: MAP_CARD_BORDER_WIDTH,
    borderStyle: "solid",
    borderColor: "#E4E8E5",
    borderRadius: 18,
    padding: 0,
    overflow: "hidden",
    backgroundColor: CARD_BG,
  },
  hScroll: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  blueprintContainer: {
    position: "relative",
    borderRadius: 16,
    overflow: "hidden",
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
    backgroundColor: "rgba(212,212,212,0.6)",
  },
  hotspot: {
    position: "absolute",
  },
  resetZoomBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7E5DE",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  popupOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.3)",
    borderRadius: 20,
    padding: 16,
    zIndex: 500,
  },
  // Scrollable so a popup taller than the map card's own height stays fully
  // reachable (scroll to see the rest) instead of getting clipped or
  // spilling out over the buttons below.
  popupScroll: { width: "100%", flex: 1 },
  popupScrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
  },
});
