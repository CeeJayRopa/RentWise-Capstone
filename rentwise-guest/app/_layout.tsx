import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import { useEffect, useState } from "react";
import {
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useBreakpoints } from "../shared/hooks/useBreakpoints";
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
  const [policiesRead, setPoliciesRead] = useState({ terms: false, privacy: false });
  const { isDesktop, isMobile } = useBreakpoints();
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

  const mustReadBothPolicies = !isDesktop;
  const canAccept = !mustReadBothPolicies || (policiesRead.terms && policiesRead.privacy);

  const handlePolicyScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    const bottomThreshold = 16;
    const reachedBottom =
      nativeEvent.layoutMeasurement.height + nativeEvent.contentOffset.y >=
      nativeEvent.contentSize.height - bottomThreshold;

    if (reachedBottom) {
      setPoliciesRead((current) =>
        current[policyTab] ? current : { ...current, [policyTab]: true },
      );
    }
  };

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
                  Terms of Use{policiesRead.terms ? "  ✓" : ""}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.policyTab, policyTab === "privacy" && styles.policyTabActive]}
                onPress={() => setPolicyTab("privacy")}
              >
                <Text style={[styles.policyTabText, policyTab === "privacy" && styles.policyTabTextActive]}>
                  Privacy Policy{policiesRead.privacy ? "  ✓" : ""}
                </Text>
              </Pressable>
            </View>

            <ScrollView
              key={policyTab}
              style={[styles.policyScroll, isMobile && styles.policyScrollMobile]}
              contentContainerStyle={styles.policyContent}
              onScroll={handlePolicyScroll}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator
            >
              {policyTab === "terms" ? (
                <>
                  <Text style={styles.policyHeading}>Terms of Use</Text>
                  <Text style={styles.policySection}>1. Guest access</Text>
                  <Text style={styles.policyBody}>
                    RentWise provides public market information, stall availability, maps, and an AR preview for
                    general viewing. No account is required to browse the guest website. Information may change as
                    market records are updated and does not guarantee that a stall remains available.
                  </Text>
                  <Text style={styles.policySection}>2. Proper use</Text>
                  <Text style={styles.policyBody}>
                    Visitors must use the website lawfully and must not attempt to disrupt, copy, manipulate, scrape,
                    bypass security, or gain unauthorized access to the website, its services, accounts, or data.
                  </Text>
                  <Text style={styles.policySection}>3. Maps and AR preview</Text>
                  <Text style={styles.policyBody}>
                    Map directions, stall locations, and augmented-reality measurements are visual guides only.
                    Device sensors, camera conditions, map providers, and network availability may affect accuracy.
                  </Text>
                  <Text style={styles.policySection}>4. Confirming rental details</Text>
                  <Text style={styles.policyBody}>
                    Visitors should confirm availability, dimensions, pricing, requirements, and rental details with
                    KaDomeng market management before making a decision. By continuing, you confirm that you understand
                    and accept these terms.
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.policyHeading}>Privacy Policy</Text>
                  <Text style={styles.policySection}>1. Information processed</Text>
                  <Text style={styles.policyBody}>
                    The guest website displays public market information and does not require a visitor account.
                    Technical services may process limited device, browser, security, and usage information needed
                    to load maps, protect the website, and operate its features.
                  </Text>
                  <Text style={styles.policySection}>2. Camera and AR</Text>
                  <Text style={styles.policyBody}>
                    The AR feature requests camera access only when you choose to use it. Camera access is used to show
                    the live AR experience. RentWise does not use the guest page to create or store a camera recording.
                  </Text>
                  <Text style={styles.policySection}>3. External communication</Text>
                  <Text style={styles.policyBody}>
                    If you contact KaDomeng through the provided phone number or Facebook link, the information you
                    choose to provide is also handled under that communication service's privacy practices.
                  </Text>
                  <Text style={styles.policySection}>4. Use and protection</Text>
                  <Text style={styles.policyBody}>
                    RentWise does not sell visitor information. Limited technical information is used only to operate,
                    secure, maintain, and improve the guest experience. Access is limited to authorized services and
                    personnel where needed for security and operation.
                  </Text>
                </>
              )}
            </ScrollView>

            <Text style={styles.policyAgreement}>
              {canAccept
                ? "By selecting Agree & Continue, you confirm that you have reviewed both policies."
                : "Scroll to the bottom of both Terms of Use and Privacy Policy to continue."}
            </Text>
            <Pressable
              style={[styles.policyAcceptButton, !canAccept && styles.policyAcceptButtonDisabled]}
              onPress={() => setGuestAccessAccepted(true)}
              disabled={!canAccept}
              accessibilityState={{ disabled: !canAccept }}
            >
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
  policyScrollMobile: { maxHeight: 230 },
  policyContent: { padding: 18 },
  policyHeading: { color: "#103D30", fontSize: 18, fontWeight: "800", marginBottom: 10 },
  policySection: { color: "#103D30", fontSize: 13, fontWeight: "800", marginBottom: 4 },
  policyBody: { color: "#45534D", fontSize: 13, lineHeight: 20, marginBottom: 12 },
  policyAgreement: { color: "#69746F", fontSize: 12, lineHeight: 17, marginTop: 15, marginBottom: 13 },
  policyAcceptButton: {
    backgroundColor: "#16835F",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 14,
  },
  policyAcceptButtonDisabled: { backgroundColor: "#9AA8A2", opacity: 0.72 },
  policyAcceptText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
});
