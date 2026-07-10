import React, { useEffect, useRef } from "react";
import {
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

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

  // Static preview map — just shows where the market is. Actual turn-by-turn
  // routing happens in Google Maps itself once the button below is tapped.
  useEffect(() => {
    if (Platform.OS !== "web") return;
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
  }, []);

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
      {/* ── Map card ── */}
      <View style={[s.card, { height }]}>
        {React.createElement("div", {
          id: containerId,
          style: { width: "100%", height: `${height}px` },
        })}
      </View>

      {/* ── Navigate button ── */}
      <TouchableOpacity
        style={[s.navBtn, isMobile && { alignSelf: "stretch" }]}
        onPress={openInGoogleMaps}
        {...({ className: "rw-btn-primary" } as any)}
      >
        <Text style={s.navBtnText}>Navigate to Market →</Text>
      </TouchableOpacity>
      <Text style={s.navCaption}>Opens Google Maps to the main entrance, near Café Enrique</Text>
    </View>
  );
}

const G_MID = "#2E7D32";
const WHITE = "#fff";
const MUTED = "#666";

const s = StyleSheet.create({
  root: { width: "100%", alignSelf: "center", alignItems: "center" },
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
  navCaption: { color: MUTED, fontSize: 12, marginTop: 2 },
});
