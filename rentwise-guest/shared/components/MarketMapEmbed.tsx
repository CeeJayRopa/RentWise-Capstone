import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
  Animated,
} from "react-native";
import { useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import StallPopup from "./StallPopup";
import { getStalls } from "../../services/stallService";
import { MARKET_LAYOUT, normalizeStallName, StallHotspot } from "../constants/marketLayout";

// Same blueprint asset/geometry as app/market-map.tsx, but sized to sit inline
// inside a page section instead of filling the whole screen — no header/back
// button, no viewport-height fitting, just a responsive width-based render.
// Must match assets/market-2Dlayout.png's real pixel dimensions (1053x708) —
// any mismatch here makes resizeMode="contain" letterbox the image inside
// the container instead of filling it, showing up as a gap on the sides.
const BLUEPRINT_ASPECT_RATIO = 1053 / 708;
const MIN_BLUEPRINT_WIDTH = 700;
const HOTSPOT_SHRINK = 0.94;
const MAP_CARD_BORDER_WIDTH = 1;
// Desired on-screen breathing room between the hover tooltip's bottom
// (caret tip) and the stall it's pointing at, at any zoom level.
const HOVER_TOOLTIP_GAP = 12;

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

interface Props {
  maxWidth?: number;
  eyebrow?: string;
  title?: string;
  description?: string;
  // The page section wrapping this embed applies its own horizontal padding
  // (index.tsx's `hPad`) that eats into the real available width -- this
  // component's internal width math is based on the raw window width, which
  // doesn't know about that padding, so it has to be told. At very wide
  // windows that padding is a tiny fraction of the total and barely showed;
  // at narrower desktop widths it was a much bigger bite, causing the map
  // card to overflow/clip its own rounded border.
  outerPaddingH?: number;
}

const PRIMARY = "#0E7C5A";
const PRIMARY_DARK = "#0B6247";
const TEXT_DARK = "#171A19";
const TEXT_MUTED = "#5B6560";
const CARD_BG = "#F4F8F5";

export default function MarketMapEmbed({
  maxWidth = 620,
  eyebrow,
  title,
  description,
  outerPaddingH = 0,
}: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const isMobile = windowWidth <= 480;
  // Matches the guest site's shared tablet range (rentwise-guest/shared/hooks/
  // useBreakpoints.ts) so this embed keeps the same side-by-side layout as
  // desktop through the whole tablet range, just narrower, instead of falling
  // back to a differently-shaped stacked layout partway through it.
  const isTabletRange = windowWidth > 480 && windowWidth <= 1024;
  const isDesktop = windowWidth > 1024;
  // Mobile now copies the tablet structure wholesale (italic title above the
  // map, white rounded map card, Market Hours + buttons row below) instead
  // of its own bespoke layout -- every isTabletRange styling gate below is
  // paired with isMobile too. Kept as a separate flag rather than editing
  // isTabletRange's own definition so tablet's behavior/values stay untouched.
  const isMobileOrTablet = isMobile || isTabletRange;
  // A narrower fixed text column on tablet leaves the split layout room to
  // survive down to a lower width than desktop needs.
  const textColW = isTabletRange ? 220 : isDesktop ? 460 : 300;
  // Below this there isn't room for the text column + the map's own
  // readable floor side by side, so the split layout collapses to a single
  // stacked column instead. Tablet always stacks now (map on top, text
  // below -- see the render order at the bottom of this component), rather
  // than only falling back to it below a width threshold like desktop does.
  const isSplit = isTabletRange ? false : windowWidth > 980;
  // Split mode: the map column only has whatever's left of the window after
  // the outer card's padding + the fixed-width text column + its gap.
  const CARD_CHROME = 36 * 2 + textColW + 48;
  // The desktop/tablet card wraps the map in its own 20px padding on each
  // side (see mapCard below) -- that has to be reserved here too, or
  // blueprintWidth gets computed as if the map could use the full available
  // width, leaving no room for that padding and squeezing/clipping it
  // (looked fine at 1920 where there was slack to spare, but visibly lost
  // its margin at 1440 before this was accounted for).
  const MAP_CARD_PADDING = isMobileOrTablet ? 8 : 20;
  const available =
    (isSplit ? windowWidth - CARD_CHROME : windowWidth - 32) -
    (isDesktop || isMobileOrTablet ? MAP_CARD_PADDING * 2 : 0) -
    outerPaddingH * 2;
  // Tablet gets its own (smaller) cap, independent of the `maxWidth` prop
  // desktop/mobile still use.
  const effectiveMaxWidth = isTabletRange ? Math.min(maxWidth, 960) : maxWidth;
  // On phones/tablet, don't force the desktop-readability floor — let the
  // map shrink to fit instead (desktop keeps the floor since it has the
  // width to spare and benefits from the extra legibility).
  const blueprintWidth =
    isMobile
      ? Math.min(available, effectiveMaxWidth) * 1.1
      : isSplit || isTabletRange
      ? Math.min(available, effectiveMaxWidth)
      : Math.max(MIN_BLUEPRINT_WIDTH, Math.min(available, effectiveMaxWidth));
  const blueprintHeight = blueprintWidth / BLUEPRINT_ASPECT_RATIO;

  const [stalls, setStalls] = useState<Stall[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStall, setSelectedStall] = useState<Stall | null>(null);

  // "View Stalls" button push-down feedback on actual press (not hover) --
  // scales down slightly while held, springs back on release.
  const viewStallsPressScale = useRef(new Animated.Value(1)).current;
  const setViewStallsPressed = (pressed: boolean) => {
    Animated.timing(viewStallsPressScale, {
      toValue: pressed ? 0.95 : 1,
      duration: pressed ? 80 : 150,
      useNativeDriver: true,
    }).start();
  };


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
  // No pan/zoom anymore -- kept as an identity transform (rather than
  // reworking the tooltip's screen-position math below to drop the
  // position/scale terms entirely) since it's already expressed in these
  // terms: screen = position + local * scale.
  const mapTransform = { positionX: 0, positionY: 0, scale: 1 };
  // Real rendered size of the tooltip card, measured via onLayout below, so
  // the centering/lift offsets are computed from its true size instead of a
  // guess.
  const [tooltipSize, setTooltipSize] = useState({ width: 148, height: 96 });

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
  // Same binary occupied/vacant split used everywhere else in this file
  // (isVacant = status !== "occupied") -- there's no third "reserved" status
  // in the actual stall data, so the mobile Availability card only shows
  // these two, computed live instead of hardcoded.
  const occupiedCount = stalls.filter((s) => s.status?.toLowerCase() === "occupied").length;
  const vacantCount = stalls.length - occupiedCount;

  const blueprintContent = (
    <View
      style={[
        styles.blueprintContainer,
        { width: blueprintWidth, height: blueprintHeight },
        (isDesktop || isMobileOrTablet) && { borderRadius: 14 },
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
                  // Only 2 colors now: occupied is green, vacant/unknown
                  // both share the neutral grey that "unknown" used to be
                  // the only user of.
                  backgroundColor:
                    isVacant === false
                      ? "rgba(76,175,80,0.3)"
                      : "rgba(120,120,120,0.15)",
                },
              ]}
              // Stalls are desktop-only interactive for now -- tablet/mobile
              // just see the static blueprint, no tap/hover on individual
              // stalls.
              disabled={!isDesktop}
              onPress={() => {
                setSelectedStall(stall ?? { id: hotspot.name, name: hotspot.name, status: "Unknown" });
                // The hover tooltip and the tapped popup showing at once
                // reads as a bug, not two features -- hide the tooltip
                // the moment a stall is tapped, on every resolution.
                setHoveredStall(null);
              }}
              {...(Platform.OS === "web" && isDesktop
                ? {
                    onMouseEnter: () => handleHoverIn(hotspot, stall ?? null, left, top, width, height),
                    onMouseLeave: handleHoverOut,
                  }
                : {})}
            />
          );
        })
      )}
    </View>
  );

  // Rendered as a sibling of TransformComponent (outside the zoomed/panned
  // content), positioned via computed screen coordinates -- see the
  // mapTransform comment above for why it doesn't live inside blueprintContent.
  const hoverTooltip = hoveredStall && !selectedStall && (() => {
    const hs = hoveredStall.stall;
    const isVac = hs ? hs.status?.toLowerCase() !== "occupied" : null;
    const statusColor = isVac === true ? "#0E7C5A" : isVac === false ? "#C0392B" : "#787878";
    const statusTint = isVac === true ? "#E4F3EC" : isVac === false ? "#FBEAE8" : "#EFEFEF";
    const statusLabel = isVac === true ? "Vacant" : isVac === false ? "Occupied" : "Unknown";

    // Most stalls open their tooltip above them (placement "top", the
    // default) -- anchored at the stall's own top edge, card lifted fully
    // above it. The diagonal row sits right at the blueprint's top edge
    // though, so those are flagged "bottom": anchored at the stall's BOTTOM
    // edge instead, with the card dropping down below it.
    const placement = hoveredStall.hotspot.tooltipPlacement ?? "top";
    const anchorTop = placement === "bottom" ? hoveredStall.top + hoveredStall.height : hoveredStall.top;

    const localX = ((hoveredStall.left + hoveredStall.width / 2) / 100) * blueprintWidth;
    const localY = (anchorTop / 100) * blueprintHeight;
    const screenX = mapTransform.positionX + localX * mapTransform.scale;
    const screenY = mapTransform.positionY + localY * mapTransform.scale;

    return (
      <View
        pointerEvents="none"
        style={[
          styles.hoverTooltipAnchor,
          {
            left: screenX,
            top: screenY,
            transform: [
              { translateX: -(tooltipSize.width / 2) },
              placement === "bottom"
                ? { translateY: HOVER_TOOLTIP_GAP }
                : { translateY: -(tooltipSize.height + HOVER_TOOLTIP_GAP) },
            ],
          },
        ]}
      >
        <Animated.View
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            if (width && height && (width !== tooltipSize.width || height !== tooltipSize.height)) {
              setTooltipSize({ width, height });
            }
          }}
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
  })();

  // Mobile-only pill: icon-in-circle + label + trailing arrow, reused for
  // both actions below with just the color/icon/label/onPress swapped.
  const mobileActionBtn = (
    key: string,
    bg: string,
    icon: keyof typeof Ionicons.glyphMap,
    label: string,
    onPress: () => void
  ) => (
    <Pressable key={key} onPress={onPress} style={[styles.mobileActionBtn, { backgroundColor: bg }]}>
      <View style={styles.mobileActionBtnIconWrap}>
        <Ionicons name={icon} size={18} color="#fff" />
      </View>
      <Text style={styles.mobileActionBtnText}>{label}</Text>
      <Ionicons name="arrow-forward" size={18} color="#fff" />
    </Pressable>
  );

  const viewStallsBtn = (
    <Pressable
      key="view-stalls"
      onPress={() => router.push("/map-loading")}
      onPressIn={() => setViewStallsPressed(true)}
      onPressOut={() => setViewStallsPressed(false)}
      style={isTabletRange && { flex: 1 }}
    >
      <Animated.View
        style={[styles.actionBtnPrimary, { transform: [{ scale: viewStallsPressScale }] }]}
      >
        <Text style={styles.actionBtnPrimaryText}>View Stalls</Text>
      </Animated.View>
    </Pressable>
  );

  const actions = (
    <View
      style={[
        styles.actionCol,
        isTabletRange && { flexDirection: "row", position: "relative", left: -20 },
        isMobile && { alignItems: "stretch" },
      ]}
    >
      {isMobile ? (
        <>
          {mobileActionBtn("view-stalls", PRIMARY_DARK, "storefront-outline", "View Stalls", () =>
            router.push("/map-loading")
          )}
          {mobileActionBtn("ar-view", "#8B5E3C", "cube-outline", "Launch AR Viewing", () =>
            router.push("/ar-view")
          )}
        </>
      ) : (
        <>
          {!isDesktop && viewStallsBtn}
          {!isDesktop && (
            <TouchableOpacity
              style={[styles.actionBtnOutline, isTabletRange && { flex: 1 }]}
              onPress={() => router.push("/ar-view")}
            >
              <Ionicons name="sparkles-outline" size={16} color={PRIMARY_DARK} />
              <Text style={styles.actionBtnOutlineText}>AR Viewing</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );

  const titleBlock = title && (
    <Text
      style={[
        styles.blueprintTitle,
        (isDesktop || isMobileOrTablet) && {
          fontFamily: "PlayfairDisplay_400Regular_Italic",
          fontWeight: "400",
          color: PRIMARY_DARK,
          fontSize: isDesktop ? 55 : 40,
          // Sizes to the text's own natural width instead of being
          // stretched (and force-wrapped) to the 300px text column --
          // lets "Market Blueprint &" sit on one row without widening
          // the column itself, which would shrink the map's available
          // space.
          alignSelf: "flex-start",
          flexShrink: 0,
          textAlign: isMobile ? "center" : "left",
        },
      ]}
    >
      {/* Tablet/mobile render this above the map (see the final return below)
          as a single row -- the desktop-only "\n" line break baked into the
          title string doesn't apply there, so it's collapsed to a space. */}
      {isMobileOrTablet && typeof title === "string" ? title.replace(/\n/g, " ") : title}
    </Text>
  );

  const textBlock = (
    <>
      {eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
      {!isMobileOrTablet && titleBlock}
      {isDesktop && description && <Text style={styles.blueprintDesc}>{description}</Text>}
      {(isDesktop || isMobileOrTablet) && (
        <View
          style={{
            marginTop: isTabletRange ? -20 : isMobile ? 0 : 8,
            marginBottom: 24,
            paddingLeft: isTabletRange ? 45 : 0,
          }}
        >
          <Text
            style={{
              color: PRIMARY,
              fontSize: 12,
              fontWeight: "700",
              letterSpacing: 1.5,
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Market Hours
          </Text>
          <View style={{ flexDirection: "row", marginBottom: 8 }}>
            <Text style={{ color: TEXT_DARK, fontSize: 14, fontWeight: "700", width: 80 }}>
              Mon - Fri
            </Text>
            <Text style={{ color: PRIMARY_DARK, fontSize: 14, fontWeight: "700" }}>
              04:00 AM - 08:00 PM
            </Text>
          </View>
          <View style={{ flexDirection: "row" }}>
            <Text style={{ color: TEXT_DARK, fontSize: 14, fontWeight: "700", width: 80 }}>
              Sat - Sun
            </Text>
            <Text style={{ color: PRIMARY_DARK, fontSize: 14, fontWeight: "700" }}>
              03:00 AM - 09:00 PM
            </Text>
          </View>
        </View>
      )}
    </>
  );

  // Mobile-only: replaces the plain "Market Hours" text block above with two
  // stacked cards (Availability, Operational Hours) -- doesn't touch
  // textBlock itself so desktop/tablet's rendering stays exactly as-is.
  const mobileHoursSection = (
    <View style={{ gap: 16 }}>
      <View style={styles.infoCard}>
        <Text style={styles.infoCardEyebrow}>Availability</Text>
        <View style={styles.infoCardRow}>
          <View style={styles.infoCardRowLabel}>
            <View style={[styles.infoDot, { backgroundColor: "#8B5E3C" }]} />
            <Text style={styles.infoCardRowText}>Occupied</Text>
          </View>
          <Text style={styles.infoCardRowValue}>{occupiedCount}</Text>
        </View>
        <View style={[styles.infoCardRow, { marginBottom: 0 }]}>
          <View style={styles.infoCardRowLabel}>
            <View style={[styles.infoDot, { backgroundColor: PRIMARY_DARK }]} />
            <Text style={styles.infoCardRowText}>Vacant</Text>
          </View>
          <Text style={styles.infoCardRowValue}>{vacantCount}</Text>
        </View>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoCardEyebrow}>Operational Hours</Text>
        <View style={{ marginBottom: 12 }}>
          <Text style={styles.infoCardMuted}>MON — FRI</Text>
          <Text style={styles.infoCardBold}>04:00 AM — 08:00 PM</Text>
        </View>
        <View>
          <Text style={styles.infoCardMuted}>SAT — SUN</Text>
          <Text style={styles.infoCardBold}>03:00 AM — 09:00 PM</Text>
        </View>
      </View>
    </View>
  );

  const textCol = (
    <View style={[styles.textCol, { width: textColW }, !isSplit && styles.textColStacked]}>
      {isTabletRange ? (
        // Tablet: buttons sit beside the text block instead of stacked
        // below it.
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 20 }}>
          <View style={{ flex: 1 }}>{textBlock}</View>
          <View style={{ flex: 1 }}>{actions}</View>
        </View>
      ) : isMobile ? (
        // Mobile: Availability + Operational Hours cards, buttons below them.
        <>
          {mobileHoursSection}
          <View style={{ marginTop: 20 }}>{actions}</View>
        </>
      ) : (
        <>
          {textBlock}
          {actions}
        </>
      )}
    </View>
  );

  const mapColumn = (
    <View style={[styles.mapCol, !isSplit && styles.mapColStacked, isMobile && { marginTop: -20 }]}>
      <View style={styles.mapCardOuter}>
        <View
          style={[
            styles.mapCard,
            // Desktop, tablet, and mobile: wraps the (untouched) map in a
            // white rounded card with breathing room around it, instead of
            // the map filling the card edge-to-edge.
            (isDesktop || isMobileOrTablet) && {
              backgroundColor: "#fff",
              borderWidth: 0,
              borderRadius: 24,
              padding: MAP_CARD_PADDING,
            },
          ]}
        >
          <View
            style={{
              width: blueprintWidth,
              height: blueprintHeight,
              overflow: "hidden",
              borderRadius: isDesktop || isMobileOrTablet ? 14 : 0,
            }}
          >
            {blueprintContent}
          </View>
          {Platform.OS === "web" && hoverTooltip}

          {/* Nested inside mapCard (not mapCardOuter) so the dim exactly
              matches the map's own rendered bounds -- mapCardOuter is the
              full flex column width, but mapCard is centered and often
              narrower (capped at blueprintWidth), so anchoring the overlay
              to the outer box left it wider than the map underneath it. */}
          {selectedStall && (
            <View style={[styles.popupOverlay, (isDesktop || isMobileOrTablet) && { borderRadius: 24 }]}>
              <ScrollView
                style={styles.popupScroll}
                contentContainerStyle={styles.popupScrollContent}
                showsVerticalScrollIndicator={false}
              >
                <StallPopup stall={selectedStall} onClose={() => setSelectedStall(null)} />
              </ScrollView>
            </View>
          )}
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.card,
          isSplit ? styles.cardSplit : styles.cardStacked,
          isTabletRange && { position: "relative", top: -40 },
          isMobile && { position: "relative", top: -40 },
        ]}
      >
        {isMobileOrTablet ? (
          <>
            <View style={{ width: "100%", marginBottom: 16, paddingLeft: isTabletRange ? 90 : 10, paddingTop: 20 }}>{titleBlock}</View>
            {mapColumn}
            {textCol}
          </>
        ) : (
          <>
            {textCol}
            {mapColumn}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", alignItems: "center" },
  card: {
    width: "100%",
    maxWidth: 1500,
  },
  cardSplit: { flexDirection: "row", alignItems: "flex-start", gap: 48 },
  cardStacked: { flexDirection: "column", gap: 28 },
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
  // Mobile-only full-width pill: icon-in-circle, label, trailing arrow.
  mobileActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    width: "100%",
  },
  mobileActionBtnIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  mobileActionBtnText: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "700" },
  // Mobile-only Availability/Operational Hours cards.
  infoCard: {
    backgroundColor: "#EFE8DE",
    borderRadius: 16,
    padding: 18,
    width: "100%",
  },
  infoCardEyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: TEXT_MUTED,
    marginBottom: 12,
  },
  infoCardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  infoCardRowLabel: { flexDirection: "row", alignItems: "center", gap: 8 },
  infoDot: { width: 8, height: 8, borderRadius: 4 },
  infoCardRowText: { fontSize: 14, color: TEXT_DARK, fontWeight: "600" },
  infoCardRowValue: { fontSize: 14, color: TEXT_DARK, fontWeight: "700" },
  infoCardMuted: { fontSize: 11, color: TEXT_MUTED, marginBottom: 3 },
  infoCardBold: { fontSize: 14.5, color: TEXT_DARK, fontWeight: "700" },
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
  mapCardOuter: {
    position: "relative",
    alignSelf: "center",
    width: "100%",
    // Clips the popup to the map card's own box — it should never visually
    // spill onto the "Vacant Stalls"/"AR Viewing" buttons below.
    overflow: "hidden",
  },
  mapCard: {
    alignSelf: "center",
    borderWidth: MAP_CARD_BORDER_WIDTH,
    borderStyle: "solid",
    borderColor: "#E4E8E5",
    padding: 0,
    overflow: "hidden",
    backgroundColor: CARD_BG,
  },
  blueprintContainer: {
    position: "relative",
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

  /* Hover tooltip (web only) — rendered outside the zoomed map content, at a
     computed screen pixel position (see the hoverTooltip block above), so
     left/top/transform are all plain numbers set inline, not percentages. */
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

  popupOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.3)",
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
