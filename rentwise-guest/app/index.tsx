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
import { Ionicons } from "@expo/vector-icons";
import React, { useRef, useState } from "react";
import NavigableMap from "../shared/components/NavigableMap";
import FallingProduce, { ShieldRect } from "../shared/components/FallingProduce";
import MarketMapEmbed from "../shared/components/MarketMapEmbed";
import CategoryCarousel from "../shared/components/CategoryCarousel";

// ─── Theme ───────────────────────────────────────────────────────────────────
const PRIMARY = "#0E7C5A";
const PRIMARY_DARK = "#0B6247";
const PRIMARY_TINT = "#E4F3EC";
const ACCENT = "#E8994A";
const BG = "#FAFAF8";
const SURFACE = "#FFFFFF";
const BORDER = "#E7E5DE";
const TEXT_DARK = "#171A19";
const TEXT_MUTED = "#5B6560";
const HERO_DARK = "#0D1F1A";
const HERO_MUTED = "#B9D9CC";
const FOOTER_BG = "#12201C";
const FOOTER_MUTED = "#8FA79C";
const FOOTER_COPY = "#5C7268";
const WHITE = "#FFFFFF";

// ─── Data ────────────────────────────────────────────────────────────────────
// Each category's carousel reuses its own single photo across 7 placeholder
// slots for now — swap individual `image` entries for real per-stall photos
// once they're ready.
function repeatImage(image: any, count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: i + 1, image }));
}

const WET_MARKET_IMG = require("../assets/wet_market.png");
const DRY_MARKET_IMG = require("../assets/dry_market.png");
const HOME_ESSENTIALS_IMG = require("../assets/home_essentials.png");

const CATEGORIES = [
  {
    slug: "wet-market",
    title: "Wet Market",
    teaser:
      "Fresh seafood, farm-raised meats, and locally harvested produce sourced and delivered daily.",
    image: WET_MARKET_IMG,
    icon: "fish-outline",
    route: "/wet-market",
    cards: repeatImage(WET_MARKET_IMG, 7),
  },
  {
    slug: "dry-market",
    title: "Dry Market",
    teaser:
      "Rice, grains, canned goods, and pantry staples — plus local and imported spices.",
    image: DRY_MARKET_IMG,
    icon: "basket-outline",
    route: "/dry-market",
    cards: repeatImage(DRY_MARKET_IMG, 7),
  },
  {
    slug: "home-essentials",
    title: "Home Essentials",
    teaser:
      "Kitchenware, cleaning supplies, and everyday household items at market prices.",
    image: HOME_ESSENTIALS_IMG,
    icon: "home-outline",
    route: "/home-essentials",
    cards: repeatImage(HOME_ESSENTIALS_IMG, 7),
  },
] as const;

const PRODUCE_EMOJIS = [
  "🍎", "🥦", "🍊", "🍅", "🍋", "🥕", "🍇", "🌽", "🍌", "🍆", "🥑", "🍓", "🍈", "🥔",
] as const;

// Deterministic pseudo-random size jitter (no Math.random at module scope so the
// list is stable across fast-refresh / re-imports).
function seededSize(i: number, min: number, max: number) {
  const t = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
  return Math.round(min + t * (max - min));
}

const FALLING_ITEM_COUNT = 112; // 20% fewer than the original 140
const FALLING_ITEMS = Array.from({ length: FALLING_ITEM_COUNT }, (_, i) => ({
  emoji: PRODUCE_EMOJIS[i % PRODUCE_EMOJIS.length],
  size: seededSize(i, 24, 46),
}));

const STATS = [
  { label: "Total Stalls", value: "40", icon: "storefront-outline" },
  { label: "Available Stalls", value: "5", icon: "checkmark-circle-outline" },
  { label: "Buildings", value: "2", icon: "business-outline" },
] as const;

// ─── Component ───────────────────────────────────────────────────────────────
export default function GuestLanding() {
  const { width, height } = useWindowDimensions();
  const isMobile = width <= 480;
  const isTablet = width > 480 && width <= 1024;
  const isDesktop = width > 1024;

  // Responsive helpers
  const hPad = isMobile ? 16 : isTablet ? 32 : 80;
  const navPad = isMobile ? 16 : isTablet ? 32 : 64;
  const secPad = isMobile ? 40 : isTablet ? 56 : 72;
  const PIN_H = height;

  const scrollRef = useRef<ScrollView>(null);
  const [scrollY, setScrollY] = useState(0);
  const [activeCatIndex, setActiveCatIndex] = useState(0);
  // Continuous 0-1 progress across the whole pinned category track (not just
  // the rounded-off active index) — used to drive the Wet Market carousel.
  const [catProgress, setCatProgress] = useState(0);
  const [aboutShield, setAboutShield] = useState<ShieldRect | null>(null);

  // Category panel crossfade — eased by hand every frame (same reason as the
  // carousel: CSS transitions on toggled opacity weren't reliably animating
  // in this RN-Web setup, so it's driven imperatively instead).
  const activeCatIndexRef = useRef(0);
  const catPanelRefs = useRef<any[]>([]);
  const catPanelOpacity = useRef<number[]>(CATEGORIES.map((_, i) => (i === 0 ? 1 : 0)));
  React.useEffect(() => {
    if (Platform.OS !== "web") return;
    let rafId: number;
    const EASE = 0.07;
    const loop = () => {
      CATEGORIES.forEach((_, i) => {
        const target = activeCatIndexRef.current === i ? 1 : 0;
        catPanelOpacity.current[i] += (target - catPanelOpacity.current[i]) * EASE;
        const node = catPanelRefs.current[i];
        if (node && node.style) {
          node.style.opacity = String(catPanelOpacity.current[i]);
        }
      });
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Pinned category track: start y + total scrollable height, measured via onLayout
  const catTrackStart = useRef(0);
  const catTrackHeight = useRef(0);

  const goToCategory = (i: number) => {
    const total = catTrackHeight.current - PIN_H;
    if (total <= 0) return;
    const targetProgress = (i + 0.5) / CATEGORIES.length;
    scrollRef.current?.scrollTo({
      y: catTrackStart.current + targetProgress * total,
      animated: true,
    });
  };

  const handleScroll = (e: any) => {
    const y = e.nativeEvent.contentOffset.y;
    setScrollY(y);

    const total = catTrackHeight.current - PIN_H;
    if (total > 0) {
      const local = y - catTrackStart.current;
      const progress = Math.min(Math.max(local / total, 0), 1);
      const idx = Math.min(
        CATEGORIES.length - 1,
        Math.floor(progress * CATEGORIES.length)
      );
      activeCatIndexRef.current = idx;
      setActiveCatIndex(idx);
      setCatProgress(progress);
    }
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

      /* Primary buttons (CTA) */
      @keyframes btnGlow {
        0%   { box-shadow: 0 0 0 0   rgba(14,124,90,0.45); }
        100% { box-shadow: 0 0 0 14px rgba(14,124,90,0);   }
      }
      .rw-btn-primary {
        position: relative;
        overflow: hidden;
        transition: transform 0.25s ease, background-color 0.25s ease;
        cursor: pointer;
      }
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
        background-color: ${PRIMARY_DARK} !important;
        transform: translateY(-4px) scale(1.04);
        animation: btnGlow 0.8s ease-out forwards;
      }
      .rw-btn-primary:active {
        transform: translateY(0) scale(0.97);
      }


      /* Pinned category crossfade */
      .rw-pin-panel img {
        transform: scale(1.12);
        transition: transform 6s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.7s ease;
      }
      .rw-pin-panel.rw-pin-active img {
        transform: scale(1);
      }
      .rw-pin-dot {
        transition: width 0.3s ease, height 0.3s ease, background-color 0.3s ease;
        cursor: pointer;
      }

      /* Social chips */
      .rw-social-chip {
        transition: transform 0.2s ease, border-color 0.2s ease, background-color 0.2s ease;
        cursor: pointer;
      }
      .rw-social-chip:hover {
        transform: translateY(-2px);
        border-color: ${PRIMARY} !important;
        background-color: ${PRIMARY} !important;
      }

      /* Back to top */
      .rw-back-top {
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        cursor: pointer;
      }
      .rw-back-top:hover {
        transform: translateY(-4px);
        box-shadow: 0 14px 28px rgba(15,25,20,0.28) !important;
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
    const COUNTER_TARGETS = STATS.map((s) => parseInt(s.value, 10));
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

  const cardPct = isMobile ? "100%" : isTablet ? "45%" : "30%";
  const heroFontSize = isMobile ? 26 : isTablet ? 38 : 56;
  const heroImgWidth = Math.min(width * 0.8, 1180);
  const heroImgHeight = heroImgWidth / 1.7;

  return (
    <View style={styles.screen}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <View
          style={[
            styles.hero,
            { minHeight: isDesktop ? ("100vh" as any) : isMobile ? 480 : 560 },
          ]}
        >
          {/* Market photo background */}
          <Image
            source={require("../assets/Ka_Domeng_background.png")}
            style={styles.heroBlueprintBg}
            resizeMode="cover"
          />
          {/* Dark-green gradient overlay */}
          <View
            style={[
              styles.heroOverlay,
              Platform.OS === "web"
                ? ({
                    backgroundImage:
                      "linear-gradient(to right, rgba(10,31,26,0.90) 40%, rgba(10,31,26,0.35) 100%)",
                    backgroundColor: undefined,
                  } as any)
                : null,
            ]}
          />

          {/* Produce bag photo — bleeds off the right edge like the reference */}
          {isDesktop && (
            <View
              style={[
                styles.heroProduceImg,
                {
                  width: heroImgWidth,
                  height: heroImgHeight,
                  alignItems: "center",
                  justifyContent: "center",
                },
              ]}
            >
              {/* Circular "card" — image is clipped inside it, not just floating on top */}
              <View
                style={{
                  width: heroImgHeight * 0.9,
                  height: heroImgHeight * 0.9,
                  borderRadius: (heroImgHeight * 0.9) / 2,
                  backgroundColor: PRIMARY,
                  overflow: "hidden",
                }}
              >
                <Image
                  source={require("../assets/fruits and vegetable on a bag.png")}
                  style={{ width: "100%", height: "100%" }}
                  resizeMode="cover"
                />
              </View>
            </View>
          )}

          <View
            style={[
              styles.heroContent,
              {
                paddingHorizontal: hPad,
                paddingVertical: isDesktop ? 0 : 60,
                justifyContent: "center",
              },
            ]}
          >
            <View
              style={{
                maxWidth: isDesktop ? "36%" : "100%",
                gap: 16,
                width: "100%",
                marginLeft: isDesktop ? 48 : 0,
              }}
            >
              <Text style={styles.heroEyebrow}>Ka Domeng Talipapa</Text>
              <Text style={[styles.heroHeadline, { fontSize: heroFontSize, lineHeight: heroFontSize * 1.15 }]}>
                Shop Fresh. Grow Your Business.{"\n"}All in One Market.
              </Text>
            </View>

            {!isDesktop && (
              <Image
                source={require("../assets/fruits and vegetable on a bag.png")}
                style={{ width: "100%", maxWidth: 480, aspectRatio: 1.7, alignSelf: "center", marginTop: 24 }}
                resizeMode="contain"
              />
            )}
          </View>
        </View>

        {/* ── About header ─────────────────────────────────────────────────── */}
        <View
          style={[
            styles.section,
            { backgroundColor: BG, paddingVertical: secPad, paddingHorizontal: hPad, overflow: "hidden" },
          ]}
          {...({ className: "rw-reveal" } as any)}
        >
          <FallingProduce items={FALLING_ITEMS} shield={aboutShield} />

          <View
            style={{ alignItems: "center" }}
            onLayout={(e) => setAboutShield(e.nativeEvent.layout)}
          >
            <Text style={styles.sectionLabel}>ABOUT THE MARKET</Text>
            <Text style={[styles.sectionTitle, { fontSize: isMobile ? 24 : isTablet ? 32 : 40 }]}>
              Your One-Stop Public Market
            </Text>
            <Text
              style={[styles.sectionDesc, { maxWidth: isMobile ? "100%" : 600, marginBottom: 0 }]}
            >
              Ka Domeng Talipapa is a thriving community market offering fresh
              produce, dry goods, and household essentials all under one roof.
            </Text>
          </View>
        </View>

        {/* ── Category pinned crossfade (all breakpoints) ────────────────────── */}
        <View
          style={{ height: PIN_H * CATEGORIES.length }}
          onLayout={(e) => {
            catTrackStart.current = e.nativeEvent.layout.y;
            catTrackHeight.current = e.nativeEvent.layout.height;
          }}
        >
          <View
            style={[
              styles.catPinWrap,
              { height: PIN_H },
              Platform.OS === "web" ? ({ position: "sticky", top: 0 } as any) : null,
            ]}
          >
            {CATEGORIES.map((cat, i) => (
              <View
                key={cat.slug}
                ref={(el) => {
                  catPanelRefs.current[i] = el;
                }}
                style={[
                  styles.catPinPanel,
                  { opacity: i === 0 ? 1 : 0, zIndex: activeCatIndex === i ? 2 : 1 },
                ]}
                pointerEvents={activeCatIndex === i ? "auto" : "none"}
                {...({
                  className: `rw-pin-panel${activeCatIndex === i ? " rw-pin-active" : ""}`,
                } as any)}
              >
                <Image source={cat.image} style={styles.catPinImg} resizeMode="cover" />
                <View
                  style={[
                    styles.catPinOverlay,
                    Platform.OS === "web"
                      ? ({
                          backgroundImage:
                            "linear-gradient(to top, rgba(10,31,26,0.92) 15%, rgba(10,31,26,0.2) 65%)",
                          backgroundColor: undefined,
                        } as any)
                      : null,
                  ]}
                />
                <Text
                  style={[
                    styles.catPinTitleTop,
                    { fontSize: isMobile ? 26 : isTablet ? 36 : 46, top: isMobile ? 32 : 56 },
                  ]}
                >
                  {cat.title}
                </Text>
                <CategoryCarousel
                  cards={cat.cards}
                  panelWidth={width}
                  bottomText={cat.teaser}
                />
              </View>
            ))}

            <View style={[styles.catPinDots, { right: isMobile ? 14 : isTablet ? 22 : 32 }]}>
              {CATEGORIES.map((cat, i) => (
                <TouchableOpacity
                  key={cat.slug}
                  onPress={() => goToCategory(i)}
                  style={[styles.catPinDot, activeCatIndex === i && styles.catPinDotActive]}
                  {...({ className: "rw-pin-dot" } as any)}
                />
              ))}
            </View>
          </View>
        </View>

        {/* ── Market Overview (Stats) ───────────────────────────────────────── */}
        <View
          nativeID="rw-stats"
          style={[styles.section, { backgroundColor: PRIMARY_TINT, paddingVertical: secPad, paddingHorizontal: hPad }]}
          {...({ className: "rw-reveal" } as any)}
        >
          <Text style={styles.sectionLabel}>MARKET OVERVIEW</Text>
          <Text style={[styles.sectionTitle, { fontSize: isMobile ? 24 : isTablet ? 32 : 40 }]}>
            By the Numbers
          </Text>

          <View style={[styles.cardRow, { gap: isMobile ? 12 : 20, maxWidth: 900 }]}>
            {STATS.map((stat, i) => (
              <View
                key={stat.label}
                style={[styles.statCard, { width: cardPct as any }]}
                {...({ className: `rw-reveal rw-d${i + 1}` } as any)}
              >
                <View style={styles.statIconCircle}>
                  <Ionicons name={stat.icon as any} size={22} color={WHITE} />
                </View>
                <Text nativeID={`rw-stat-${i}`} style={styles.statValue}>{stat.value}</Text>
                <Text style={styles.statLabel}>{stat.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── 2D Market View (embedded, no separate page) ─────────────────────── */}
        <View
          style={[styles.section, { backgroundColor: BG, paddingVertical: secPad, paddingHorizontal: hPad }]}
          {...({ className: "rw-reveal" } as any)}
        >
          <Text style={styles.sectionLabel}>MARKET MAP</Text>
          <Text style={[styles.sectionTitle, { fontSize: isMobile ? 24 : isTablet ? 32 : 40 }]}>
            2D Market View
          </Text>
          <Text style={[styles.sectionDesc, { maxWidth: isMobile ? "100%" : 560 }]}>
            Tap any stall to see its status, or check what's vacant right now.
          </Text>

          <MarketMapEmbed maxWidth={1100} />
        </View>

        {/* ── Find Us (Mapbox) ─────────────────────────────────────────────── */}
        <View
          style={[styles.section, { backgroundColor: BG, paddingVertical: secPad, paddingHorizontal: hPad }]}
          {...({ className: "rw-reveal" } as any)}
        >
          <Text style={styles.sectionLabel}>LOCATION</Text>
          <Text style={[styles.sectionTitle, { fontSize: isMobile ? 22 : isTablet ? 30 : 40 }]}>
            Find Us
          </Text>
          <Text
            style={[styles.sectionDesc, { maxWidth: isMobile ? "100%" : isTablet ? "100%" : 540 }]}
          >
            Use the interactive map below to find our exact location.
          </Text>

          <View
            style={[
              styles.findUsRow,
              { flexDirection: isDesktop ? "row" : "column", gap: isMobile ? 16 : 24 },
            ]}
          >
            <View style={[styles.findUsInfoCard, { width: isDesktop ? "36%" : "100%" }]}>
              <View style={styles.findUsInfoRow}>
                <Ionicons name="location-outline" size={20} color={PRIMARY} />
                <Text style={styles.findUsInfoText}>
                  Igay Rd. Sto. Cristo, San Jose del Monte, Bulacan
                </Text>
              </View>
              <View style={styles.findUsInfoRow}>
                <Ionicons name="mail-outline" size={20} color={PRIMARY} />
                <Text style={styles.findUsInfoText}>info@rentwise.ph</Text>
              </View>
            </View>

            <View style={[styles.mapWrap, { flex: isDesktop ? 1 : undefined }]}>
              <NavigableMap
                height={isMobile ? 260 : isTablet ? 360 : 440}
                isMobile={isMobile}
              />
            </View>
          </View>
        </View>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <View
          style={[styles.footer, { paddingHorizontal: navPad }]}
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
                {([
                  { name: "logo-facebook", label: "Facebook" },
                  { name: "logo-instagram", label: "Instagram" },
                  { name: "logo-twitter", label: "Twitter" },
                ] as const).map((s) => (
                  <TouchableOpacity
                    key={s.label}
                    style={styles.socialChip}
                    accessibilityLabel={s.label}
                    {...({ className: "rw-social-chip" } as any)}
                  >
                    <Ionicons name={s.name} size={18} color={WHITE} />
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

      {/* ── Back to top ──────────────────────────────────────────────────── */}
      {scrollY > 500 && (
        <TouchableOpacity
          style={[
            styles.backToTop,
            Platform.OS === "web" ? ({ position: "fixed" } as any) : null,
          ]}
          onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
          {...({ className: "rw-back-top" } as any)}
        >
          <Ionicons name="arrow-up" size={20} color={WHITE} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: WHITE },

  scroll: { paddingBottom: 0 },

  // Hero
  hero: {
    backgroundColor: HERO_DARK,
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
    opacity: 0.5,
  },
  heroOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(10,31,26,0.8)",
  },
  heroContent: {
    flex: 1,
  },
  heroProduceImg: {
    position: "absolute",
    right: -60,
    bottom: 160,
  },
  heroEyebrow: {
    color: PRIMARY,
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  heroHeadline: {
    color: WHITE,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  // Sections
  section: {
    paddingVertical: 72,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  sectionLabel: {
    color: PRIMARY,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 2,
    marginBottom: 12,
    textAlign: "center",
    textTransform: "uppercase",
  },
  sectionTitle: {
    color: TEXT_DARK,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 16,
    letterSpacing: -0.3,
  },
  sectionDesc: {
    color: TEXT_MUTED,
    fontSize: 16,
    lineHeight: 27,
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

  // Pinned category crossfade
  catPinWrap: {
    position: "relative",
    width: "100%",
    overflow: "hidden",
    backgroundColor: HERO_DARK,
  },
  catPinPanel: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    overflow: "hidden",
  },
  catPinImg: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    width: "100%",
    height: "100%",
  },
  catPinOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(10,31,26,0.75)",
  },
  catPinTitleTop: {
    position: "absolute",
    left: 0,
    right: 0,
    textAlign: "center",
    color: WHITE,
    fontWeight: "800",
    letterSpacing: -0.5,
    zIndex: 2,
  },
  catPinDots: {
    position: "absolute",
    right: 32,
    top: "50%",
    marginTop: -48,
    gap: 12,
    alignItems: "center",
    zIndex: 3,
  },
  catPinDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.35)",
  },
  catPinDotActive: {
    width: 12,
    height: 32,
    borderRadius: 6,
    backgroundColor: ACCENT,
  },

  // Stat cards
  statIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: PRIMARY,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 14,
  },
  statCard: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER,
    margin: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  statValue: { color: ACCENT, fontSize: 44, fontWeight: "800", lineHeight: 52 },
  statLabel: {
    color: TEXT_MUTED,
    fontSize: 14,
    fontWeight: "600",
    marginTop: 6,
    textAlign: "center",
  },

  // Find Us
  findUsRow: {
    width: "100%",
    maxWidth: 1100,
    alignItems: "stretch",
  },
  findUsInfoCard: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 24,
    gap: 16,
    justifyContent: "center",
  },
  findUsInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  findUsInfoText: {
    color: TEXT_DARK,
    fontSize: 14,
    fontWeight: "500",
    flexShrink: 1,
  },
  mapWrap: {
    width: "100%",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: BORDER,
  },

  // Footer
  footer: {
    backgroundColor: FOOTER_BG,
    paddingTop: 56,
    paddingBottom: 32,
  },
  footerInner: {
    justifyContent: "space-between",
    flexWrap: "wrap",
    marginBottom: 40,
  },
  footerCol: { minWidth: 180, maxWidth: 300 },
  footerBrand: {
    color: WHITE,
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 10,
  },
  footerHeading: {
    color: WHITE,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 12,
  },
  footerMuted: {
    color: FOOTER_MUTED,
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 4,
  },
  socialRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  socialChip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    justifyContent: "center",
    alignItems: "center",
  },
  footerDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginTop: 0,
    marginBottom: 20,
  },
  footerCopy: {
    color: FOOTER_COPY,
    fontSize: 13,
    textAlign: "center",
  },

  // Back to top
  backToTop: {
    position: "absolute",
    bottom: 28,
    right: 28,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: PRIMARY,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 8,
    zIndex: 300,
  },
});
