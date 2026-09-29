import React, { useEffect, useRef, useState } from "react";
import {
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

const TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";
const MARKET_LNG = 121.086224;
const MARKET_LAT = 14.809394;
const MARKET_COORDS: [number, number] = [MARKET_LNG, MARKET_LAT];
const MARKET_NAME = "Ka Domeng Talipapa Market";
// Pre-fills the market's coordinates as the destination, so Google Maps opens
// straight into turn-by-turn directions with no extra typing/searching needed.
const GOOGLE_MAPS_URL = `https://www.google.com/maps/dir/?api=1&destination=${MARKET_LAT},${MARKET_LNG}&travelmode=driving`;

function injectMapboxCSS() {
  if (typeof document === "undefined") return;
  if (document.getElementById("mapbox-gl-css")) return;
  const link = document.createElement("link");
  link.id = "mapbox-gl-css";
  link.rel = "stylesheet";
  link.href = "https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.css";
  document.head.appendChild(link);
}

interface Props {
  height: number;
  isMobile?: boolean;
}

export default function NavigableMap({ height, isMobile = false }: Props) {
  const containerId = useRef(`nav-map-${Math.random().toString(36).slice(2)}`).current;
  const mapRef = useRef<any>(null);
  const [isRevealed, setIsRevealed] = useState(false);

  // Static preview map — just shows where the market is. Actual turn-by-turn
  // routing happens in Google Maps itself once the button below is tapped.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (!isRevealed) return;
    if (!TOKEN) {
      console.warn("[NavigableMap] EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN is not set.");
      return;
    }

    injectMapboxCSS();
    let destroyed = false;

    const timer = setTimeout(() => {
      const container = document.getElementById(containerId);
      if (!container || destroyed) return;

      import("mapbox-gl")
        .then(({ default: mapboxgl }) => {
          if (destroyed) return;
          mapboxgl.accessToken = TOKEN;

          const map = new mapboxgl.Map({
            container,
            style: "mapbox://styles/mapbox/streets-v12",
            center: MARKET_COORDS,
            zoom: 15,
            interactive: false,
            attributionControl: false,
          });
          map.addControl(new mapboxgl.AttributionControl({ compact: true }));
          mapRef.current = map;

          map.on("load", () => {
            if (destroyed) return;

            // Force canvas to recalculate its size after Expo Web layout settles
            setTimeout(() => map.resize(), 300);

            // Green circle marker
            const el = document.createElement("div");
            el.style.cssText = [
              "width:22px",
              "height:22px",
              "background:#4CAF50",
              "border:3px solid #fff",
              "border-radius:50%",
              "box-shadow:0 2px 8px rgba(0,0,0,0.35)",
              "cursor:default",
            ].join(";");

            const popup = new mapboxgl.Popup({ offset: 16, closeButton: false, closeOnClick: false }).setHTML(
              `<div style="font-size:13px;font-weight:700;color:#1a1a1a">${MARKET_NAME}</div>` +
              `<div style="font-size:11px;font-weight:400;color:#666;margin-top:2px">Main entrance, near Café Enrique</div>`
            );

            new mapboxgl.Marker({ element: el })
              .setLngLat(MARKET_COORDS)
              .setPopup(popup)
              .addTo(map);

            popup.addTo(map);
          });
        })
        .catch((err) => console.error("[NavigableMap]", err));
    }, 200);

    return () => {
      destroyed = true;
      clearTimeout(timer);
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRevealed]);

  function openInGoogleMaps() {
    Linking.openURL(GOOGLE_MAPS_URL);
  }

  if (Platform.OS !== "web") {
    return (
      <View style={[s.card, { height }]}>
        <View style={s.placeholder}>
          <Text style={s.placeholderText}>📍 Map available on web</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={s.root}>
      {!isRevealed ? (
        <View style={[s.revealCard, { height }]}>
          <View style={s.revealIconWrap}>
            <Ionicons name="location-outline" size={28} color={G_MID} />
          </View>
          <Text style={s.revealTitle}>Market location hidden</Text>
          <Text style={s.revealText}>Reveal the map when you are ready to view directions.</Text>
          <TouchableOpacity
            style={[s.revealBtn, isMobile && s.revealBtnMobile]}
            onPress={() => setIsRevealed(true)}
            accessibilityRole="button"
            accessibilityLabel="Reveal market map and navigation button"
            {...({ className: "rw-btn-primary" } as any)}
          >
            <Ionicons name="map-outline" size={18} color={WHITE} />
            <Text style={s.revealBtnText}>Reveal Market Map</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
      {/* ── Map card ── */}
      <View style={[s.card, { height }]}>
        {React.createElement("div", {
          id: containerId,
          style: { width: "100%", height: `${height}px` },
        })}
      </View>

      {/* ── Navigate button ── */}
      <TouchableOpacity
        style={[
          s.navBtn,
          isMobile && [s.navBtnMobile, { alignSelf: "stretch" }],
        ]}
        onPress={openInGoogleMaps}
        {...({ className: "rw-btn-primary" } as any)}
      >
        {isMobile ? (
          <>
            <View style={s.navBtnIconWrap}>
              <Ionicons name="navigate-outline" size={18} color="#fff" />
            </View>
            <Text style={s.navBtnTextMobile}>Navigate to Market</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </>
        ) : (
          <Text style={s.navBtnText}>Navigate to Market →</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={[s.hideBtn, isMobile && s.hideBtnMobile]}
        onPress={() => setIsRevealed(false)}
        accessibilityRole="button"
        accessibilityLabel="Hide market map and navigation button"
      >
        <Ionicons name="eye-off-outline" size={17} color={G_MID} />
        <Text style={s.hideBtnText}>Hide Map</Text>
      </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const G_MID = "#2E7D32";
const WHITE = "#fff";
const MUTED = "#666";

const s = StyleSheet.create({
  root: { width: "100%", alignSelf: "center", alignItems: "center" },
  revealCard: {
    width: "100%",
    borderRadius: 16,
    backgroundColor: "#F0F4EF",
    borderWidth: 1,
    borderColor: "#D9E5D8",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  revealIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#DDECDD",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  revealTitle: { color: "#17351E", fontSize: 18, fontWeight: "700", marginBottom: 6 },
  revealText: { color: MUTED, fontSize: 13, lineHeight: 19, textAlign: "center", marginBottom: 20 },
  revealBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: G_MID,
    paddingHorizontal: 24,
    paddingVertical: 13,
    borderRadius: 28,
  },
  revealBtnMobile: { alignSelf: "stretch" },
  revealBtnText: { color: WHITE, fontSize: 15, fontWeight: "700" },
  card: {
    width: "100%",
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#d4d4d4",
    marginBottom: 24,
    position: "relative",
  },
  placeholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#e0e0e0",
  },
  placeholderText: { fontSize: 16, color: MUTED },

  navBtn: {
    alignSelf: "center",
    backgroundColor: G_MID,
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 32,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
    marginBottom: 8,
  },
  navBtnText: { color: WHITE, fontSize: 16, fontWeight: "700" },
  hideBtn: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: G_MID,
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 28,
    marginTop: 4,
    marginBottom: 8,
  },
  hideBtnMobile: { alignSelf: "stretch" },
  hideBtnText: { color: G_MID, fontSize: 14, fontWeight: "700" },
  // Matches MarketMapEmbed's mobile action-pill layout (icon-in-circle,
  // label, trailing arrow) instead of the plain centered "label →" text.
  navBtnMobile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  navBtnIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  navBtnTextMobile: { flex: 1, color: WHITE, fontSize: 15, fontWeight: "700" },
});
