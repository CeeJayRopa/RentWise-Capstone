import { View, Text, Image, StyleSheet, Animated } from "react-native";
import { useEffect, useRef } from "react";
import { router } from "expo-router";

const LOADING_DURATION_MS = 10000;

export default function MapLoading() {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: LOADING_DURATION_MS,
      useNativeDriver: false, // width interpolation isn't supported by the native driver
    }).start();

    const timer = setTimeout(() => {
      router.replace("/market-map");
    }, LOADING_DURATION_MS);

    return () => clearTimeout(timer);
  }, []);

  const barWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });

  return (
    <View style={styles.screen}>
      <Image
        source={require("../assets/rotate screen icon.png")}
        style={styles.icon}
        resizeMode="contain"
      />
      <Text style={styles.title}>Preparing the 2D Market View</Text>
      <Text style={styles.quote}>Rotate your screen to view the map properly</Text>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { width: barWidth }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Matches the homepage hero section's cream background (app/index.tsx BG).
  screen: {
    flex: 1,
    backgroundColor: "#F4F1E8",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  icon: { width: 96, height: 96, marginBottom: 24 },
  // Matches the homepage's "Market Blueprint & Stall Status" title color/font
  // (MarketMapEmbed.tsx PRIMARY_DARK / PlayfairDisplay italic).
  title: {
    fontSize: 18,
    fontFamily: "PlayfairDisplay_700Bold_Italic",
    color: "#0B6247",
    marginBottom: 8,
    textAlign: "center",
  },
  quote: {
    fontSize: 14,
    fontStyle: "italic",
    color: "#5B6560",
    marginBottom: 24,
    textAlign: "center",
  },
  track: {
    width: "60%",
    maxWidth: 320,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#E7E5DE",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    backgroundColor: "#0B6247",
    borderRadius: 4,
  },
});
