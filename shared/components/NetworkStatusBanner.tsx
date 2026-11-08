import {useEffect, useRef, useState} from "react";
import {Animated, Platform, StatusBar, StyleSheet, Text} from "react-native";
import {NetworkStatus, subscribeNetworkStatus} from "../services/networkStatus";

export default function NetworkStatusBanner() {
  const [status, setStatus] = useState<NetworkStatus>("unknown");
  const [showBackOnline, setShowBackOnline] = useState(false);
  const previous = useRef<NetworkStatus>("unknown");
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => subscribeNetworkStatus((next) => {
    if (previous.current === "offline" && next === "online") {
      setShowBackOnline(true);
      setTimeout(() => setShowBackOnline(false), 2200);
    }
    previous.current = next;
    setStatus(next);
  }), []);

  const visible = status === "offline" || showBackOnline;
  useEffect(() => {
    Animated.timing(opacity, {toValue: visible ? 1 : 0, duration: 180, useNativeDriver: true}).start();
  }, [visible, opacity]);

  if (!visible) return null;
  const offline = status === "offline";
  return (
    <Animated.View pointerEvents="none" style={[styles.banner, offline ? styles.offline : styles.online, {opacity}]}>
      <Text style={styles.text}>{offline ? "Offline — showing saved data" : "Back online — data updated"}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    zIndex: 9999,
    elevation: 9999,
    top: 0,
    left: 0,
    right: 0,
    minHeight: 30 + (Platform.OS === "android" ? StatusBar.currentHeight ?? 0 : 0),
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight ?? 0 : 0,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  offline: {backgroundColor: "#A96500"},
  online: {backgroundColor: "#0E6B54"},
  text: {color: "#FFFFFF", fontSize: 12, fontWeight: "700", textAlign: "center"},
});
