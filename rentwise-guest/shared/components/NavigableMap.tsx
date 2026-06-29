import React, { useEffect, useRef, useState } from "react";
import {
  Linking,
  Platform,
  StyleSheet, // still used for s = StyleSheet.create(...)
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";
const MARKET_LNG = 121.086224;
const MARKET_LAT = 14.809394;
const MARKET_COORDS: [number, number] = [MARKET_LNG, MARKET_LAT];
const MARKET_NAME = "Ka Domeng Talipapa Market";
const GOOGLE_MAPS_URL = `https://www.google.com/maps/dir/?api=1&destination=${MARKET_LAT},${MARKET_LNG}&travelmode=driving`;

type NavState = "idle" | "loading" | "active" | "denied";

interface Step {
  instruction: string;
  distance: number;
  duration: number;
}

function injectMapboxCSS() {
  if (typeof document === "undefined") return;
  if (document.getElementById("mapbox-gl-css")) return;
  const link = document.createElement("link");
  link.id = "mapbox-gl-css";
  link.rel = "stylesheet";
  link.href = "https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.css";
  document.head.appendChild(link);
}

function fmtDist(m: number) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}
function fmtTime(s: number) {
  const mins = Math.round(s / 60);
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}min`;
}

interface Props {
  height: number;
  isMobile?: boolean;
}

export default function NavigableMap({ height, isMobile = false }: Props) {
  const containerId = useRef(`nav-map-${Math.random().toString(36).slice(2)}`).current;
  const mapRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);

  const [navState, setNavState] = useState<NavState>("idle");
  const [badge, setBadge] = useState<{ distance: string; duration: string } | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);

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
          });
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
              `<span style="font-size:13px;font-weight:700;color:#1a1a1a">${MARKET_NAME}</span>`
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

  async function startNavigation() {
    const map = mapRef.current;
    if (!map) return;
    setNavState("loading");

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const userLng = pos.coords.longitude;
        const userLat = pos.coords.latitude;

        try {
          const { default: mapboxgl } = await import("mapbox-gl");

          // Enable full interaction
          map.scrollZoom.enable();
          map.boxZoom.enable();
          map.dragRotate.enable();
          map.dragPan.enable();
          map.keyboard.enable();
          map.doubleClickZoom.enable();
          map.touchZoomRotate.enable();

          // Blue user marker
          const userEl = document.createElement("div");
          userEl.style.cssText = [
            "width:16px",
            "height:16px",
            "background:#2196F3",
            "border:3px solid #fff",
            "border-radius:50%",
            "box-shadow:0 2px 8px rgba(0,0,0,0.35)",
          ].join(";");
          if (userMarkerRef.current) userMarkerRef.current.remove();
          userMarkerRef.current = new mapboxgl.Marker({ element: userEl })
            .setLngLat([userLng, userLat])
            .addTo(map);

          // Fetch driving route from Mapbox Directions API
          const url =
            `https://api.mapbox.com/directions/v5/mapbox/driving/` +
            `${userLng},${userLat};${MARKET_LNG},${MARKET_LAT}` +
            `?geometries=geojson&steps=true&overview=full&language=en` +
            `&access_token=${TOKEN}`;

          const res = await fetch(url);
          const data = await res.json();

          if (!data.routes?.length) throw new Error("No route found");

          const route = data.routes[0];

          // Draw route line
          if (map.getLayer("rw-route-line")) map.removeLayer("rw-route-line");
          if (map.getSource("rw-route")) map.removeSource("rw-route");

          map.addSource("rw-route", {
            type: "geojson",
            data: { type: "Feature", properties: {}, geometry: route.geometry },
          });
          map.addLayer({
            id: "rw-route-line",
            type: "line",
            source: "rw-route",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": "#4CAF50", "line-width": 5, "line-opacity": 0.9 },
          });

          // Fit both markers into view
          const coords: [number, number][] = route.geometry.coordinates;
          const bounds = coords.reduce(
            (b: any, c: [number, number]) => b.extend(c),
            new mapboxgl.LngLatBounds(coords[0], coords[0])
          );
          map.fitBounds(bounds, { padding: 60, maxZoom: 16 });

          setBadge({ distance: fmtDist(route.distance), duration: fmtTime(route.duration) });

          const rawSteps = route.legs?.[0]?.steps ?? [];
          setSteps(
            rawSteps.map((step: any) => ({
              instruction: step.maneuver?.instruction ?? "",
              distance: step.distance,
              duration: step.duration,
            }))
          );

          setNavState("active");
        } catch (err) {
          console.error("[NavigableMap] Route error:", err);
          setNavState("idle");
        }
      },
      () => setNavState("denied"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function stopNavigation() {
    const map = mapRef.current;
    if (map) {
      if (map.getLayer("rw-route-line")) map.removeLayer("rw-route-line");
      if (map.getSource("rw-route")) map.removeSource("rw-route");
      map.scrollZoom.disable();
      map.boxZoom.disable();
      map.dragRotate.disable();
      map.dragPan.disable();
      map.keyboard.disable();
      map.doubleClickZoom.disable();
      map.touchZoomRotate.disable();
      map.flyTo({ center: MARKET_COORDS, zoom: 15 });
    }
    if (userMarkerRef.current) {
      userMarkerRef.current.remove();
      userMarkerRef.current = null;
    }
    setBadge(null);
    setSteps([]);
    setNavState("idle");
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

        {badge && (
          <View style={s.badge}>
            <Text style={s.badgeText}>
              🚗 {badge.distance}{"  ·  "}{badge.duration}
            </Text>
          </View>
        )}

        {navState === "denied" && (
          <View style={s.deniedBanner}>
            <Text style={s.deniedText}>Location access denied.</Text>
            <TouchableOpacity onPress={() => Linking.openURL(GOOGLE_MAPS_URL)}>
              <Text style={s.deniedLink}>Open in Google Maps →</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* ── Navigate / Stop button ── */}
      <TouchableOpacity
        style={[
          s.navBtn,
          navState === "active" && s.navBtnStop,
          navState === "loading" && s.navBtnLoading,
          isMobile && { alignSelf: "stretch" },
        ]}
        onPress={navState === "active" ? stopNavigation : startNavigation}
        disabled={navState === "loading"}
        {...({ className: "rw-btn-primary" } as any)}
      >
        <Text style={s.navBtnText}>
          {navState === "loading"
            ? "Getting location…"
            : navState === "active"
            ? "Stop Navigation"
            : "Navigate to Market →"}
        </Text>
      </TouchableOpacity>

      {/* ── Turn-by-turn directions ── */}
      {steps.length > 0 && (
        <View style={s.stepsContainer}>
          <Text style={s.stepsTitle}>Turn-by-Turn Directions</Text>
          {steps.map((step, i) => (
            <View
              key={i}
              style={[s.stepRow, i === steps.length - 1 && { borderBottomWidth: 0 }]}
            >
              <View style={s.stepBubble}>
                <Text style={s.stepNum}>{i + 1}</Text>
              </View>
              <View style={s.stepInfo}>
                <Text style={s.stepInstruction}>{step.instruction}</Text>
                <Text style={s.stepMeta}>
                  {fmtDist(step.distance)}{"  ·  "}{fmtTime(step.duration)}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const G_LIGHT = "#4CAF50";
const G_MID = "#2E7D32";
const RED = "#c62828";
const WHITE = "#fff";
const DARK = "#1a1a1a";
const MUTED = "#666";

const s = StyleSheet.create({
  root: { width: "50%", alignSelf: "center", alignItems: "center" },
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

  badge: {
    position: "absolute",
    top: 12,
    left: 12,
    backgroundColor: "rgba(0,0,0,0.72)",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  badgeText: { color: WHITE, fontSize: 13, fontWeight: "700" },

  deniedBanner: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(198,40,40,0.92)",
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  deniedText: { color: WHITE, fontSize: 13, flex: 1 },
  deniedLink: { color: WHITE, fontSize: 13, fontWeight: "700", textDecorationLine: "underline" },

  navBtn: {
    alignSelf: "flex-start",
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
  navBtnStop: { backgroundColor: RED },
  navBtnLoading: { opacity: 0.65 },
  navBtnText: { color: WHITE, fontSize: 16, fontWeight: "700" },

  stepsContainer: {
    backgroundColor: WHITE,
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: "#e8e8e8",
  },
  stepsTitle: {
    color: DARK,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 12,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  stepBubble: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: G_LIGHT,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 1,
    flexShrink: 0,
  },
  stepNum: { color: WHITE, fontSize: 11, fontWeight: "800" },
  stepInfo: { flex: 1 },
  stepInstruction: { color: DARK, fontSize: 13, fontWeight: "500", lineHeight: 18 },
  stepMeta: { color: MUTED, fontSize: 11, marginTop: 3 },
});
