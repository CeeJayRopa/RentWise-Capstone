import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  StyleSheet,
  Platform,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import NavigableMap from "../shared/components/NavigableMap";

// ─── Theme ───────────────────────────────────────────────────────────────────
const G_DARK = "#1B5E20";
const G_MID = "#2E7D32";
const G_LIGHT = "#4CAF50";
const G_BG = "#F1F8F1";
const GOLD = "#F5C518";
const DARK = "#1a1a1a";
const MUTED = "#666";
const WHITE = "#fff";

// ─── Data ────────────────────────────────────────────────────────────────────
const CATEGORIES = [
  {
    title: "Wet Market",
    sections: [
      {
        sectionTitle: "Fresh Seafood & Meat",
        desc: "Every morning, our wet market vendors bring in the day's freshest seafood catches, farm-raised meats, and locally harvested produce. From bangus to tilapia, pork to chicken — everything is sourced and delivered fresh daily.",
        image: require("../assets/wet_market.png"),
      },
      {
        sectionTitle: "Quality You Can Trust",
        desc: "Our vendors are carefully chosen to uphold high standards of freshness and hygiene. Whether you're a home cook or a restaurant owner, you'll find the quality and variety you need right here.",
        image: require("../assets/wet_market.png"),
      },
    ],
  },
  {
    title: "Dry Market",
    sections: [
      {
        sectionTitle: "Everything Your Pantry Needs",
        desc: "From premium rice and grains to a wide selection of canned goods and condiments, our dry market section has all your pantry staples in one convenient place.",
        image: require("../assets/dry_market.png"),
      },
      {
        sectionTitle: "A World of Flavors",
        desc: "Explore our spice and seasoning vendors who carry both local and imported varieties. Find exactly what you need to bring your recipes to life.",
        image: require("../assets/dry_market.png"),
      },
    ],
  },
  {
    title: "Home Essentials",
    sections: [
      {
        sectionTitle: "For Every Home",
        desc: "Whether you're setting up a new home or restocking supplies, our home essentials section has everything — from kitchenware and cookware to storage solutions and décor.",
        image: require("../assets/home_essentials.png"),
      },
      {
        sectionTitle: "Affordable & Reliable",
        desc: "Our vendors offer competitively priced household items including cleaning supplies, personal care products, and everyday consumables at great market prices.",
        image: require("../assets/home_essentials.png"),
      },
    ],
  },
];

const STATS = [
  { label: "Total Stalls", value: "40" },
  { label: "Available Stalls", value: "5" },
  { label: "Buildings", value: "2" },
];


// ─── Component ───────────────────────────────────────────────────────────────
export default function GuestLanding() {
  const { width, height } = useWindowDimensions();
  const isMobile  = width <= 480;
  const isTablet  = width > 480 && width <= 1024;
  const isDesktop = width > 1024;

  // Responsive helpers
  const hPad   = isMobile ? 16  : isTablet ? 32  : 80;
  const secPad = isMobile ? 40  : isTablet ? 56  : 72;

  const scrollRef = useRef<ScrollView>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Section y-offsets collected via onLayout
  const offsets = useRef<Record<string, number>>({});

  const scrollTo = (key: string) => {
    scrollRef.current?.scrollTo({
      y: offsets.current[key] ?? 0,
      animated: true,
    });
    setMenuOpen(false);
  };

  // ── Web-only animations ────────────────────────────────────────────────────
  React.useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;

    // 1. Inject CSS
    const css = document.createElement("style");
    css.id = "rw-anim";
    css.textContent = `
      .rw-reveal {
        opacity: 0;
        transform: translateY(28px);
        transition: opacity 0.7s ease, transform 0.7s ease;
      }
      .rw-reveal.rw-in {
        opacity: 1;
        transform: translateY(0);
      }
      .rw-d1 { transition-delay: 0.10s; }
      .rw-d2 { transition-delay: 0.20s; }
      .rw-d3 { transition-delay: 0.30s; }
      .rw-d4 { transition-delay: 0.40s; }
      .rw-d5 { transition-delay: 0.50s; }

      .rw-feat {
        transition: transform 0.3s ease, box-shadow 0.3s ease, background-color 0.3s ease !important;
      }
      .rw-feat:hover {
        transform: translateY(-6px) !important;
        box-shadow: 0 14px 36px rgba(0,0,0,0.13) !important;
        background-color: #e8f5e9 !important;
      }
      .rw-feat-icon {
        display: inline-block;
        transition: transform 0.3s ease;
      }
      .rw-feat:hover .rw-feat-icon {
        transform: scale(1.1);
      }

      /* Nav links */
      .rw-nav-link {
        transition: color 0.2s ease, transform 0.2s ease;
        display: inline-block;
        cursor: pointer;
      }
      .rw-nav-link:hover {
        color: #4CAF50 !important;
        transform: translateY(-2px);
      }

      /* Primary green buttons (CTA, Navigate) */
      @keyframes btnGlow {
        0%   { box-shadow: 0 0 0 0   rgba(76,175,80,0.55); }
        100% { box-shadow: 0 0 0 14px rgba(76,175,80,0);   }
      }
      .rw-btn-primary {
        position: relative;
        overflow: hidden;
        transition: transform 0.25s ease, filter 0.25s ease;
        cursor: pointer;
      }
      /* shimmer pseudo-element */
      .rw-btn-primary::after {
        content: '';
        position: absolute;
        top: 0; left: -100%;
        width: 55%; height: 100%;
        background: linear-gradient(
          90deg,
          transparent,
          rgba(255,255,255,0.30),
          transparent
        );
        transition: left 0.55s ease;
        pointer-events: none;
      }
      .rw-btn-primary:hover::after {
        left: 160%;
      }
      .rw-btn-primary:hover {
        transform: translateY(-4px) scale(1.04);
        filter: brightness(1.13);
        animation: btnGlow 0.8s ease-out forwards;
      }
      .rw-btn-primary:active {
        transform: translateY(0) scale(0.97);
        filter: brightness(0.95);
      }

      /* Social chips */
      .rw-social-chip {
        transition: transform 0.2s ease, border-color 0.2s ease, background-color 0.2s ease;
        cursor: pointer;
      }
      .rw-social-chip:hover {
        transform: translateY(-2px);
        border-color: rgba(255,255,255,0.6) !important;
        background-color: rgba(255,255,255,0.1) !important;
      }

      /* Mobile dropdown items */
      .rw-dropdown-item {
        transition: background-color 0.2s ease;
        cursor: pointer;
      }
      .rw-dropdown-item:hover {
        background-color: #1a1a1a !important;
      }
    `;
    document.head.appendChild(css);

    // 2. Scroll-reveal observer (once: true)
    const revealObs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("rw-in");
            revealObs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "-100px 0px" }
    );

    // 3. Counter observer
    const COUNTER_TARGETS = [40, 5, 2];
    let countersStarted = false;
    const counterObs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && !countersStarted) {
            countersStarted = true;
            COUNTER_TARGETS.forEach((target, i) => {
              const el = document.getElementById(`rw-stat-${i}`);
              if (!el) return;
              const start = performance.now();
              const dur = 1500;
              const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
              const tick = (now: number) => {
                const p = Math.min((now - start) / dur, 1);
                el.textContent = String(Math.round(easeOut(p) * target));
                if (p < 1) requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            });
          }
        });
      },
      { threshold: 0.5 }
    );

    // Wire everything up after layout settles
    const timer = setTimeout(() => {
      document.querySelectorAll(".rw-reveal").forEach((el) => revealObs.observe(el));
      document.querySelectorAll(".rw-feat-target").forEach((el) => el.classList.add("rw-feat"));
      const statsEl = document.getElementById("rw-stats");
      if (statsEl) counterObs.observe(statsEl);
    }, 250);

    return () => {
      clearTimeout(timer);
      revealObs.disconnect();
      counterObs.disconnect();
      document.getElementById("rw-anim")?.remove();
    };
  }, []);

  const cardPct     = isMobile ? "100%" : "30%";

  return (
    <View style={styles.screen}>
      {/* ── NavBar ─────────────────────────────────────────────────────────── */}
      <View style={styles.navbar}>
        <Text style={styles.brand}>RentWise</Text>

        {!isDesktop ? (
          <TouchableOpacity onPress={() => setMenuOpen((v) => !v)}>
            <Text style={styles.hamburgerIcon}>≡</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.navLinks}>
            {[
              { label: "Wet Market",      key: "Wet Market" },
              { label: "Dry Market",      key: "Dry Market" },
              { label: "Home Essentials", key: "Home Essentials" },
              { label: "Contact",         key: "contact" },
            ].map((item) => (
              <TouchableOpacity
                key={item.label}
                onPress={() => scrollTo(item.key)}
                {...({ className: "rw-nav-link" } as any)}
              >
                <Text style={styles.navLink}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* Mobile dropdown */}
      {menuOpen && !isDesktop && (
        <View style={styles.dropdown}>
          {[
            { label: "Wet Market", onPress: () => scrollTo("Wet Market") },
            { label: "Dry Market", onPress: () => scrollTo("Dry Market") },
            { label: "Home Essentials", onPress: () => scrollTo("Home Essentials") },
            { label: "Contact", onPress: () => scrollTo("contact") },
          ].map((item) => (
            <TouchableOpacity
              key={item.label}
              style={styles.dropdownItem}
              onPress={item.onPress}
              {...({ className: "rw-dropdown-item" } as any)}
            >
              <Text style={styles.dropdownText}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll}>
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <View style={[styles.hero, { minHeight: isMobile ? 480 : isTablet ? 520 : 620 }]}>
          {/* Blueprint watermark */}
          <Image
            source={require("../assets/Ka_Domeng_background.png")}
            style={styles.heroBlueprintBg}
            resizeMode="cover"
          />
          {/* Dark-green overlay */}
          <View style={styles.heroOverlay} />

          <View
            style={[
              styles.heroContent,
              {
                paddingHorizontal: hPad,
                flexDirection: isDesktop ? "row" : "column",
                alignItems: isDesktop ? "center" : "flex-start",
                gap: isMobile ? 24 : 40,
              },
            ]}
          >
            {/* Left: text */}
            <View style={{ flex: isDesktop ? 1 : undefined, gap: 16, width: "100%" }}>
              <View style={styles.heroBadge}>
                <Text style={styles.heroBadgeText}>
                  Ka Domeng Talipapa Market
                </Text>
              </View>
              <Text
                style={[styles.heroHeadline, { fontSize: isMobile ? 26 : isTablet ? 38 : 54 }]}
              >
                Find the Perfect Stall{"\n"}for Your Business
              </Text>
              <Text style={[styles.heroDesc, { fontSize: isMobile ? 13 : isTablet ? 15 : 18 }]}>
                Explore available stalls at Igay Rd. Sto. Cristo, San Jose del Monte.
                Start your business journey today.
              </Text>
              <TouchableOpacity
                style={[styles.ctaBtn, isMobile && { alignSelf: "stretch" }]}
                onPress={() => router.push("/market-map")}
                {...({ className: "rw-btn-primary" } as any)}
              >
                <Text style={styles.ctaBtnText}>2d Market View →</Text>
              </TouchableOpacity>
            </View>

            {/* Right: advertisement video card */}
            {isDesktop && (
              <View style={styles.adCard}>
                {React.createElement("video", {
                  src: require("../assets/Ka_Domeng_video.mp4"),
                  autoPlay: true,
                  loop: true,
                  muted: true,
                  playsInline: true,
                  style: {
                    position: "absolute",
                    top: 0, left: 0,
                    width: "100%", height: "100%",
                    objectFit: "cover",
                  },
                })}
                {/* Label */}
                <View style={styles.adLabel}>
                  <Text style={styles.adLabelText}>
                    Ka Domeng Talipapa Market
                  </Text>
                  <Text style={styles.adLabelSub}>Advertisement</Text>
                </View>
              </View>
            )}
          </View>
        </View>

        {/* ── About header ─────────────────────────────────────────────────── */}
        <View
          style={[styles.section, { backgroundColor: G_BG, paddingVertical: secPad, paddingHorizontal: hPad }]}
          {...({ className: "rw-reveal" } as any)}
          onLayout={(e) => {
            offsets.current["about"] = e.nativeEvent.layout.y;
          }}
        >
          <Text style={styles.sectionLabel}>ABOUT THE MARKET</Text>
          <Text style={[styles.sectionTitle, { fontSize: isMobile ? 24 : 36 }]}>
            Your One-Stop Public Market
          </Text>
          <Text
            style={[styles.sectionDesc, { maxWidth: isMobile ? "100%" : 640, marginBottom: 0 }]}
          >
            Ka Domeng Talipapa is a thriving community market offering fresh
            produce, dry goods, and household essentials — all under one roof.
          </Text>
        </View>

        {/* ── Category sections ────────────────────────────────────────────── */}
        {CATEGORIES.map((cat, catIndex) => (
          <View
            key={cat.title}
            style={{ height: isDesktop ? height * 0.95 : undefined, flexDirection: "column" }}
            {...({ className: "rw-reveal" } as any)}
            onLayout={(e) => {
              offsets.current[cat.title] = e.nativeEvent.layout.y;
            }}
          >
            {/* Banner */}
            <View style={styles.catBanner}>
              <Text style={[styles.catTitleBarText, { fontSize: isMobile ? 24 : 38, color: WHITE }]}>
                {cat.title}
              </Text>
              <View style={styles.catBannerLine} />
            </View>

            {/* Rows */}
            <View style={{ flex: 1 }}>
              {cat.sections.map((sec, i) => (
                <View
                  key={sec.sectionTitle}
                  style={[
                    styles.catRow,
                    {
                      flex: isDesktop ? 1 : undefined,
                      flexDirection: !isDesktop
                        ? "column"
                        : i % 2 === 1
                        ? "row-reverse"
                        : "row",
                    },
                  ]}
                >
                  {/* Image */}
                  <View style={[styles.catImageBlock, {
                    height: isMobile ? 220 : isTablet ? 280 : undefined,
                    flex: isDesktop ? 1 : undefined,
                  }]}>
                    <View style={styles.catImageCard}>
                      <Image source={sec.image} style={styles.catImage} resizeMode="cover" />
                      <View style={styles.catImageDim} />
                    </View>
                  </View>

                  {/* Dark text panel */}
                  <View style={[styles.catTextBlock, { padding: isMobile ? 20 : isTablet ? 28 : 52 }]}>
                    <Text style={styles.catPanelNum}>0{i + 1}</Text>
                    <Text style={[styles.catRowTitle, { fontSize: isMobile ? 18 : isTablet ? 20 : 26 }]}>
                      {sec.sectionTitle}
                    </Text>
                    <View style={styles.catDivider} />
                    <Text style={styles.catRowDesc}>{sec.desc}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ))}

        {/* ── Market Overview (Stats) ───────────────────────────────────────── */}
        <View
          nativeID="rw-stats"
          style={[styles.section, { backgroundColor: G_MID, paddingVertical: secPad, paddingHorizontal: hPad }]}
          {...({ className: "rw-reveal" } as any)}
        >
          <Text
            style={[styles.sectionLabel, { color: "rgba(255,255,255,0.7)" }]}
          >
            MARKET OVERVIEW
          </Text>
          <Text
            style={[
              styles.sectionTitle,
              { color: WHITE, fontSize: isMobile ? 24 : 36 },
            ]}
          >
            By the Numbers
          </Text>

          <View style={[styles.cardRow, { gap: isMobile ? 12 : 24 }]}>
            {STATS.map((stat, i) => (
              <View
                key={stat.label}
                style={[styles.statCard, { width: cardPct as any }]}
                {...({ className: `rw-reveal rw-d${i + 1}` } as any)}
              >
                <Text nativeID={`rw-stat-${i}`} style={styles.statValue}>{stat.value}</Text>
                <Text style={styles.statLabel}>{stat.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Find Us (Mapbox) ─────────────────────────────────────────────── */}
        <View
          style={[styles.section, { backgroundColor: G_BG, paddingVertical: secPad, paddingHorizontal: hPad }]}
          {...({ className: "rw-reveal" } as any)}
        >
          <Text style={styles.sectionLabel}>LOCATION</Text>
          <Text style={[styles.sectionTitle, { fontSize: isMobile ? 22 : isTablet ? 28 : 36 }]}>
            Find Us
          </Text>
          <Text
            style={[styles.sectionDesc, { maxWidth: isMobile ? "100%" : isTablet ? "100%" : 540 }]}
          >
            We are located at Igay Rd. Sto. Cristo, San Jose del Monte, Bulacan.
            Use the interactive map below to find our exact location.
          </Text>

          <NavigableMap
            height={isMobile ? 260 : isTablet ? 360 : 440}
            isMobile={isMobile}
          />
        </View>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <View
          style={[styles.footer, { paddingHorizontal: hPad }]}
          onLayout={(e) => {
            offsets.current["contact"] = e.nativeEvent.layout.y;
          }}
        >
          <View
            style={[
              styles.footerInner,
              {
                flexDirection: isMobile ? "column" : "row",
                flexWrap: isTablet ? "wrap" : "nowrap",
                gap: isMobile ? 32 : isTablet ? 40 : 60,
                alignItems: isMobile ? "center" : "flex-start",
              },
            ]}
          >
            {/* Brand */}
            <View
              style={[
                styles.footerCol,
                {
                  width: isMobile ? "100%" : isTablet ? ("47%" as any) : undefined,
                  alignItems: isMobile ? "center" : "flex-start",
                },
              ]}
            >
              <Text style={styles.footerBrand}>RentWise</Text>
              <Text style={[styles.footerMuted, isMobile && { textAlign: "center" }]}>
                Connecting businesses with the right market space since day one.
              </Text>
            </View>

            {/* Contact */}
            <View
              style={[
                styles.footerCol,
                {
                  width: isMobile ? "100%" : isTablet ? ("47%" as any) : undefined,
                  alignItems: isMobile ? "center" : "flex-start",
                },
              ]}
            >
              <Text style={styles.footerHeading}>Contact</Text>
              <Text style={[styles.footerMuted, isMobile && { textAlign: "center" }]}>Ka Domeng Talipapa Market</Text>
              <Text style={[styles.footerMuted, isMobile && { textAlign: "center" }]}>Igay Rd. Sto. Cristo, San Jose del Monte, Bulacan</Text>
              <Text style={[styles.footerMuted, isMobile && { textAlign: "center" }]}>info@rentwise.ph</Text>
            </View>

            {/* Social */}
            <View
              style={[
                styles.footerCol,
                {
                  width: isMobile ? "100%" : isTablet ? ("100%" as any) : undefined,
                  alignItems: isMobile ? "center" : "flex-start",
                },
              ]}
            >
              <Text style={styles.footerHeading}>Follow Us</Text>
              <View style={[styles.socialRow, isMobile && { justifyContent: "center" }]}>
                {["Facebook", "Instagram", "Twitter"].map((s) => (
                  <TouchableOpacity key={s} style={styles.socialChip} {...({ className: "rw-social-chip" } as any)}>
                    <Text style={styles.socialChipText}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          <View style={styles.footerDivider} />
          <Text style={styles.footerCopy}>
            © {new Date().getFullYear()} RentWise. All rights reserved.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: WHITE },

  // NavBar
  navbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: DARK,
    paddingHorizontal: 24,
    paddingVertical: 14,
    paddingTop: Platform.OS === "ios" ? 52 : 14,
    zIndex: 100,
  },
  brand: { color: WHITE, fontSize: 20, fontWeight: "800", letterSpacing: 0.5 },
  navLinks: { flexDirection: "row", gap: 32 },
  navLink: { color: "rgba(255,255,255,0.85)", fontSize: 15, fontWeight: "500" },
  hamburgerIcon: { color: WHITE, fontSize: 28 },

  tenantsDropdown: {
    position: "absolute",
    top: 32,
    left: 0,
    backgroundColor: "#111",
    borderRadius: 10,
    overflow: "hidden",
    minWidth: 200,
    zIndex: 999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  tenantsDropdownItem: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#222",
  },
  tenantsDropdownText: { color: WHITE, fontSize: 14, fontWeight: "600" },

  dropdown: {
    position: "absolute",
    top: 58,
    left: 0,
    right: 0,
    backgroundColor: "#111",
    zIndex: 200,
    borderBottomWidth: 1,
    borderBottomColor: "#333",
  },
  dropdownItem: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#222",
  },
  dropdownText: { color: WHITE, fontSize: 16 },

  scroll: { paddingBottom: 0 },

  // Hero
  hero: {
    backgroundColor: G_DARK,
    justifyContent: "center",
    overflow: "hidden",
  },
  heroBlueprintBg: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    height: "100%",
    opacity: 0.3,
  },
  heroOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(27,94,32,0.55)",
  },
  heroContent: {
    paddingVertical: 80,
    gap: 20,
  },
  heroBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(245,197,24,0.18)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: GOLD,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  heroBadgeText: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
  },
  heroHeadline: {
    color: WHITE,
    fontWeight: "800",
    lineHeight: 1.15 * 54,
    letterSpacing: -0.5,
  },
  heroDesc: {
    color: "rgba(255,255,255,0.82)",
    lineHeight: 26,
  },
  ctaBtn: {
    alignSelf: "flex-start",
    backgroundColor: G_LIGHT,
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: 32,
    marginTop: 8,
    maxWidth: 210,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  ctaBtnText: { color: WHITE, fontSize: 16, fontWeight: "700" },

  // Sections
  section: {
    paddingVertical: 72,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  sectionLabel: {
    color: G_LIGHT,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 2,
    marginBottom: 10,
    textAlign: "center",
  },
  sectionTitle: {
    color: DARK,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 16,
    letterSpacing: -0.3,
  },
  sectionDesc: {
    color: MUTED,
    fontSize: 16,
    lineHeight: 26,
    textAlign: "center",
    marginBottom: 48,
  },
  cardRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    width: "100%",
    maxWidth: 1100,
  },

  // About section — inline category blocks
  catBanner: {
    backgroundColor: G_DARK,
    paddingVertical: 28,
    paddingHorizontal: 32,
    alignItems: "center",
    gap: 6,
  },
  catBannerLine: {
    width: 48,
    height: 2,
    backgroundColor: GOLD,
    borderRadius: 2,
    marginTop: 8,
  },
  catTitleBar: {
    paddingVertical: 28,
    paddingHorizontal: 32,
    alignItems: "center",
    backgroundColor: G_DARK,
  },
  catTitleBarText: {
    color: WHITE,
    fontWeight: "800",
    letterSpacing: -0.3,
    textAlign: "center",
  },
  catRow: { alignItems: "stretch" },
  catImageBlock: {
    flex: 1,
    backgroundColor: "#111827",
    minHeight: 260,
    padding: 16,
  },
  catImageCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    overflow: "hidden",
    backgroundColor: "#111",
  },
  catImage: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    width: "100%",
    height: "100%",
  },
  catImageDim: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  catTextBlock: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "#111827",
  },
  catPanelNum: {
    color: G_LIGHT,
    fontSize: 40,
    fontWeight: "800",
    opacity: 0.25,
    marginBottom: 4,
    lineHeight: 44,
  },
  catRowTitle: { color: WHITE, fontWeight: "800", marginBottom: 12 },
  catDivider: {
    width: 40,
    height: 3,
    backgroundColor: G_LIGHT,
    borderRadius: 2,
    marginBottom: 16,
  },
  catRowDesc: { color: "rgba(255,255,255,0.65)", fontSize: 14, lineHeight: 24 },
  catArrow: {
    marginTop: 24,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  catArrowText: { color: WHITE, fontSize: 20 },

  // Stat cards
  statCard: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    margin: 6,
  },
  statValue: { color: GOLD, fontSize: 56, fontWeight: "800", lineHeight: 64 },
  statLabel: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 15,
    fontWeight: "600",
    marginTop: 8,
    textAlign: "center",
  },

  // Ad video card
  adCard: {
    width: 720,
    height: 420,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#000",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 12,
  },
  adThumbnail: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    height: "100%",
    opacity: 0.55,
  },
  adOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  adPlayBtn: {
    position: "absolute",
    top: "50%",
    left: "50%",
    marginTop: -28,
    marginLeft: -28,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  adPlayIcon: { fontSize: 20, color: G_DARK, marginLeft: 4 },
  adLabel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  adLabelText: { color: WHITE, fontSize: 14, fontWeight: "700" },
  adLabelSub: { color: "rgba(255,255,255,0.6)", fontSize: 11, marginTop: 2 },

  // Footer
  footer: {
    backgroundColor: DARK,
    paddingTop: 60,
    paddingBottom: 32,
    paddingHorizontal: 32,
  },
  footerInner: {
    justifyContent: "space-between",
    flexWrap: "wrap",
    marginBottom: 40,
  },
  footerCol: { minWidth: 180, maxWidth: 300 },
  footerBrand: {
    color: WHITE,
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 10,
  },
  footerHeading: {
    color: WHITE,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 12,
  },
  footerMuted: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    lineHeight: 22,
    marginBottom: 4,
  },
  socialRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  socialChip: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  socialChipText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    fontWeight: "600",
  },
  footerDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.1)",
    marginBottom: 24,
  },
  footerCopy: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 12,
    textAlign: "center",
  },
});
