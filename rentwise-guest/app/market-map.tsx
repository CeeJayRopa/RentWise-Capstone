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
// Actual height taken up by the header (matches its real styled size below, not padded with
// extra buffer), so sizing can fit the blueprint into the space actually left over — without
// this, a wide landscape image can fit the screen's *width* fine but still overflow its
// *height*, forcing a scroll/zoom-out to see the whole thing.
const HEADER_HEIGHT = 84;
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
  // Matches the guest site's shared tablet range (rentwise-guest/shared/hooks/
  // useBreakpoints.ts).
  const isTabletRange = windowWidth > 480 && windowWidth <= 1024;
  const isMobile = windowWidth <= 480;
  // Tablet now shares mobile's whole header design (horizontal bar, rotated
  // Back button/Availability card/quote card as absolute overlays, map
  // below) instead of its old separate vertical right-edge strip -- every
  // isMobile-only branch below is now isMobileOrTablet instead.
  const isMobileOrTablet = isMobile || isTabletRange;
  // Every one of the header's overlay pixel values (Back button,
  // Availability card, quote card, title) was tuned by eye against a
  // 390px-wide screen -- at narrower widths those same flat values
  // overflowed/collided (e.g. a left:240 position on a 320px screen runs
  // off the edge), and at wider ones (including the whole tablet range,
  // now sharing this same design) they'd look comparatively tiny. Scaling
  // every one of them by this ratio keeps the 390px layout's proportions
  // intact at any width, mobile or tablet.
  const MOBILE_BASE_WIDTH = 390;
  // Tablet now gets its OWN reference width instead of reusing mobile's 390
  // baseline -- reusing it made tablet's scale come out to ~1.97x on the
  // 768-wide iPad just tested, blowing up every header offset/size well
  // past what was tuned to look right (that's why Back button/Availability
  // card/quote card were misaligned there). Two independent scale values,
  // and below, two independent style branches per header element, mean
  // tablet's numbers can now be tuned on their own without ever touching
  // mobile's.
  const TABLET_BASE_WIDTH = 768;
  const mobileScale = isMobile ? windowWidth / MOBILE_BASE_WIDTH : 1;
  const tabletScale = isTabletRange ? windowWidth / TABLET_BASE_WIDTH : 1;
  const scale = isMobile ? mobileScale : isTabletRange ? tabletScale : 1;
  // Real measured header height (see onLayout on the header below) instead
  // of the fixed HEADER_HEIGHT constant -- that constant was tuned against
  // desktop's header, but mobile/tablet's shrunk after the title stopped
  // wrapping to 2 lines, so the fixed value was now an over-estimate that
  // left the map smaller than the space actually available below the real
  // header.
  const [measuredHeaderHeight, setMeasuredHeaderHeight] = useState(HEADER_HEIGHT);
  // Mobile/tablet: measures the actual flex:1 area left below the header
  // directly (via onLayout on that wrapper, below) instead of
  // reconstructing it from windowHeight - headerHeight - padding -- that
  // arithmetic kept coming out a bit short of the real space, leaving
  // unexplained gray/blue gap under the map even after correcting the
  // header-height guess.
  const [measuredContentHeight, setMeasuredContentHeight] = useState(0);
  const availableWidth = windowWidth - SCREEN_PADDING;
  const availableHeight =
    isMobileOrTablet && measuredContentHeight > 0
      ? measuredContentHeight - SCREEN_PADDING
      : windowHeight - SCREEN_PADDING - measuredHeaderHeight;
  // Fit within BOTH the available width and height (like resizeMode="contain" applied to the
  // whole layout area), then clamp to the min/max range.
  const widthConstrainedByHeight = availableHeight * BLUEPRINT_ASPECT_RATIO;
  const blueprintWidth = Math.max(
    MIN_BLUEPRINT_WIDTH,
    Math.min(availableWidth, widthConstrainedByHeight, MAX_BLUEPRINT_WIDTH)
  );
  const blueprintHeight = blueprintWidth / BLUEPRINT_ASPECT_RATIO;

  // Tablet: the blueprint is rotated 90° to better fill a portrait screen
  // (the source image is landscape, portrait tablets are tall/narrow).
  // The pre-rotation box keeps the image's native landscape aspect ratio
  // (so resizeMode="contain" never letterboxes it) -- its width/height are
  // sized so that AFTER rotating, the visual footprint (width and height
  // swapped) fits the real available portrait space.
  // Cover-sized (Math.max) on mobile/tablet -- scales up to fill both
  // dimensions instead of leaving letterbox gaps. Desktop stays exact-fit
  // (Math.min): a "cover" variant was tried there too at one point (crop via
  // an outer overflow:hidden box), but cropping an oversized ROTATED child
  // through an overflow:hidden ancestor breaks tap hit-testing on web near
  // the cropped edge -- mobile/tablet avoid that by never clipping (the
  // overflow just spills visually instead), which desktop's row layout
  // doesn't have room to do safely.
  // Tablet-only shrink -- separate from mobile's sizing entirely, so tuning
  // this never touches the mobile map. Width and height must shrink by the
  // SAME ratio: the clickable stall hotspots are positioned as percentages
  // of this box, which only lines up with the rendered image when the
  // box's aspect ratio matches the image's native aspect ratio exactly. A
  // width-only shrink was tried and broke that match -- resizeMode=
  // "contain" then letterboxes the image away from the box's edges while
  // the (still full-box-sized) tap targets stay put, so stalls and their
  // clickable zones drift apart.
  const TABLET_MAP_SCALE = 0.9;
  const rotatedHeight = isMobile
    ? Math.max(availableWidth, availableHeight / BLUEPRINT_ASPECT_RATIO)
    : isTabletRange
    ? Math.max(availableWidth, availableHeight / BLUEPRINT_ASPECT_RATIO) * TABLET_MAP_SCALE
    : Math.min(availableWidth, availableHeight / BLUEPRINT_ASPECT_RATIO);
  const rotatedWidth = rotatedHeight * BLUEPRINT_ASPECT_RATIO;

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
  // Same binary occupied/vacant split used for the hotspot tint colors below
  // -- matches MarketMapEmbed.tsx's mobile Availability card, computed live
  // instead of hardcoded.
  const occupiedCount = stalls.filter((s) => s.status?.toLowerCase() === "occupied").length;
  const vacantCount = stalls.length - occupiedCount;

  // Tablet renders this without any ScrollView (see below) -- ScrollView is
  // an overflow container under the hood, and an overflow ancestor clipping
  // this ROTATED subtree was breaking tap hit-testing on web for hotspots
  // near the clipped edge. Tablet's map is sized to exactly fit the screen
  // already, so it never needed to scroll in the first place.
  const blueprintArea = (
    <>
      {/* Mobile/tablet: an outer wrapper reserves the ROTATED visual
          footprint (width/height swapped from the blueprint's own native
          landscape box), and the blueprint itself rotates 90° inside
          it -- rotating a view doesn't change how much layout space it
          reserves, only how it's painted, so without this wrapper the
          rotated content would overflow/misalign instead of fitting the
          portrait screen. Sized to the cover-scaled rotatedHeight/
          rotatedWidth (not availableWidth/availableHeight) since the map
          is cover-sized bigger than the raw available space above. */}
      <View
        style={
          isMobile
            ? {
                width: rotatedHeight,
                height: rotatedWidth,
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
                top: 10 * mobileScale,
              }
            : isTabletRange
            ? {
                width: rotatedHeight,
                height: rotatedWidth,
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
                top: 0 * tabletScale,
                left: -45 * tabletScale,
                // TEMP DEBUG -- red tint so the box's real edges/position
                // are visible; remove once we've confirmed edits are
                // actually reaching the browser.
                backgroundColor: isTabletRange ? "rgba(255,0,0,0.35)" : undefined,
              }
            : undefined
        }
      >
      <View
        style={[
          styles.blueprintContainer,
          isMobileOrTablet
            ? {
                width: rotatedWidth,
                height: rotatedHeight,
                transform: [{ rotate: "90deg" }],
              }
            : { width: blueprintWidth, height: blueprintHeight },
        ]}
      >
        <Image
          source={require("../assets/market-2Dlayout.png")}
          // Corner radius lives directly on the Image (not a wrapping
          // overflow:hidden View) -- an overflow:hidden ancestor
          // clipping this ROTATED box was breaking tap hit-testing on
          // web for hotspots near the clipped edge, even after the
          // clip and the rotation were moved onto the same element.
          // Image supports borderRadius natively with no clipping
          // ancestor involved, so this sidesteps that entirely.
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
                    // Matches MarketMapEmbed's 2-color scheme (see that
                    // file for why): occupied is green, vacant/unknown
                    // both share the neutral grey.
                    backgroundColor:
                      isVacant === false
                        ? "rgba(76,175,80,0.3)"
                        : "rgba(120,120,120,0.15)",
                  },
                ]}
                onPress={() => {
                  setSelectedStall(stall ?? { id: hotspot.name, name: hotspot.name, status: "Unknown" });
                  // The hover tooltip and the tapped popup showing at once
                  // reads as a bug, not two features -- hide the tooltip
                  // the moment a stall is tapped, on every resolution.
                  setHoveredStall(null);
                }}
                {...(Platform.OS === "web" && !isMobile
                  ? {
                      onMouseEnter: () => handleHoverIn(hotspot, stall ?? null, left, top, width, height),
                      onMouseLeave: handleHoverOut,
                    }
                  : {})}
              />
            );
          })
        )}

        {hoveredStall && !selectedStall && (() => {
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
              style={[
                styles.hoverTooltipAnchor,
                {
                  left: `${hoveredStall.left + hoveredStall.width / 2}%`,
                  top: `${anchorTop}%`,
                  transform:
                    placement === "bottom"
                      ? [{ translateX: "-50%" as any }, { translateY: 12 }]
                      : [{ translateX: "-50%" as any }, { translateY: "-100%" as any }, { translateY: -12 }],
                  // props.pointerEvents is deprecated on this RN Web version
                  // (it stopped actually passing clicks through) -- this
                  // invisible full-tooltip anchor View was silently eating
                  // clicks meant for whatever stall it happened to overlap.
                  pointerEvents: "none" as any,
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
      </View>
    </>
  );

  return (
    <View style={styles.screen}>
      {/* Header (horizontal bar on top) -- every breakpoint now, mobile and
          tablet included (tablet's old vertical right-edge strip is gone,
          replaced by this same design). */}
      <View
        style={[styles.header, isMobileOrTablet && { position: "relative", zIndex: 20 }]}
        onLayout={(e) => setMeasuredHeaderHeight(e.nativeEvent.layout.height)}
      >
          <TouchableOpacity
            style={[
              styles.backBtnPill,
              // Absolute (not just relative) -- a relative offset still
              // reserves its ORIGINAL size in the header's flow, so
              // resizing the button was resizing the header (and thus
              // measuredHeaderHeight, and thus the map below it) too.
              // Taking it out of flow entirely means the button can be
              // resized freely without touching the map's sizing. Mobile
              // and tablet are separate branches (not one isMobileOrTablet
              // block sharing a single scale) so each can be tuned on its
              // own numbers going forward.
              isMobile && {
                position: "absolute",
                right: 16 * mobileScale,
                top: 18 * mobileScale,
                paddingHorizontal: 3 * mobileScale,
                paddingVertical: 30 * mobileScale,
                borderRadius: 10 * mobileScale,
              },
              isTabletRange && {
                position: "absolute",
                right: 16 * tabletScale,
                top: 18 * tabletScale,
                paddingHorizontal: 3 * tabletScale,
                paddingVertical: 30 * tabletScale,
                borderRadius: 10 * tabletScale,
              },
            ]}
            onPress={() => router.replace("/")}
          >
            <Text
              style={[
                styles.backBtnPillText,
                isMobile && { fontSize: 14 * mobileScale, transform: [{ rotate: "90deg" }] },
                isTabletRange && { fontSize: 14 * tabletScale, transform: [{ rotate: "90deg" }] },
              ]}
            >
              Back
            </Text>
          </TouchableOpacity>
          {isMobile && (
            <View
              style={[
                styles.availabilityCard,
                {
                  left: 240 * mobileScale,
                  top: 25 * mobileScale,
                  width: 100 * mobileScale,
                  padding: 8 * mobileScale,
                  borderRadius: 12 * mobileScale,
                  transform: [{ rotate: "90deg" }],
                },
              ]}
            >
              <Text
                style={[
                  styles.availabilityEyebrow,
                  { fontSize: 8 * mobileScale, marginBottom: 6 * mobileScale },
                ]}
              >
                Availability
              </Text>
              <View style={[styles.availabilityRow, { marginBottom: 5 * mobileScale }]}>
                <View style={[styles.availabilityRowLabel, { gap: 5 * mobileScale }]}>
                  <View
                    style={[
                      styles.availabilityDot,
                      {
                        width: 6 * mobileScale,
                        height: 6 * mobileScale,
                        borderRadius: 3 * mobileScale,
                        backgroundColor: "#8B5E3C",
                      },
                    ]}
                  />
                  <Text style={[styles.availabilityRowText, { fontSize: 10 * mobileScale }]}>Occupied</Text>
                </View>
                <Text style={[styles.availabilityRowValue, { fontSize: 10 * mobileScale }]}>{occupiedCount}</Text>
              </View>
              <View style={styles.availabilityRow}>
                <View style={[styles.availabilityRowLabel, { gap: 5 * mobileScale }]}>
                  <View
                    style={[
                      styles.availabilityDot,
                      {
                        width: 6 * mobileScale,
                        height: 6 * mobileScale,
                        borderRadius: 3 * mobileScale,
                        backgroundColor: "#0B6247",
                      },
                    ]}
                  />
                  <Text style={[styles.availabilityRowText, { fontSize: 10 * mobileScale }]}>Vacant</Text>
                </View>
                <Text style={[styles.availabilityRowValue, { fontSize: 10 * mobileScale }]}>{vacantCount}</Text>
              </View>
            </View>
          )}
          {isTabletRange && (
            <View
              style={[
                styles.availabilityCard,
                {
                  // right- (not left-) anchored -- same anchor edge as the
                  // Back button, so this stays tucked under it at any
                  // tablet width instead of drifting away (a left-anchored
                  // position and the Back button's right-anchored position
                  // scale apart from each other as width changes).
                  right: -30 * tabletScale,
                  top: 127 * tabletScale,
                  width: 140 * tabletScale,
                  padding: 12 * tabletScale,
                  borderRadius: 16 * tabletScale,
                  transform: [{ rotate: "90deg" }],
                },
              ]}
            >
              <Text
                style={[
                  styles.availabilityEyebrow,
                  { fontSize: 10 * tabletScale, marginBottom: 8 * tabletScale },
                ]}
              >
                Availability
              </Text>
              <View style={[styles.availabilityRow, { marginBottom: 7 * tabletScale }]}>
                <View style={[styles.availabilityRowLabel, { gap: 6 * tabletScale }]}>
                  <View
                    style={[
                      styles.availabilityDot,
                      {
                        width: 8 * tabletScale,
                        height: 8 * tabletScale,
                        borderRadius: 4 * tabletScale,
                        backgroundColor: "#8B5E3C",
                      },
                    ]}
                  />
                  <Text style={[styles.availabilityRowText, { fontSize: 13 * tabletScale }]}>Occupied</Text>
                </View>
                <Text style={[styles.availabilityRowValue, { fontSize: 13 * tabletScale }]}>{occupiedCount}</Text>
              </View>
              <View style={styles.availabilityRow}>
                <View style={[styles.availabilityRowLabel, { gap: 6 * tabletScale }]}>
                  <View
                    style={[
                      styles.availabilityDot,
                      {
                        width: 8 * tabletScale,
                        height: 8 * tabletScale,
                        borderRadius: 4 * tabletScale,
                        backgroundColor: "#0B6247",
                      },
                    ]}
                  />
                  <Text style={[styles.availabilityRowText, { fontSize: 13 * tabletScale }]}>Vacant</Text>
                </View>
                <Text style={[styles.availabilityRowValue, { fontSize: 13 * tabletScale }]}>{vacantCount}</Text>
              </View>
            </View>
          )}
          {isMobile && (
            <View
              style={[
                styles.mobileQuoteCard,
                {
                  left: 150 * mobileScale,
                  top: 23 * mobileScale,
                  width: 125 * mobileScale,
                  padding: 10 * mobileScale,
                  borderRadius: 12 * mobileScale,
                  transform: [{ rotate: "90deg" }],
                },
              ]}
            >
              <Text
                style={[
                  styles.stripQuoteText,
                  { fontSize: 13 * mobileScale, textAlign: "center", color: "#171A19" },
                ]}
              >
                Tap a stall to view{"\n"}its availability &{"\n"}Stall information
              </Text>
            </View>
          )}
          {isTabletRange && (
            <View
              style={[
                styles.mobileQuoteCard,
                {
                  // right-anchored, same reasoning as the Availability card
                  // above -- keeps it tucked near the Back button/
                  // Availability card at any tablet width.
                  right: -30 * tabletScale,
                  top: 280 * tabletScale,
                  width: 140 * tabletScale,
                  padding: 10 * tabletScale,
                  borderRadius: 12 * tabletScale,
                  transform: [{ rotate: "90deg" }],
                },
              ]}
            >
              <Text
                style={[
                  styles.stripQuoteText,
                  { fontSize: 13 * tabletScale, textAlign: "center", color: "#171A19" },
                ]}
              >
                Tap a stall to view its availability{"\n"}& Stall information
              </Text>
            </View>
          )}
          <Text
            style={[
              styles.headerTitle,
              isMobile && {
                fontSize: 13 * mobileScale,
                position: "relative",
                top: -15 * mobileScale,
                left: 240 * mobileScale,
                paddingVertical: 12 * mobileScale,
                paddingHorizontal: 10 * mobileScale,
                transform: [{ rotate: "90deg" }],
                opacity: 0,
              },
              isTabletRange && {
                fontSize: 13 * tabletScale,
                position: "relative",
                top: -15 * tabletScale,
                left: 240 * tabletScale,
                paddingVertical: 12 * tabletScale,
                paddingHorizontal: 10 * tabletScale,
                transform: [{ rotate: "90deg" }],
                opacity: 0,
              },
            ]}
          >
            2D Market View
          </Text>
          <View style={{ width: 64 }} />
        </View>

      <View
        style={{ flex: 1, position: "relative" }}
        onLayout={(e) => setMeasuredContentHeight(e.nativeEvent.layout.height)}
      >

      {/* TEMP DEBUG -- on-screen readout of the actual computed numbers, so
          we can tell whether code edits are reaching the browser at all vs.
          some other bug. Remove once diagnosed. */}
      {isTabletRange && (
        <View style={{ position: "absolute", top: 4, left: 4, zIndex: 999, backgroundColor: "#000" }}>
          <Text style={{ color: "#0f0", fontSize: 11 }}>
            w={windowWidth} tabletScale={tabletScale.toFixed(3)} top={(10 * tabletScale).toFixed(1)}{"\n"}
            rH={rotatedHeight.toFixed(1)} rW={rotatedWidth.toFixed(1)} availH={availableHeight.toFixed(1)}
          </Text>
        </View>
      )}

      {/* Blueprint area -- mobile/tablet render blueprintArea directly (no
          ScrollView, see the comment where it's defined above); desktop
          still scrolls since its content can exceed the viewport. */}
      {isMobileOrTablet ? (
        <View
          style={[
            styles.blueprintAreaPlain,
            { justifyContent: "flex-end" },
          ]}
        >
          {blueprintArea}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.verticalScrollContent}>
          <ScrollView horizontal contentContainerStyle={styles.horizontalScrollContent}>
            {blueprintArea}
          </ScrollView>
        </ScrollView>
      )}

      {/* Tapped-stall popup -- lives inside the map's own flex:1 wrapper
          (not the top-level screen) so it centers against the map area
          itself. Centering it against the whole screen instead would pull
          it off-center on any layout where the header eats real space
          (mobile/desktop's horizontal header eats height; the map area
          left over is shorter than the full screen, so a screen-centered
          overlay sits noticeably above the map's own visual center). */}
      {selectedStall && (
        <View
          style={[
            styles.popupOverlay,
            isMobile && { top: 19 * mobileScale },
            // Tablet's map has its own top offset (currently 35, see the
            // blueprintArea wrapper above) -- this popup is a separate
            // overlay that doesn't move with the map wrapper, so its own
            // offset here needs to be kept roughly matching (+9 over the
            // map's own) to stay centered against wherever the map sits.
            isTabletRange && { top: 19 * tabletScale },
          ]}
        >
          <StallPopup stall={selectedStall} onClose={() => setSelectedStall(null)} rotate90={isMobileOrTablet} />
        </View>
      )}
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  // Matches the homepage hero section's cream background (app/index.tsx BG).
  screen: { flex: 1, backgroundColor: "#F4F1E8" },

  /* Header */
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F4F1E8",
    paddingHorizontal: 16,
    paddingVertical: 14,
    paddingTop: 48,
  },
  // Real pill button (matches MarketMapEmbed's "View Stalls" button style)
  // instead of a bare arrow icon -- always navigates fresh to the homepage
  // (not router.back()) so it lands exactly on the hero section regardless
  // of scroll history, rather than wherever browser-back would restore.
  backBtnPill: {
    backgroundColor: "#0B6247",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  backBtnPillText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  // Mobile-only: matches MarketMapEmbed's Availability card, placed in the
  // header below/left of the Back button.
  // left/top/width/padding/borderRadius are applied inline (scaled by
  // mobileScale) at each usage site instead of here.
  availabilityCard: {
    position: "absolute",
    backgroundColor: "#EFE8DE",
    // Rotation doesn't change its reserved layout box, so it visually
    // extends past the header's own bounds into the map area below --
    // since the map is a later sibling, it was painting on top and
    // covering part of the rotated card. zIndex raises the card above it.
    zIndex: 20,
  },
  availabilityEyebrow: {
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "#5B6560",
    marginBottom: 6,
  },
  availabilityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 5,
  },
  availabilityRowLabel: { flexDirection: "row", alignItems: "center", gap: 5 },
  availabilityDot: { width: 6, height: 6, borderRadius: 3 },
  availabilityRowText: { fontSize: 10, color: "#171A19", fontWeight: "600" },
  availabilityRowValue: { fontSize: 10, color: "#171A19", fontWeight: "700" },
  // Mobile-only card wrapping the "Tap a stall..." quote -- same rotation +
  // zIndex treatment as availabilityCard above, for the same reason (it
  // visually extends past the header's own bounds after rotating, so it
  // needs to paint above the map sibling instead of behind it).
  // left/top/width/padding/borderRadius/transform are applied inline
  // (scaled by mobileScale) at the usage site instead of here.
  mobileQuoteCard: {
    position: "absolute",
    zIndex: 20,
  },
  // Matches the hero section's dark text color (app/index.tsx TEXT_DARK) --
  // the header background is now the same cream as the hero, so white text
  // would no longer have contrast against it. Font matches the homepage's
  // "Market Blueprint & Stall Status" title (MarketMapEmbed.tsx).
  headerTitle: { color: "#171A19", fontSize: 36, fontFamily: "PlayfairDisplay_700Bold_Italic" },
  stripQuoteText: {
    fontSize: 19,
    fontStyle: "italic",
    color: "#0B6247",
    textAlign: "center",
  },

  /* Blueprint */
  verticalScrollContent: { flexGrow: 1, backgroundColor: "#F4F1E8" },
  // Tablet's non-scrolling replacement for the two nested ScrollViews above.
  blueprintAreaPlain: {
    flex: 1,
    backgroundColor: "#F4F1E8",
    alignItems: "center",
    justifyContent: "center",
  },
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
});
