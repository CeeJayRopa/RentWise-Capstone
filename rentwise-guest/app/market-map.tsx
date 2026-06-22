import { View, Text, StyleSheet, TouchableOpacity, Platform, } from "react-native";
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
    <View style={styles.container}>
      {Platform.OS === "web" ? (
        <View style={styles.webMap}>
          <Text style={styles.title}>2D Market View</Text>

          <Text>Ka Domeng Talipapa Map</Text>
        </View>
      ) : Mapbox ? (
        <Mapbox.MapView style={styles.map}>
          <Mapbox.Camera
            zoomLevel={16}
            centerCoordinate={[
              121.0437,

              14.676,
            ]}
          />
        </Mapbox.MapView>
      ) : (
        <Text>Loading Map...</Text>
      )}

      <View style={styles.menu}>
        <TouchableOpacity
          style={styles.button}
          onPress={() => setShowVacant(true)}
        >
          <Text>Vacant Stalls</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.button}
          onPress={() => {
            if (Platform.OS === "web") {
              alert("AR viewing is only available on mobile devices.");
            } else {
              router.push("/ar-view");
            }
          }}
        >
          <Text>AR Viewing</Text>
        </TouchableOpacity>
      </View>

      {showVacant && (
        <View style={styles.popup}>
          <StallDetails />

          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => setShowVacant(false)}
          >
            <Text>Close</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,

    justifyContent: "center",

    alignItems: "center",
  },

  map: {
    flex: 1,

    width: "100%",
  },

  webMap: {
    flex: 1,

    justifyContent: "center",

    alignItems: "center",
  },

  menu: {
    position: "absolute",

    bottom: 40,

    left: 20,

    right: 20,
  },

  button: {
    padding: 15,

    borderWidth: 1,

    borderRadius: 10,

    backgroundColor: "#fff",

    alignItems: "center",

    marginTop: 10,
  },

  popup: {
    position: "absolute",

    top: 100,

    left: 20,

    right: 20,

    bottom: 100,

    backgroundColor: "#fff",

    borderRadius: 15,

    borderWidth: 1,

    padding: 20,
  },

  closeButton: {
    padding: 15,

    borderWidth: 1,

    borderRadius: 10,

    alignItems: "center",

    marginTop: 10,
  },

  title: {
    fontSize: 25,

    fontWeight: "bold",
  },
});
