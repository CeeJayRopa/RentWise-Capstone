import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { useBreakpoints } from "../shared/hooks/useBreakpoints";

const G_DARK = "#1B5E20";
const G_LIGHT = "#4CAF50";
const G_BG = "#F1F8F1";
const DARK = "#1a1a1a";
const MUTED = "#666";
const WHITE = "#fff";

const SECTIONS = [
  {
    title: "Everything Your Pantry Needs",
    desc: "From premium rice and grains to a wide selection of canned goods and condiments, our dry market section has all your pantry staples in one convenient place. Shop smarter and save time by getting everything you need under one roof.",
    image: require("../assets/dry_market.png"),
  },
  {
    title: "A World of Flavors",
    desc: "Explore our spice and seasoning vendors who carry both local and imported varieties. Whether you're cooking a classic Filipino dish or trying something new, you'll find exactly what you need to bring your recipes to life.",
    image: require("../assets/dry_market.png"),
  },
];

export default function DryMarket() {
  const { isMobile, isTablet } = useBreakpoints();

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/")
          }
          style={styles.backBtn}
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Dry Market</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.titleSection}>
          <Text style={styles.categoryLabel}>ABOUT THE MARKET</Text>
          <Text style={[styles.pageTitle, { fontSize: isMobile ? 28 : isTablet ? 34 : 40 }]}>
            🥬 Dry Market
          </Text>
          <Text style={styles.pageSubtitle}>
            Grains, canned goods, spices, and all your pantry staples — all in
            one place at Ka Domeng Talipapa Market.
          </Text>
        </View>

        {SECTIONS.map((section, i) => (
          <View
            key={section.title}
            style={[
              styles.row,
              {
                flexDirection: isMobile
                  ? "column"
                  : i % 2 === 1
                  ? "row-reverse"
                  : "row",
                minHeight: isMobile ? undefined : 360,
              },
            ]}
          >
            <View
              style={[styles.imageBlock, { height: isMobile ? 240 : undefined }]}
            >
              <Image
                source={section.image}
                style={styles.sectionImage}
                resizeMode="cover"
              />
            </View>
            <View style={[styles.textBlock, { padding: isMobile ? 28 : isTablet ? 40 : 56 }]}>
              <Text style={[styles.sectionTitle, { fontSize: isMobile ? 20 : isTablet ? 23 : 26 }]}>
                {section.title}
              </Text>
              <View style={styles.divider} />
              <Text style={styles.sectionDesc}>{section.desc}</Text>
            </View>
          </View>
        ))}

        <View style={styles.ctaSection}>
          <Text style={[styles.ctaHeading, { fontSize: isMobile ? 18 : isTablet ? 21 : 24 }]}>
            Interested in renting a stall?
          </Text>
          <TouchableOpacity
            style={styles.ctaBtn}
            onPress={() => router.push("/market-map")}
          >
            <Text style={styles.ctaBtnText}>Explore Available Stalls →</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: WHITE },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: DARK,
    paddingHorizontal: 20,
    paddingVertical: 14,
    paddingTop: Platform.OS === "ios" ? 52 : 14,
  },
  backBtn: { width: 80 },
  backText: { color: WHITE, fontSize: 15, fontWeight: "600" },
  headerTitle: { color: WHITE, fontSize: 17, fontWeight: "700" },
  scroll: { paddingBottom: 0 },
  titleSection: {
    backgroundColor: G_BG,
    paddingVertical: 64,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  categoryLabel: {
    color: G_LIGHT,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 2,
    marginBottom: 10,
  },
  pageTitle: {
    color: DARK,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 14,
  },
  pageSubtitle: {
    color: MUTED,
    fontSize: 16,
    lineHeight: 26,
    textAlign: "center",
    maxWidth: 560,
  },
  row: { alignItems: "stretch" },
  imageBlock: { flex: 1, backgroundColor: "#ccc", minHeight: 280 },
  sectionImage: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    width: "100%",
    height: "100%",
  },
  textBlock: { flex: 1, justifyContent: "center", backgroundColor: WHITE },
  sectionTitle: { color: DARK, fontWeight: "800", marginBottom: 12 },
  divider: {
    width: 48, height: 3,
    backgroundColor: G_LIGHT,
    borderRadius: 2,
    marginBottom: 16,
  },
  sectionDesc: { color: MUTED, fontSize: 15, lineHeight: 26 },
  ctaSection: {
    backgroundColor: G_DARK,
    paddingVertical: 64,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 20,
  },
  ctaHeading: { color: WHITE, fontWeight: "700", textAlign: "center" },
  ctaBtn: {
    backgroundColor: G_LIGHT,
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 32,
  },
  ctaBtnText: { color: WHITE, fontSize: 16, fontWeight: "700" },
});
