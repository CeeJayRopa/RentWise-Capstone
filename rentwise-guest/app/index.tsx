import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  StyleSheet,
  Platform,
  TextInput,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import React, { useRef, useState } from "react";
import NavigableMap from "../shared/components/NavigableMap";
import MarketMapEmbed from "../shared/components/MarketMapEmbed";
import CategoryCarousel from "../shared/components/CategoryCarousel";
import { useBreakpoints } from "../shared/hooks/useBreakpoints";

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
const FOOTER_COPY = "#5C7268";
const WHITE = "#FFFFFF";

const FACEBOOK_URL = "https://www.facebook.com/kadomeng.talipapa";

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


const STATS = [
  { label: "Total Stalls", value: "40", icon: "storefront-outline" },
  { label: "Available Stalls", value: "5", icon: "checkmark-circle-outline" },
  { label: "Buildings", value: "2", icon: "business-outline" },
] as const;

// ─── Component ───────────────────────────────────────────────────────────────
export default function GuestLanding() {
  const { width, height, isMobile, isTablet, isDesktop } = useBreakpoints();

  // Responsive helpers
  const hPad = isMobile ? 16 : isTablet ? 32 : 80;
  const navPad = isMobile ? 16 : isTablet ? 32 : 64;
  const secPad = isMobile ? 40 : isTablet ? 56 : 72;
  const PIN_H = height;
  // Scroll distance "owned" by each category, as a multiple of the viewport
  // height — higher means more scrolling is required to advance to the next
  // category (a single scroll/swipe shouldn't skip straight past one).
  const CATEGORY_SCROLL_LENGTH = PIN_H * 1.5;

  const scrollRef = useRef<ScrollView>(null);
  const marketMapSectionY = useRef(0);
  const contactSectionY = useRef(0);
  const [scrollY, setScrollY] = useState(0);
  const [activeCatIndex, setActiveCatIndex] = useState(0);
  // Continuous 0-1 progress across the whole pinned category track (not just
  // the rounded-off active index) — used to drive the Wet Market carousel.
  const [catProgress, setCatProgress] = useState(0);

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

  // Tablet used to get 45% (2-per-row, orphaning the 3rd stat card onto its
  // own centered row) — reuse the same 30% desktop already proves fits 3
  // per row cleanly, it's a percentage so it scales fine at tablet widths too.
  const cardPct = isMobile ? "100%" : "30%";
  const heroFontSize = isMobile ? 30 : isTablet ? 32 : 42;
  // ~75-80% of the previous 260px mobile cap, per the hero-section mobile spec.
  const mobileCircleSize = Math.min(width * 0.7, isMobile ? 200 : 340);
  // Hero-only override — increases side padding on mobile without touching
  // `hPad`, which every other section on the page still relies on.
  const heroPadH = isMobile ? 24 : hPad;
  // Buttons stay side-by-side down to 390px; below that they stack full-width.
  const isTinyMobile = isMobile && width < 390;
  // Tablet gets its own side-by-side layout (text ~52%, image ~42% of the
  // available hero content width) instead of inheriting the mobile stack.
  const heroContentWidth = width - heroPadH * 2;
  const tabletCircleSize = Math.min(heroContentWidth * 0.42, 320);

  // Desktop's produce circle is absolutely positioned (bleeding off the right edge via
  // `right: -60` — see heroProduceImg), and the text column next to it has its own
  // `marginLeft: 48`. These two used to be computed completely independently (image sized
  // from raw viewport width, text sized from a fixed 44%), so they only happened to clear
  // each other at very wide screens (1920px+) — at narrower "just barely desktop" widths
  // (~1024-1300px), the circle's left edge actually lands underneath the text column.
  // Fixed by deriving the image's max width FROM the space left over after the text column
  // (instead of the other way around), guaranteeing a real gap between them at any width.
  const HERO_IMG_RIGHT_BLEED = 60;
  const HERO_TEXT_MARGIN_LEFT = 48;
  const HERO_TEXT_IMAGE_GAP = 48;
  // Unchanged from the original 44% — the fix only needed to make the image aware of
  // this value, not to shrink the text column itself.
  const desktopTextWidth = heroContentWidth * 0.44;
  const heroImgWidth = Math.min(
    width * 0.8, // don't get absurdly huge relative to the viewport
    1180, // absolute cap, regardless of viewport width
    // space actually left over after padding, the text column, and both gaps — the
    // constraint that matters on narrower desktop widths, where the other two don't bind
    width +
      HERO_IMG_RIGHT_BLEED -
      heroPadH -
      HERO_TEXT_MARGIN_LEFT -
      desktopTextWidth -
      HERO_TEXT_IMAGE_GAP
  );
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
            style={[styles.heroBlueprintBg, isTablet && { opacity: 0.25 }]}
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

          {/* Produce bag photo — bleeds off the right edge like the reference.
              Vertically centered via top:0/bottom:0 (see heroProduceImg) rather than a
              fixed pixel offset, so it stays correctly positioned at any monitor height —
              a fixed `bottom` value tuned against a tall screen clipped the top of the
              circle off on shorter common laptop resolutions like 1366x768. */}
          {isDesktop && (
            <View
              style={[
                styles.heroProduceImg,
                {
                  width: heroImgWidth,
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
                paddingHorizontal: heroPadH,
                paddingVertical: isDesktop ? 0 : isMobile ? 40 : 60,
                justifyContent: "center",
                flexDirection: isTablet ? "row" : "column",
                alignItems: isTablet ? "center" : undefined,
                gap: isTablet ? 40 : undefined,
              },
            ]}
          >
            <View
              style={{
                maxWidth: isDesktop ? desktopTextWidth : isTablet ? "52%" : "100%",
                gap: isMobile ? 0 : 16,
                width: isTablet ? "52%" : "100%",
                marginLeft: isDesktop ? 48 : 0,
              }}
            >
              <Text style={[styles.heroEyebrow, isMobile && { fontSize: 12, marginBottom: 8 }]}>
                Ka Domeng Talipapa Market
              </Text>
              <Text
                style={[
                  styles.heroHeadline,
                  {
                    fontSize: heroFontSize,
                    lineHeight: heroFontSize * (isMobile ? 1.1 : 1.15),
                    maxWidth: isMobile ? 320 : undefined,
                  },
                  isMobile && { marginBottom: 16 },
                ]}
              >
                Shop Fresh. Grow Your Business.{"\n"}All in One Market.
              </Text>
              <Text
                style={[
                  styles.heroSubtext,
                  { fontSize: isMobile ? 14 : 16 },
                  isMobile && { marginBottom: 24, maxWidth: 340 },
                ]}
                numberOfLines={isMobile ? 2 : undefined}
              >
                From fresh produce to thriving stalls, Ka Domeng Talipapa is where the community
                shops, sells, and grows together.
              </Text>

              <View
                style={[
                  styles.heroActions,
                  isMobile && { alignSelf: "stretch" },
                  isTinyMobile && { flexDirection: "column", gap: 12 },
                ]}
              >
                <TouchableOpacity
                  style={[
                    styles.heroPrimaryBtn,
                    isMobile && !isTinyMobile && { flex: 1, paddingHorizontal: 16 },
                    isTinyMobile && { alignSelf: "stretch", paddingHorizontal: 16 },
                  ]}
                  onPress={() => scrollRef.current?.scrollTo({ y: marketMapSectionY.current, animated: true })}
                  {...({ className: "rw-btn-primary" } as any)}
                >
                  <Text style={[styles.heroPrimaryBtnText, isMobile && { fontSize: 13 }]}>2D Layout View</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.heroSecondaryBtn,
                    isMobile && !isTinyMobile && { flex: 1, paddingHorizontal: 16 },
                    isTinyMobile && { alignSelf: "stretch", paddingHorizontal: 16 },
                  ]}
                  onPress={() => scrollRef.current?.scrollTo({ y: contactSectionY.current, animated: true })}
                >
                  <Text style={[styles.heroSecondaryBtnText, isMobile && { fontSize: 13 }]}>Contact Us</Text>
                </TouchableOpacity>
              </View>
            </View>

            {!isDesktop && (
              <View
                style={{
                  width: isTablet ? tabletCircleSize : mobileCircleSize,
                  height: isTablet ? tabletCircleSize : mobileCircleSize,
                  borderRadius: (isTablet ? tabletCircleSize : mobileCircleSize) / 2,
                  backgroundColor: PRIMARY,
                  overflow: "hidden",
                  alignSelf: "center",
                  marginTop: isTablet ? 0 : isMobile ? 32 : 24,
                }}
              >
                <Image
                  source={require("../assets/fruits and vegetable on a bag.png")}
                  style={{ width: "100%", height: "100%" }}
                  resizeMode="cover"
                />
              </View>
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
          <View style={{ alignItems: "center" }}>
            <Text style={[styles.sectionTitle, { fontSize: isMobile ? 24 : 40 }]}>
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
          style={{ height: CATEGORY_SCROLL_LENGTH * CATEGORIES.length }}
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
                style={[
                  styles.statCard,
                  { width: cardPct as any },
                  // Tablet: gap on the row already spaces the 3 cards evenly,
                  // so drop the extra per-card margin (it was pushing the
                  // trio just wide enough to wrap) and trim padding a touch
                  // so icon/number/label don't feel cramped at this width.
                  isTablet && { margin: 0, padding: 20 },
                ]}
                {...({ className: `rw-reveal rw-d${i + 1}` } as any)}
              >
                <View style={styles.statIconCircle}>
                  <Ionicons name={stat.icon as any} size={22} color={PRIMARY} />
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
          onLayout={(e) => {
            marketMapSectionY.current = e.nativeEvent.layout.y;
          }}
          {...({ className: "rw-reveal" } as any)}
        >
          <Text style={[styles.sectionTitle, { fontSize: isMobile ? 24 : isTablet ? 32 : 40 }]}>
            2D Market View
          </Text>
          <Text style={[styles.sectionDesc, { maxWidth: isMobile ? "100%" : 560 }]}>
            Tap any stall to see its status, or check what's vacant right now.
          </Text>

          <MarketMapEmbed maxWidth={980} />
        </View>

        {/* ── Find Us (Mapbox) ─────────────────────────────────────────────── */}
        <View
          style={[styles.section, { backgroundColor: PRIMARY_TINT, paddingVertical: secPad, paddingHorizontal: hPad }]}
          {...({ className: "rw-reveal" } as any)}
        >
          <Text style={[styles.sectionTitle, { fontSize: isMobile ? 22 : isTablet ? 30 : 40 }]}>
            Find Us
          </Text>

          <View style={[styles.findUsRow, { gap: isMobile ? 16 : 24 }]}>
            <View style={styles.mapWrap}>
              <NavigableMap
                height={isMobile ? 260 : isTablet ? 360 : 440}
                isMobile={isMobile}
              />
            </View>
          </View>
        </View>

        {/* ── Contact Us ───────────────────────────────────────────────────── */}
        <View
          style={[styles.section, { backgroundColor: BG, paddingVertical: secPad, paddingHorizontal: hPad, alignItems: "stretch" }]}
          onLayout={(e) => {
            contactSectionY.current = e.nativeEvent.layout.y;
          }}
          {...({ className: "rw-reveal" } as any)}
        >
          <View
            style={[
              styles.contactRow,
              {
                flexDirection: isDesktop || isTablet ? "row" : "column",
                alignItems: isTablet ? "flex-start" : undefined,
                gap: isTablet ? 40 : isMobile ? 40 : 56,
              },
            ]}
          >
            {/* Left: info */}
            <View
              style={[
                styles.contactInfoCol,
                isDesktop && { flex: 1 },
                // ~45/55 split via flex ratios (not raw percentages) so the
                // fixed row gap is accounted for automatically — guarantees
                // no overflow regardless of exact tablet width.
                isTablet && { flex: 45, gap: 12 },
              ]}
            >
              <Text style={[styles.contactHeading, { fontSize: isMobile ? 28 : isTablet ? 34 : 40 }]}>
                Contact Us
              </Text>
              <Text style={styles.contactSubtext}>
                Have a question about a stall, or need help finding your way around?
                Reach out and we'll get back to you.
              </Text>

              <View style={[styles.contactDetails, isTablet && { gap: 12, marginTop: 0 }]}>
                <View style={styles.findUsInfoRow}>
                  <Ionicons name="call-outline" size={18} color={PRIMARY} />
                  <Text style={styles.findUsInfoText}>+63 965 677 0526</Text>
                </View>
                <View style={styles.findUsInfoRow}>
                  <Ionicons name="location-outline" size={18} color={PRIMARY} />
                  <Text style={styles.findUsInfoText}>
                    Igay Rd. Sto. Cristo, San Jose del Monte, Bulacan
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.findUsInfoRow}
                  onPress={() => Linking.openURL(FACEBOOK_URL)}
                  {...({ className: "rw-social-chip" } as any)}
                >
                  <Ionicons name="logo-facebook" size={18} color={PRIMARY} />
                  <Text style={[styles.findUsInfoText, styles.contactLink]}>Message us on Facebook</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Right: form */}
            <View
              style={[
                styles.contactFormCard,
                isDesktop && { flex: 1 },
                // Fill its ~55% flex column instead of capping at the base
                // 460px card width, which was leaving lopsided whitespace
                // inside the column at tablet widths.
                isTablet && { flex: 55, maxWidth: "100%" },
              ]}
            >
              <Text style={styles.contactFormHeading}>Get in Touch</Text>
              <Text style={styles.contactFormSubtext}>You can reach us anytime</Text>

              <View style={[styles.contactFormRow, isMobile && { flexDirection: "column" }]}>
                <TextInput
                  style={[styles.contactInput, { flex: 1 }]}
                  placeholder="First name"
                  placeholderTextColor={TEXT_MUTED}
                />
                <TextInput
                  style={[styles.contactInput, { flex: 1 }]}
                  placeholder="Last name"
                  placeholderTextColor={TEXT_MUTED}
                />
              </View>
              <TextInput
                style={styles.contactInput}
                placeholder="Your email"
                placeholderTextColor={TEXT_MUTED}
                keyboardType="email-address"
              />
              <TextInput
                style={styles.contactInput}
                placeholder="Phone number"
                placeholderTextColor={TEXT_MUTED}
                keyboardType="phone-pad"
              />
              <TextInput
                style={[styles.contactInput, styles.contactTextarea]}
                placeholder="How can we help?"
                placeholderTextColor={TEXT_MUTED}
                multiline
                numberOfLines={4}
              />

              <TouchableOpacity style={styles.contactSubmitBtn} {...({ className: "rw-btn-primary" } as any)}>
                <Text style={styles.contactSubmitBtnText}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <View
          style={[styles.footer, { paddingHorizontal: navPad }]}
        >
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
    top: 0,
    bottom: 0,
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
  heroSubtext: {
    color: HERO_MUTED,
    lineHeight: 24,
    maxWidth: 460,
  },
  heroActions: {
    flexDirection: "row",
    gap: 14,
    marginTop: 8,
  },
  heroPrimaryBtn: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 28,
    alignItems: "center",
  },
  heroPrimaryBtnText: { color: WHITE, fontSize: 15, fontWeight: "700" },
  heroSecondaryBtn: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.4)",
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 28,
    alignItems: "center",
  },
  heroSecondaryBtnText: { color: WHITE, fontSize: 15, fontWeight: "700" },
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
  // Stat cards
  statIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: PRIMARY_TINT,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  statCard: {
    backgroundColor: SURFACE,
    borderRadius: 20,
    borderTopWidth: 4,
    borderTopColor: PRIMARY,
    padding: 28,
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER,
    margin: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 3,
  },
  statValue: { color: ACCENT, fontSize: 44, fontWeight: "800", lineHeight: 52 },
  statLabel: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 8,
    textAlign: "center",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },

  // Find Us
  findUsRow: {
    width: "100%",
    maxWidth: 1100,
    alignItems: "stretch",
  },
  mapWrap: {
    width: "100%",
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

  // Contact Us
  contactRow: {
    width: "100%",
    maxWidth: 1100,
    alignSelf: "center",
  },
  contactInfoCol: {
    gap: 16,
  },
  contactHeading: {
    color: TEXT_DARK,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  contactSubtext: {
    color: TEXT_MUTED,
    fontSize: 15,
    lineHeight: 24,
    maxWidth: 420,
  },
  contactDetails: {
    gap: 12,
    marginTop: 4,
  },
  contactLink: {
    color: PRIMARY,
    fontWeight: "700",
  },

  contactFormCard: {
    width: "100%",
    maxWidth: 460,
    backgroundColor: SURFACE,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 28,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.06,
    shadowRadius: 24,
    elevation: 4,
  },
  contactFormHeading: { color: TEXT_DARK, fontSize: 22, fontWeight: "800" },
  contactFormSubtext: { color: TEXT_MUTED, fontSize: 14, marginBottom: 8 },
  contactFormRow: { flexDirection: "row", gap: 12 },
  contactInput: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: TEXT_DARK,
    backgroundColor: BG,
    minWidth: 0,
  },
  contactTextarea: {
    minHeight: 100,
    textAlignVertical: "top",
  },
  contactSubmitBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  contactSubmitBtnText: { color: WHITE, fontSize: 15, fontWeight: "700" },

  // Footer
  footer: {
    backgroundColor: FOOTER_BG,
    paddingVertical: 20,
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
