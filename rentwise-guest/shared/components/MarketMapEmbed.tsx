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
import StallDetails from "../../app/stall-details";
import StallPopup from "./StallPopup";
import { getStalls } from "../../services/stallService";
import { MARKET_LAYOUT, normalizeStallName } from "../constants/marketLayout";

// Same blueprint asset/geometry as app/market-map.tsx, but sized to sit inline
// inside a page section instead of filling the whole screen — no header/back
// button, no viewport-height fitting, just a responsive width-based render.
const BLUEPRINT_ASPECT_RATIO = 1056 / 672;
const MIN_BLUEPRINT_WIDTH = 700;
const HOTSPOT_SHRINK = 0.94;

interface Stall {
  id: string;
  name?: string;
  status?: string;
  buildingNumber?: string;
  spaceDimension?: string;
  price?: number;
}

interface Props {
  maxWidth?: number;
}

export default function MarketMapEmbed({ maxWidth = 1100 }: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const blueprintWidth = Math.max(MIN_BLUEPRINT_WIDTH, Math.min(windowWidth - 32, maxWidth));

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
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        contentContainerStyle={styles.hScroll}
        showsHorizontalScrollIndicator={false}
      >
        <View
          style={[
            styles.blueprintContainer,
            { width: blueprintWidth, height: blueprintWidth / BLUEPRINT_ASPECT_RATIO },
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

      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => setShowVacant(true)}>
          <Text style={styles.actionBtnText}>Vacant Stalls</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => router.push("/ar-view")}>
          <Text style={styles.actionBtnText}>AR Viewing</Text>
        </TouchableOpacity>
      </View>

      {selectedStall && (
        <View style={[styles.popupOverlay, Platform.OS === "web" ? ({ position: "fixed" } as any) : null]}>
          <StallPopup stall={selectedStall} onClose={() => setSelectedStall(null)} />
        </View>
      )}
      {showVacant && (
        <View style={[styles.popupOverlay, Platform.OS === "web" ? ({ position: "fixed" } as any) : null]}>
          <StallDetails onClose={() => setShowVacant(false)} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", alignItems: "center" },
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
  actionRow: {
    flexDirection: "row",
    gap: 16,
    marginTop: 20,
    width: "100%",
    maxWidth: 420,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 14,
    backgroundColor: "#0E7C5A",
    borderRadius: 24,
    alignItems: "center",
  },
  actionBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  popupOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
    zIndex: 500,
  },
});
