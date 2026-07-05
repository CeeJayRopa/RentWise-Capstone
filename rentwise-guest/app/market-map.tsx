import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from "react-native";
import { useEffect, useState } from "react";
import { router } from "expo-router";
import StallDetails from "./stall-details";

export default function MarketMap() {
  const [Mapbox, setMapbox] = useState<any>(null);
  const [showVacant, setShowVacant] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web") {
      import("@rnmapbox/maps").then((module) => {
        const map = module.default;
        map.setAccessToken("YOUR_MAPBOX_TOKEN");
        setMapbox(() => map);
      });
    }
  }, []);

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backIcon}>◀</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>2D Market View</Text>
        <View style={styles.backBtn} />
      </View>

      {/* Map area */}
      <View style={styles.mapArea}>
        {Platform.OS !== "web" && Mapbox ? (
          <Mapbox.MapView style={StyleSheet.absoluteFill}>
            <Mapbox.Camera
              zoomLevel={16}
              centerCoordinate={[121.0437, 14.676]}
            />
          </Mapbox.MapView>
        ) : (
          <View style={styles.placeholder}>
            <View style={styles.diagLine1} />
            <View style={styles.diagLine2} />
          </View>
        )}

        {/* Stall details overlay (floats over the map) */}
        {showVacant && (
          <View style={styles.stallOverlay}>
            <StallDetails onClose={() => setShowVacant(false)} />
          </View>
        )}
      </View>

      {/* Bottom buttons */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => setShowVacant(true)}
        >
          <Text style={styles.actionBtnText}>Vacant Stalls</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => router.push("/ar-view")}
        >
          <Text style={styles.actionBtnText}>AR Viewing</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#000",
  },

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

  /* Map */
  mapArea: {
    flex: 1,
    backgroundColor: "#d4d4d4",
    overflow: "hidden",
  },
  placeholder: { flex: 1, backgroundColor: "#d4d4d4" },
  diagLine1: {
    position: "absolute",
    top: "50%",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "#aaa",
    transform: [{ rotate: "34deg" }, { scaleX: 3 }],
  },
  diagLine2: {
    position: "absolute",
    top: "50%",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "#aaa",
    transform: [{ rotate: "-34deg" }, { scaleX: 3 }],
  },

  /* Stall popup overlay */
  stallOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
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
