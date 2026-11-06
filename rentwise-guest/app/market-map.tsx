import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Modal,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
  Animated,
  PanResponder,
  Platform,
} from "react-native";
import { useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import StallPopup from "../shared/components/StallPopup";
import { subscribeToStalls } from "../services/stallService";
import { MARKET_LAYOUT, StallHotspot } from "../shared/constants/marketLayout";
import { matchMapStalls } from "../shared/constants/stallLookup";

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
  spaceId?: string;
  status?: string;
  buildingNumber?: string;
  category?: string;
  marketType?: string;
  spaceDimension?: string;
  width?: number;
  length?: number;
  price?: number;
}

type MobileMapItem = {
  hotspot: StallHotspot;
  stall: Stall;
};

const MOBILE_PRIMARY = "#0B6247";
const MOBILE_BG = "#F7F4EC";
const MOBILE_STALLS_PER_PAGE = 5;

function stallCode(stall: Stall): string {
  return String(stall.spaceId ?? stall.name ?? stall.id).replace(/^stall\s*/i, "").trim();
}

function stallCategory(stall: Stall): string {
  const marketType = String(stall.marketType ?? "").trim();
  const category = String(stall.category ?? "").trim();
  return marketType || category || "Uncategorized";
}

function stallBuilding(stall: Stall): string {
  const buildingNumber = String(stall.buildingNumber ?? "").trim();
  return buildingNumber ? `Building ${buildingNumber}` : "Building not specified";
}

function stallDimensions(stall: Stall): string {
  const savedDimension = String(stall.spaceDimension ?? "").trim();
  if (savedDimension) return savedDimension;
  const length = Number(stall.length);
  const width = Number(stall.width);
  if (Number.isFinite(length) && length > 0 && Number.isFinite(width) && width > 0) {
    return `${length} m × ${width} m`;
  }
  return "Not specified";
}

function statusMeta(status?: string) {
  const normalized = String(status ?? "available").trim().toLowerCase();
  if (normalized === "occupied") return {label: "Occupied", color: "#D95F61", soft: "#FBE0E1"};
  if (normalized === "reserved" || normalized === "pending") return {label: "Reserved", color: "#D49B15", soft: "#FFF0BD"};
  if (normalized === "unavailable" || normalized === "disabled") return {label: "Unavailable", color: "#87939A", soft: "#E8ECEE"};
  return {label: "Available", color: "#16845F", soft: "#D9F4E9"};
}

function MobileMarketView({items, loading}: {items: MobileMapItem[]; loading: boolean}) {
  const {width} = useWindowDimensions();
  const mapWidth = Math.max(296, width - 24);
  const mapHeight = mapWidth / BLUEPRINT_ASPECT_RATIO;
  const [selected, setSelected] = useState<MobileMapItem | null>(null);
  const [descriptionVisible, setDescriptionVisible] = useState(false);
  const [page, setPage] = useState(0);
  const [mapGestureActive, setMapGestureActive] = useState(false);
  const mapScale = useRef(new Animated.Value(1)).current;
  const mapX = useRef(new Animated.Value(0)).current;
  const mapY = useRef(new Animated.Value(0)).current;
  const mapScaleValue = useRef(1);
  const mapXValue = useRef(0);
  const mapYValue = useRef(0);
  const dragStart = useRef({x: 0, y: 0});
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const scaleListener = mapScale.addListener(({value}) => { mapScaleValue.current = value; });
    const xListener = mapX.addListener(({value}) => { mapXValue.current = value; });
    const yListener = mapY.addListener(({value}) => { mapYValue.current = value; });
    return () => {
      mapScale.removeListener(scaleListener);
      mapX.removeListener(xListener);
      mapY.removeListener(yListener);
    };
  }, [mapScale, mapX, mapY]);

  const clampMapPosition = (x: number, y: number, scale = mapScaleValue.current) => {
    // Translation is applied before scale below, so divide the visible
    // overflow by scale to keep every edge of the blueprint reachable.
    const maxX = Math.max(0, (mapWidth * (scale - 1)) / (2 * scale));
    const maxY = Math.max(0, (mapHeight * (scale - 1)) / (2 * scale));
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  };

  const mapPanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        mapScaleValue.current > 1 && (Math.abs(gesture.dx) > 5 || Math.abs(gesture.dy) > 5),
      onMoveShouldSetPanResponderCapture: (_event, gesture) =>
        mapScaleValue.current > 1 && (Math.abs(gesture.dx) > 8 || Math.abs(gesture.dy) > 8),
      onPanResponderGrant: () => {
        setMapGestureActive(true);
        mapX.stopAnimation((value) => {
          mapXValue.current = value;
          dragStart.current.x = value;
        });
        mapY.stopAnimation((value) => {
          mapYValue.current = value;
          dragStart.current.y = value;
        });
      },
      onPanResponderMove: (_event, gesture) => {
        const scale = Math.max(1, mapScaleValue.current);
        const next = clampMapPosition(
          dragStart.current.x + gesture.dx / scale,
          dragStart.current.y + gesture.dy / scale,
          scale,
        );
        mapX.setValue(next.x);
        mapY.setValue(next.y);
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: () => setMapGestureActive(false),
      onPanResponderTerminate: () => setMapGestureActive(false),
    }),
  ).current;

  const filtered = items;
  const totalPages = Math.max(1, Math.ceil(filtered.length / MOBILE_STALLS_PER_PAGE));
  const visibleItems = filtered.slice(page * MOBILE_STALLS_PER_PAGE, (page + 1) * MOBILE_STALLS_PER_PAGE);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages - 1));
  }, [totalPages]);

  const animateMap = (item: MobileMapItem | null, explicitScale?: number) => {
    const targetScale = explicitScale ?? (item ? 1.7 : 1);
    let targetX = 0;
    let targetY = 0;
    if (item && targetScale > 1) {
      const centerX = ((item.hotspot.xPct + item.hotspot.widthPct / 2) / 100) * mapWidth;
      const centerY = ((item.hotspot.yPct + item.hotspot.heightPct / 2) / 100) * mapHeight;
      targetX = (mapWidth / 2 - centerX) * (targetScale - 1);
      targetY = (mapHeight / 2 - centerY) * (targetScale - 1);
    }
    Animated.parallel([
      Animated.spring(mapScale, {toValue: targetScale, useNativeDriver: Platform.OS !== "web", damping: 18, stiffness: 150}),
      Animated.spring(mapX, {toValue: targetX, useNativeDriver: Platform.OS !== "web", damping: 18, stiffness: 150}),
      Animated.spring(mapY, {toValue: targetY, useNativeDriver: Platform.OS !== "web", damping: 18, stiffness: 150}),
    ]).start();
  };

  const selectItem = (item: MobileMapItem) => {
    setSelected(item);
    const itemIndex = filtered.findIndex((candidate) => candidate.hotspot.name === item.hotspot.name);
    if (itemIndex >= 0) setPage(Math.floor(itemIndex / MOBILE_STALLS_PER_PAGE));
    animateMap(item);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({y: 0, animated: true});
    });
  };
  const closeSelection = () => {
    setDescriptionVisible(false);
    setSelected(null);
    animateMap(null);
  };
  return (
    <View style={mobileStyles.screen}>
      <View style={mobileStyles.header}>
        <Pressable style={mobileStyles.headerButton} onPress={() => router.replace("/")} accessibilityLabel="Back to home">
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={mobileStyles.headerTitle}>Market Map</Text>
        <View style={mobileStyles.headerButtonPlaceholder} />
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={mobileStyles.content}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!mapGestureActive}
      >
        <View
          style={[mobileStyles.mapCard, {width: mapWidth, height: mapHeight}]}
          onTouchStart={() => {
            if (mapScaleValue.current > 1) setMapGestureActive(true);
          }}
          onTouchEnd={() => setMapGestureActive(false)}
          onTouchCancel={() => setMapGestureActive(false)}
          {...mapPanResponder.panHandlers}
        >
          <Animated.View style={{width: mapWidth, height: mapHeight, transform: [{translateX: mapX}, {translateY: mapY}, {scale: mapScale}]}}>
            <Image source={require("../assets/market-2Dlayout.png")} style={mobileStyles.mapImage} resizeMode="contain" />
            {items.map((item, index) => {
              const {hotspot, stall} = item;
              const meta = statusMeta(stall.status);
              const active = selected?.hotspot.name === hotspot.name;
              return (
                <Pressable
                  key={`${hotspot.name}-${index}`}
                  onPress={() => selectItem(item)}
                  accessibilityLabel={`View ${stallCode(stall)}`}
                  style={[
                    mobileStyles.hotspot,
                    {
                      left: `${hotspot.xPct}%`, top: `${hotspot.yPct}%`,
                      width: `${hotspot.widthPct}%`, height: `${hotspot.heightPct}%`,
                      backgroundColor: `${meta.color}55`, borderColor: active ? "#00D68F" : meta.color,
                      borderWidth: active ? 1.5 : 0.8,
                      transform: hotspot.rotationDeg ? [{rotate: `${hotspot.rotationDeg}deg`}] : undefined,
                    },
                  ]}
                />
              );
            })}
          </Animated.View>
          {loading && <View style={mobileStyles.mapLoading}><ActivityIndicator color={MOBILE_PRIMARY} /></View>}
        </View>

        <View style={mobileStyles.sheet}>
          <Text style={mobileStyles.sheetTitle}>All Stalls</Text>

          {selected && (() => {
            const meta = statusMeta(selected.stall.status);
            return (
              <View style={mobileStyles.selectedCard}>
                <Pressable style={mobileStyles.selectedClose} onPress={closeSelection} accessibilityLabel="Close stall details"><Ionicons name="close" size={22} color="#22302A" /></Pressable>
                <Text style={mobileStyles.selectedCode}>{stallCode(selected.stall)}</Text>
                <Text style={mobileStyles.selectedCategory}>{stallCategory(selected.stall)}</Text>
                <View style={mobileStyles.selectedDetails}>
                  <Text style={mobileStyles.selectedDetail}>Dimensions: {stallDimensions(selected.stall)}</Text>
                  <Text style={mobileStyles.selectedDetail}>Daily rent: ₱{Number(selected.stall.price ?? 0).toLocaleString("en-PH")}</Text>
                  <View style={[mobileStyles.statusPill, {backgroundColor: meta.soft}]}><Text style={[mobileStyles.statusText, {color: meta.color}]}>{meta.label}</Text></View>
                </View>
                <Pressable style={mobileStyles.descriptionButton} onPress={() => setDescriptionVisible(true)}>
                  <Ionicons name="document-text-outline" size={17} color="#fff" />
                  <Text style={mobileStyles.descriptionButtonText}>View Stall Description</Text>
                </Pressable>
              </View>
            );
          })()}

          {filtered.length === 0 && !loading ? (
            <Text style={mobileStyles.emptyText}>No stalls are available to display.</Text>
          ) : visibleItems.map((item) => {
            const meta = statusMeta(item.stall.status);
            const active = selected?.hotspot.name === item.hotspot.name;
            return (
              <Pressable key={item.hotspot.name} onPress={() => selectItem(item)} style={[mobileStyles.stallRow, active && mobileStyles.stallRowActive]}>
                <View style={mobileStyles.stallIcon}><Ionicons name="storefront-outline" size={20} color={MOBILE_PRIMARY} /></View>
                <View style={mobileStyles.stallInfo}>
                  <Text style={mobileStyles.stallCode}>{stallCode(item.stall)}</Text>
                  <Text style={mobileStyles.stallMeta} numberOfLines={1}>{item.stall.buildingNumber ?? "Market"} · {stallCategory(item.stall)}</Text>
                </View>
                <View style={mobileStyles.stallRight}>
                  <Text style={mobileStyles.stallPrice}>₱{Number(item.stall.price ?? 0).toLocaleString("en-PH")}/day</Text>
                  <Text style={[mobileStyles.rowStatus, {color: meta.color}]}>{meta.label}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#8B928E" />
              </Pressable>
            );
          })}

          {filtered.length > MOBILE_STALLS_PER_PAGE ? (
            <View style={mobileStyles.pagination}>
              <Pressable
                disabled={page === 0}
                onPress={() => setPage((current) => Math.max(0, current - 1))}
                style={[mobileStyles.pageButton, page === 0 && mobileStyles.pageButtonDisabled]}
                accessibilityLabel="Previous stall page"
              >
                <Ionicons name="chevron-back" size={17} color={page === 0 ? "#AAB1AD" : MOBILE_PRIMARY} />
                <Text style={[mobileStyles.pageButtonText, page === 0 && mobileStyles.pageButtonTextDisabled]}>Previous</Text>
              </Pressable>
              <Text style={mobileStyles.pageLabel}>Page {page + 1} of {totalPages}</Text>
              <Pressable
                disabled={page >= totalPages - 1}
                onPress={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
                style={[mobileStyles.pageButton, page >= totalPages - 1 && mobileStyles.pageButtonDisabled]}
                accessibilityLabel="Next stall page"
              >
                <Text style={[mobileStyles.pageButtonText, page >= totalPages - 1 && mobileStyles.pageButtonTextDisabled]}>Next</Text>
                <Ionicons name="chevron-forward" size={17} color={page >= totalPages - 1 ? "#AAB1AD" : MOBILE_PRIMARY} />
              </Pressable>
            </View>
          ) : null}
        </View>
      </ScrollView>

      <Modal visible={descriptionVisible && !!selected} transparent animationType="fade" onRequestClose={() => setDescriptionVisible(false)}>
        <View style={mobileStyles.modalBackdrop}>
          <View style={mobileStyles.modalCard}>
            <View style={mobileStyles.modalHeader}>
              <View>
                <Text style={mobileStyles.modalEyebrow}>STALL DESCRIPTION</Text>
                <Text style={mobileStyles.modalTitle}>{selected ? stallCode(selected.stall) : "Stall"}</Text>
              </View>
            </View>

            {selected && (() => {
              const stall = selected.stall;
              const meta = statusMeta(stall.status);
              const dimension = stallDimensions(stall);
              const building = stallBuilding(stall);
              return (
                <>
                  <Text style={mobileStyles.modalDescription}>
                    {stallCode(stall)} is a {stallCategory(stall).toLowerCase()} stall located in {building}. It has an area measurement of {dimension} and a daily rental rate of ₱{Number(stall.price ?? 0).toLocaleString("en-PH")}.
                  </Text>
                  <View style={mobileStyles.modalDetailsCard}>
                    <View style={mobileStyles.modalDetailRow}><Text style={mobileStyles.modalDetailLabel}>Building</Text><Text style={mobileStyles.modalDetailValue}>{building}</Text></View>
                    <View style={mobileStyles.modalDetailRow}><Text style={mobileStyles.modalDetailLabel}>Category</Text><Text style={mobileStyles.modalDetailValue}>{stallCategory(stall)}</Text></View>
                    <View style={mobileStyles.modalDetailRow}><Text style={mobileStyles.modalDetailLabel}>Dimensions</Text><Text style={mobileStyles.modalDetailValue}>{dimension}</Text></View>
                    <View style={mobileStyles.modalDetailRow}><Text style={mobileStyles.modalDetailLabel}>Rent rate</Text><Text style={mobileStyles.modalDetailValue}>₱{Number(stall.price ?? 0).toLocaleString("en-PH")} / day</Text></View>
                    <View style={[mobileStyles.modalDetailRow, {borderBottomWidth: 0}]}><Text style={mobileStyles.modalDetailLabel}>Availability</Text><View style={[mobileStyles.statusPill, mobileStyles.modalStatusPill, {backgroundColor: meta.soft}]}><Text style={[mobileStyles.statusText, {color: meta.color}]}>{meta.label}</Text></View></View>
                  </View>
                  <Text style={mobileStyles.modalNote}>Availability may change. Contact the market administrator to confirm rental requirements and current availability.</Text>
                </>
              );
            })()}

            <Pressable style={mobileStyles.modalDone} onPress={() => setDescriptionVisible(false)}>
              <Text style={mobileStyles.modalDoneText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export default function MarketMap() {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // Matches the guest site's shared tablet range (rentwise-guest/shared/hooks/
  // useBreakpoints.ts).
  const isTabletRange = windowWidth > 480 && windowWidth <= 1024;
  const isMobile = windowWidth <= 480;
  // Only phones use the rotated portrait presentation. Tablets have enough
  // width for the blueprint's native landscape orientation and standard UI.
  const isMobileOrTablet = isMobile;
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
    Animated.timing(hoverAnim, { toValue: 1, duration: 160, useNativeDriver: Platform.OS !== "web" }).start();
  };
  const handleHoverOut = () => {
    Animated.timing(hoverAnim, { toValue: 0, duration: 120, useNativeDriver: Platform.OS !== "web" }).start(({ finished }) => {
      if (finished) setHoveredStall(null);
    });
  };

  useEffect(() => {
    const unsubscribe = subscribeToStalls(
      (data) => {
        setStalls(data as Stall[]);
        setLoading(false);
      },
      (error) => {
        console.warn("STALL SUBSCRIPTION WARNING:", error);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, []);

  const stallsByName = matchMapStalls(stalls, MARKET_LAYOUT);
  // Same binary occupied/vacant split used for the hotspot tint colors below
  // -- matches MarketMapEmbed.tsx's mobile Availability card, computed live
  // instead of hardcoded.
  const occupiedCount = stalls.filter((s) => s.status?.toLowerCase() === "occupied").length;
  const vacantCount = stalls.length - occupiedCount;

  if (isMobile || isTabletRange) {
    const mobileItems: MobileMapItem[] = MARKET_LAYOUT.map((hotspot) => ({
      hotspot,
      stall: stallsByName.get(hotspot.name) ?? {
        id: hotspot.name,
        name: hotspot.name,
        status: "Unavailable",
      },
    }));
    return <MobileMarketView items={mobileItems} loading={loading} />;
  }

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
            const stall = stallsByName.get(hotspot.name);
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
                {hs && (
                  <StallPopup
                    stall={hs}
                    onClose={() => undefined}
                    showClose={false}
                    tooltip
                    caretPlacement={placement === "bottom" ? "top" : "bottom"}
                  />
                )}
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
        style={[
          styles.header,
          isMobileOrTablet && { position: "relative", zIndex: 20 },
          // Rotated cards extend beyond their untransformed layout boxes.
          // Reserve proportional space so the blueprint always begins with
          // a visible gap below the cards on every phone width.
          isMobile && { minHeight: 145 * mobileScale },
        ]}
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
            ]}
            onPress={() => router.replace("/")}
          >
            <Text
              style={[
                styles.backBtnPillText,
                isMobile && { fontSize: 14 * mobileScale, transform: [{ rotate: "90deg" }] },
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
            ]}
          >
            2D Market View
          </Text>
          <View style={{ width: 64 }} />
        </View>

      {isTabletRange && (
        <View style={styles.tabletInfoRow}>
          <View style={styles.tabletStatusCard}>
            <View style={styles.tabletLiveDot} />
            <Text style={styles.tabletStatusText}>
              {loading ? "Loading live availability…" : `${occupiedCount} of ${stalls.length} stalls occupied`}
            </Text>
          </View>
          <Text style={styles.tabletInstruction}>Tap a stall to view its stall information.</Text>
        </View>
      )}

      <View
        style={{ flex: 1, position: "relative" }}
        onLayout={(e) => setMeasuredContentHeight(e.nativeEvent.layout.height)}
      >

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
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DDD8CA",
    shadowColor: "#17211D",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
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
  tabletInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 26,
    paddingHorizontal: 24,
    paddingBottom: 24,
    backgroundColor: "#F4F1E8",
  },
  tabletStatusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#E3F1E8",
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 14,
  },
  tabletLiveDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#0B7A57",
  },
  tabletStatusText: { color: "#0B6247", fontSize: 18, fontWeight: "700" },
  tabletInstruction: { color: "#4F554F", fontSize: 17, lineHeight: 24 },
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

const mobileStyles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: MOBILE_BG},
  header: {
    minHeight: 92,
    paddingTop: 34,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: MOBILE_PRIMARY,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerButton: {width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.14)"},
  headerButtonPlaceholder: {width: 42},
  headerTitle: {fontSize: 24, fontWeight: "800", color: "#fff"},
  content: {padding: 12, paddingBottom: 36},
  mapCard: {position: "relative", overflow: "hidden", borderRadius: 18, backgroundColor: "#DDE8E2", borderWidth: 1, borderColor: "#CBD8D1"},
  mapImage: {width: "100%", height: "100%"},
  hotspot: {position: "absolute", borderRadius: 2},
  mapLoading: {position: "absolute", inset: 0 as any, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.55)"},
  sheet: {marginTop: 12, padding: 12, borderRadius: 22, backgroundColor: "#fff", shadowColor: "#14251E", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: {width: 0, height: 5}, elevation: 3},
  sheetTitle: {fontSize: 22, fontWeight: "800", color: "#123D2F", marginBottom: 10},
  selectedCard: {position: "relative", borderRadius: 16, backgroundColor: "#EFFAF5", padding: 14, marginBottom: 10},
  selectedClose: {position: "absolute", right: 10, top: 10, zIndex: 2},
  selectedCode: {fontSize: 24, fontWeight: "900", color: "#14231D", paddingRight: 34},
  selectedCategory: {fontSize: 13, fontWeight: "700", color: "#16845F", marginTop: 2},
  selectedDetails: {marginTop: 10, gap: 5},
  selectedDetail: {fontSize: 13, color: "#46524D"},
  statusPill: {alignSelf: "flex-start", borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4, marginTop: 2},
  statusText: {fontSize: 11, fontWeight: "800"},
  descriptionButton: {marginTop: 12, height: 42, borderRadius: 13, backgroundColor: MOBILE_PRIMARY, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8},
  descriptionButtonText: {fontSize: 13, fontWeight: "800", color: "#fff"},
  stallRow: {minHeight: 70, paddingHorizontal: 8, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 9},
  stallRowActive: {backgroundColor: "#EFFAF5", borderRadius: 13},
  stallIcon: {width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#DFF4EB"},
  stallInfo: {flex: 1, minWidth: 0},
  stallCode: {fontSize: 16, fontWeight: "800", color: "#17211D"},
  stallMeta: {marginTop: 2, fontSize: 11, color: "#69716D"},
  stallRight: {alignItems: "flex-end", maxWidth: 105},
  stallPrice: {fontSize: 11, fontWeight: "800", color: "#24342D"},
  rowStatus: {marginTop: 3, fontSize: 10, fontWeight: "800"},
  pagination: {marginTop: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#E6EBE8", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8},
  pageButton: {minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3, paddingHorizontal: 10, borderRadius: 12, backgroundColor: "#E4F3EC"},
  pageButtonDisabled: {backgroundColor: "#F1F2F1"},
  pageButtonText: {fontSize: 11, fontWeight: "800", color: MOBILE_PRIMARY},
  pageButtonTextDisabled: {color: "#AAB1AD"},
  pageLabel: {fontSize: 11, fontWeight: "700", color: "#59645F"},
  emptyText: {paddingVertical: 28, textAlign: "center", color: "#6B746F", fontSize: 14},
  modalBackdrop: {flex: 1, padding: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(4, 22, 16, 0.58)"},
  modalCard: {width: "100%", maxWidth: 420, borderRadius: 24, padding: 20, backgroundColor: "#fff", shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: {width: 0, height: 8}, elevation: 8},
  modalHeader: {flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16},
  modalEyebrow: {fontSize: 10, fontWeight: "800", letterSpacing: 1.2, color: "#16845F"},
  modalTitle: {marginTop: 3, fontSize: 27, fontWeight: "900", color: "#14372B"},
  modalDescription: {fontSize: 14, lineHeight: 22, color: "#4A5651", marginBottom: 15},
  modalDetailsCard: {borderRadius: 16, paddingHorizontal: 14, backgroundColor: "#F4F8F5"},
  modalDetailRow: {minHeight: 47, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, borderBottomWidth: 1, borderBottomColor: "#DFE7E2"},
  modalDetailLabel: {fontSize: 12, color: "#68736E"},
  modalDetailValue: {flexShrink: 1, textAlign: "right", fontSize: 13, fontWeight: "800", color: "#23352E"},
  modalStatusPill: {alignSelf: "center", marginTop: 3},
  modalNote: {marginTop: 14, fontSize: 11, lineHeight: 17, color: "#77807C"},
  modalDone: {height: 48, marginTop: 18, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: MOBILE_PRIMARY},
  modalDoneText: {fontSize: 14, fontWeight: "800", color: "#fff"},
});
