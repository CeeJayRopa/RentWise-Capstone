import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { useRef, useState } from "react";

const isWeb = Platform.OS === "web";

const DESCRIPTION =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque neque nibh, sollicitudin vit felis a, tincidunt egestas turpis. Mauris eget ipsum tempus, euismod libero non, rhoncus justo. Proin interdum, nibh at blandit porttitor, mi ligula vestibulum felis, at iaculis tellus lorem sed lorem. Donec molestie in nisi nec eleifend.";

function XPlaceholder({ height = 160 }: { height?: number }) {
  return (
    <View style={[styles.xBox, { height }]}>
      <View style={styles.xLine1} />
      <View style={styles.xLine2} />
    </View>
  );
}

function MarketSection({
  title,
  sectionRef,
}: {
  title: string;
  sectionRef?: (r: View | null) => void;
}) {
  if (isWeb) {
    return (
      <View ref={sectionRef} style={styles.sectionWeb}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.webRow}>
          <XPlaceholder height={200} />
          <View style={styles.webTextCol}>
            <Text style={styles.bodyText}>{DESCRIPTION}</Text>
          </View>
        </View>
        <View style={styles.webRow}>
          <View style={styles.webTextCol}>
            <Text style={styles.bodyText}>{DESCRIPTION}</Text>
          </View>
          <XPlaceholder height={200} />
        </View>
      </View>
    );
  }

  return (
    <View ref={sectionRef} style={styles.sectionMobile}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.mobileImgRow}>
        <XPlaceholder height={150} />
        <View style={{ width: 6 }} />
        <XPlaceholder height={150} />
      </View>
      <Text style={[styles.bodyText, { marginTop: 12 }]}>{DESCRIPTION}</Text>
      <View style={[styles.mobileImgRow, { marginTop: 12 }]}>
        <XPlaceholder height={150} />
        <View style={{ width: 6 }} />
        <XPlaceholder height={150} />
      </View>
      <Text style={[styles.bodyText, { marginTop: 12 }]}>{DESCRIPTION}</Text>
    </View>
  );
}

export default function AboutUs() {
  const scrollRef = useRef<ScrollView>(null);
  const dryRef = useRef<View>(null);
  const wetRef = useRef<View>(null);
  const essRef = useRef<View>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  function scrollTo(ref: React.RefObject<View | null>) {
    ref.current?.measureLayout(
      scrollRef.current as any,
      (_x: number, y: number) => {
        scrollRef.current?.scrollTo({ y, animated: true });
      },
      () => {}
    );
    setMenuOpen(false);
  }

  return (
    <View style={styles.screen}>
      {/* ── Header ── */}
      {isWeb ? (
        <View style={styles.webHeader}>
          <Text style={styles.brand}>RentWise</Text>
          <View style={styles.webNavLinks}>
            <TouchableOpacity onPress={() => router.push("/market-map")}>
              <Text style={styles.webNavLink}>2D Market View</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => scrollTo(dryRef)}>
              <Text style={styles.webNavLink}>Dry Market</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => scrollTo(wetRef)}>
              <Text style={styles.webNavLink}>Wet Market</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => scrollTo(essRef)}>
              <Text style={styles.webNavLink}>Home Essentials</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.mobileHeader}>
            <TouchableOpacity
              style={styles.hamburger}
              onPress={() => setMenuOpen(!menuOpen)}
            >
              <Text style={styles.hamburgerIcon}>≡</Text>
            </TouchableOpacity>
            <Text style={styles.brand}>RentWise</Text>
            <View style={styles.hamburger} />
          </View>

          {/* Section tab bar */}
          <View style={styles.tabBar}>
            {(
              [
                { label: "Dry Market", ref: dryRef },
                { label: "Wet Market", ref: wetRef },
                { label: "Home Essentials", ref: essRef },
              ] as { label: string; ref: React.RefObject<View | null> }[]
            ).map((item, i) => (
              <TouchableOpacity
                key={item.label}
                style={[styles.tab, i < 2 && styles.tabBorder]}
                onPress={() => scrollTo(item.ref)}
              >
                <Text style={styles.tabText}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {/* Hamburger dropdown */}
      {menuOpen && !isWeb && (
        <View style={styles.dropdown}>
          <TouchableOpacity
            style={styles.dropdownItem}
            onPress={() => {
              setMenuOpen(false);
              router.push("/market-map");
            }}
          >
            <Text style={styles.dropdownText}>2D Market View</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.playBtn}>
            <Text style={styles.playIcon}>▶</Text>
          </View>
        </View>

        {/* Market name */}
        <Text style={styles.marketTitle}>
          Ka Domeng Talipapa Wet and Dry Market
        </Text>

        {/* Sections */}
        <MarketSection
          title="Dry Market"
          sectionRef={(r) => {
            (dryRef as any).current = r;
          }}
        />
        <MarketSection
          title="Wet Market"
          sectionRef={(r) => {
            (wetRef as any).current = r;
          }}
        />
        <MarketSection
          title="Home Essentials"
          sectionRef={(r) => {
            (essRef as any).current = r;
          }}
        />

        {/* Footer */}
        <View style={styles.footer}>
          <TouchableOpacity style={styles.socialBtn}>
            <Text style={styles.socialText}>Social Media 1</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.socialBtn}>
            <Text style={styles.socialText}>Social Media 2</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },

  /* Web header */
  webHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1a1a1a",
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  webNavLinks: { flexDirection: "row", gap: 28 },
  webNavLink: { color: "#fff", fontSize: 15 },

  /* Mobile header */
  mobileHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1a1a1a",
    paddingHorizontal: 16,
    paddingTop: 44,
    paddingBottom: 12,
  },
  hamburger: { width: 36, alignItems: "center" },
  hamburgerIcon: { color: "#fff", fontSize: 26 },

  brand: { color: "#fff", fontSize: 20, fontWeight: "bold" },

  /* Tab bar */
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#1a1a1a",
    borderTopWidth: 1,
    borderTopColor: "#333",
  },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center" },
  tabBorder: { borderRightWidth: 1, borderRightColor: "#444" },
  tabText: { color: "#fff", fontSize: 12, fontWeight: "600" },

  /* Hamburger dropdown */
  dropdown: {
    position: "absolute",
    top: 100,
    left: 16,
    backgroundColor: "#1a1a1a",
    borderRadius: 8,
    zIndex: 100,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  dropdownItem: { paddingHorizontal: 20, paddingVertical: 14 },
  dropdownText: { color: "#fff", fontSize: 15 },

  /* Scroll */
  scroll: { paddingBottom: 48 },

  /* Hero */
  hero: {
    height: 220,
    backgroundColor: "#d4d4d4",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  playBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.85)",
    justifyContent: "center",
    alignItems: "center",
  },
  playIcon: { fontSize: 22, marginLeft: 4 },

  /* Market title */
  marketTitle: {
    fontSize: isWeb ? 28 : 20,
    fontWeight: "bold",
    textAlign: "center",
    paddingVertical: 20,
    paddingHorizontal: 16,
  },

  /* X placeholder */
  xBox: {
    flex: 1,
    backgroundColor: "#d4d4d4",
    overflow: "hidden",
  },
  xLine1: {
    position: "absolute",
    top: "50%",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "#aaa",
    transform: [{ rotate: "35deg" }, { scaleX: 4 }],
  },
  xLine2: {
    position: "absolute",
    top: "50%",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "#aaa",
    transform: [{ rotate: "-35deg" }, { scaleX: 4 }],
  },

  /* Web sections */
  sectionWeb: {
    paddingHorizontal: 40,
    paddingBottom: 24,
    paddingTop: 4,
    backgroundColor: "#f5f5f5",
    marginBottom: 8,
  },
  webRow: { flexDirection: "row", marginBottom: 8 },
  webTextCol: { flex: 1, justifyContent: "center", paddingHorizontal: 20 },

  /* Mobile sections */
  sectionMobile: {
    paddingHorizontal: 12,
    paddingBottom: 20,
    paddingTop: 4,
    backgroundColor: "#f5f5f5",
    marginBottom: 8,
  },
  mobileImgRow: { flexDirection: "row" },

  sectionTitle: {
    fontSize: isWeb ? 26 : 18,
    fontWeight: "bold",
    textAlign: "center",
    paddingVertical: 16,
  },
  bodyText: { fontSize: 12, lineHeight: 18, color: "#444" },

  /* Footer */
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 28,
  },
  socialBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: "#333",
    borderRadius: 6,
  },
  socialText: { color: "#fff", fontSize: 13 },
});
