import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { ArrowLeft, ExternalLink } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

const GUEST_AR_URL = "https://rentwise-kadomeng.site/?open=ar";

export default function ARWebViewScreen() {
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const openInChrome = async () => {
    await Linking.openURL(GUEST_AR_URL);
  };

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to tenant dashboard"
        >
          <ArrowLeft size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>TENANT TOOLS</Text>
          <Text style={styles.title}>AR Stall Designer</Text>
        </View>
        <TouchableOpacity
          style={styles.chromeButton}
          onPress={openInChrome}
          accessibilityRole="button"
          accessibilityLabel="Open AR designer in Chrome"
        >
          <ExternalLink size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <WebView
        ref={webViewRef}
        source={{ uri: GUEST_AR_URL }}
        style={styles.webView}
        originWhitelist={["https://*"]}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
        onLoadStart={() => {
          setLoading(true);
          setFailed(false);
        }}
        onLoadEnd={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setFailed(true);
        }}
        onHttpError={({ nativeEvent }) => {
          if (nativeEvent.statusCode >= 400) {
            setLoading(false);
            setFailed(true);
          }
        }}
      />

      {loading && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#13A874" />
          <Text style={styles.overlayTitle}>Loading AR designer</Text>
          <Text style={styles.overlayText}>Please allow camera access when requested.</Text>
        </View>
      )}

      {failed && (
        <View style={styles.overlay}>
          <Text style={styles.overlayTitle}>Unable to load AR inside the app</Text>
          <Text style={styles.overlayText}>Open the same AR designer in Chrome instead.</Text>
          <TouchableOpacity style={styles.fallbackButton} onPress={openInChrome}>
            <ExternalLink size={18} color="#FFFFFF" />
            <Text style={styles.fallbackText}>Open in Chrome</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#061E18" },
  header: {
    minHeight: 72,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#073C30",
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  heading: { flex: 1, marginHorizontal: 12 },
  eyebrow: { color: "#A9C8BE", fontSize: 10, fontWeight: "700", letterSpacing: 1.2 },
  title: { color: "#FFFFFF", fontSize: 19, fontWeight: "800", marginTop: 2 },
  chromeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  webView: { flex: 1, backgroundColor: "#000000" },
  overlay: {
    top: 72,
    right: 0,
    bottom: 0,
    left: 0,
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    backgroundColor: "#F5F2EA",
  },
  overlayTitle: { color: "#073C30", fontSize: 19, fontWeight: "800", marginTop: 16, textAlign: "center" },
  overlayText: { color: "#52645E", fontSize: 14, marginTop: 8, textAlign: "center", lineHeight: 20 },
  fallbackButton: {
    marginTop: 22,
    minHeight: 50,
    paddingHorizontal: 22,
    borderRadius: 25,
    flexDirection: "row",
    gap: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0E6B54",
  },
  fallbackText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
});
