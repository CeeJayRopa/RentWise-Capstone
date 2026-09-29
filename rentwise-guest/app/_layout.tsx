import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  Poppins_800ExtraBold,
} from "@expo-google-fonts/poppins";

export default function Layout() {
  const [guestAccessAccepted, setGuestAccessAccepted] = useState(false);
  const [policyTab, setPolicyTab] = useState<"terms" | "privacy">("terms");
  const [fontsLoaded] = useFonts({
    ...Ionicons.font,
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Poppins_800ExtraBold,
  });

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;

    const styleId = "rentwise-guest-poppins";
    const existing = document.getElementById(styleId);
    if (existing) return;

    const style = document.createElement("style");
    style.id = styleId;
    // Let text inherit Poppins from the app root. Do not force it onto every
    // descendant: icon components rely on their own glyph font on web.
    style.textContent = "#root { font-family: Poppins_400Regular, sans-serif; }";
    document.head.appendChild(style);

    return () => style.remove();
  }, []);

  // Renders a beat of blank screen rather than the browser's default
  // sans-serif for the numbering/headline serif — on a scroll-driven,
  // no-nav site a flash of the wrong typeface reads as more "broken"
  // than a brief blank frame.
  if (!fontsLoaded) return null;

  return (
    <View style={styles.appRoot}>
      <Stack screenOptions={{ headerShown: false }} />
      <Modal
        visible={!guestAccessAccepted}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View style={styles.policyBackdrop}>
          <View style={styles.policyCard}>
            <Text style={styles.policyEyebrow}>RENTWISE GUEST ACCESS</Text>
            <Text style={styles.policyTitle}>Terms & Privacy</Text>
            <Text style={styles.policyIntro}>
              Please review and accept these policies before exploring the guest website.
            </Text>

            <View style={styles.policyTabs}>
              <Pressable
                style={[styles.policyTab, policyTab === "terms" && styles.policyTabActive]}
                onPress={() => setPolicyTab("terms")}
              >
                <Text style={[styles.policyTabText, policyTab === "terms" && styles.policyTabTextActive]}>
                  Terms of Use
                </Text>
              </Pressable>
              <Pressable
                style={[styles.policyTab, policyTab === "privacy" && styles.policyTabActive]}
                onPress={() => setPolicyTab("privacy")}
              >
                <Text style={[styles.policyTabText, policyTab === "privacy" && styles.policyTabTextActive]}>
                  Privacy Policy
                </Text>
              </Pressable>
            </View>

            <ScrollView style={styles.policyScroll} contentContainerStyle={styles.policyContent}>
              {policyTab === "terms" ? (
                <>
                  <Text style={styles.policyHeading}>Terms of Use</Text>
                  <Text style={styles.policyBody}>
                    RentWise provides public market information, stall availability, maps, and an AR preview for
                    general viewing. Information may change as market records are updated. Visitors must use the
                    website lawfully and must not attempt to disrupt, copy, manipulate, or gain unauthorized access
                    to the website, its services, or its data.
                  </Text>
                  <Text style={styles.policyBody}>
                    Map directions and AR measurements are guides only. Visitors should confirm availability,
                    dimensions, pricing, and rental details with KaDomeng market management before making decisions.
                    Continued use means that you accept these terms.
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.policyHeading}>Privacy Policy</Text>
                  <Text style={styles.policyBody}>
                    The guest website displays public market information and does not require a visitor account.
                    Technical services may process limited device, browser, security, and usage information needed
                    to load maps, protect the website, and operate its features.
                  </Text>
                  <Text style={styles.policyBody}>
                    If you contact KaDomeng through the provided phone number or Facebook link, the information you
                    choose to provide is handled through that communication service. RentWise does not sell visitor
                    information. Access is limited to authorized services and personnel where required for security
                    and operation.
                  </Text>
                </>
              )}
            </ScrollView>

            <Text style={styles.policyAgreement}>
              By selecting Agree & Continue, you confirm that you have reviewed both policies.
            </Text>
            <Pressable style={styles.policyAcceptButton} onPress={() => setGuestAccessAccepted(true)}>
              <Text style={styles.policyAcceptText}>Agree & Continue</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  appRoot: { flex: 1 },
  policyBackdrop: {
    flex: 1,
    backgroundColor: "rgba(6, 29, 22, 0.76)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  policyCard: {
    width: "100%",
    maxWidth: 620,
    maxHeight: "88%",
    backgroundColor: "#FFFDF8",
    borderRadius: 22,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.24,
    shadowRadius: 28,
    elevation: 12,
  },
  policyEyebrow: { color: "#16835F", fontSize: 11, fontWeight: "800", letterSpacing: 1.4 },
  policyTitle: { color: "#083E2D", fontSize: 28, fontWeight: "800", marginTop: 5 },
  policyIntro: { color: "#64706B", fontSize: 14, lineHeight: 20, marginTop: 8 },
  policyTabs: { flexDirection: "row", gap: 8, marginTop: 20, marginBottom: 14 },
  policyTab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: "#EDF2EE",
  },
  policyTabActive: { backgroundColor: "#0E6B54" },
  policyTabText: { color: "#53615B", fontSize: 13, fontWeight: "700" },
  policyTabTextActive: { color: "#FFFFFF" },
  policyScroll: { flexGrow: 0, maxHeight: 280, borderRadius: 12, backgroundColor: "#F6F3EC" },
  policyContent: { padding: 18 },
  policyHeading: { color: "#103D30", fontSize: 18, fontWeight: "800", marginBottom: 10 },
  policyBody: { color: "#45534D", fontSize: 13, lineHeight: 20, marginBottom: 12 },
  policyAgreement: { color: "#69746F", fontSize: 12, lineHeight: 17, marginTop: 15, marginBottom: 13 },
  policyAcceptButton: {
    backgroundColor: "#16835F",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 14,
  },
  policyAcceptText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
});
