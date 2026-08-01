import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Image,
  Animated,
  StyleSheet,
  Platform,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import React, { useRef, useState } from "react";
import NavigableMap from "../shared/components/NavigableMap";
import MarketMapEmbed from "../shared/components/MarketMapEmbed";
import { useBreakpoints } from "../shared/hooks/useBreakpoints";

// ─── Theme ───────────────────────────────────────────────────────────────────
const PRIMARY = "#0E7C5A";
const PRIMARY_DARK = "#0B6247";
const ACCENT = "#E8994A";
const BG = "#F4F1E8";
const SURFACE = "#FFFFFF";
const BORDER = "#E7E5DE";
const TEXT_DARK = "#171A19";
const TEXT_MUTED = "#5B6560";
const FOOTER_BG = "#12201C";
const FOOTER_COPY = "#5C7268";
const WHITE = "#FFFFFF";
// Category rows background — a near-white mint, subtler than PRIMARY_TINT.
const CATEGORY_BG = "#F6FBF7";
const CREAM_LINE = "#DCD0B8";
const CREAM_TAG_BG = "#FBF8F1";

// Web-only CSS for hover/scroll animations that RN's StyleSheet can't express
// (real :hover, @keyframes, :has()). Rendered as a literal <style> tag in JSX
// (see HeroAnimCss below) rather than injected imperatively in a useEffect --
// a mount-once effect doesn't re-run on every Fast Refresh, so edits here
// would otherwise sit stale in the browser until a full page reload.
const HERO_ANIM_CSS = `
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
`;

const FACEBOOK_URL = "https://www.facebook.com/kadomeng.talipapa";
// Nav bar built, just toggled off while the hero gets dialed in on its own.
const SHOW_NAV = true;

// ─── Data ────────────────────────────────────────────────────────────────────
const WET_MARKET_IMG_1 = require("../assets/wet-market/Wet_Market_1.png");
const WET_MARKET_IMG_2 = require("../assets/wet-market/Wet_Market_2.png");
const DRY_MARKET_IMG_1 = require("../assets/dry-market/Dry_market_1.png");
const DRY_MARKET_IMG_2 = require("../assets/dry-market/Dry_market_2.png");
const HOME_ESSENTIALS_IMG_1 = require("../assets/home-essentials/Home_Essentials_1.png");
const HOME_ESSENTIALS_IMG_2 = require("../assets/home-essentials/Home_Essentials_2.png");

// Category-card photos live alongside the hero images rather than each
// category's own asset folder (those are used by CATEGORIES[i].image above).
// Temporary placeholder -- all 3 category cards point at the same image
// until real per-category photos are ready.
const CARD_IMAGES: Record<string, any> = {
  "wet-market": require("../assets/dry-market/Dry_market_1.png"),
  "dry-market": require("../assets/dry-market/Dry_market_1.png"),
  "home-essentials": require("../assets/dry-market/Dry_market_1.png"),
};

const CATEGORIES = [
  {
    slug: "wet-market",
    label: "Wet Market",
    heading: "Fuel your table with\nquality protein",
    description:
      "Bangus, tilapia, tanigue, hipon, and pusit the day's catch laid out fresh on ice each morning, straight off the boat before the first jeepney rolls in.",
    tags: ["Bangus", "Tilapia", "Tanigue", "Hipon", "Pusit", "Alimango"],
    image: WET_MARKET_IMG_1,
    secondaryImage: WET_MARKET_IMG_2 as any,
    route: "/wet-market",
  },
  {
    slug: "dry-market",
    label: "Dry Market",
    heading: "Farm to table freshness\nis made affordable",
    description:
      "Onions, garlic, tomatoes, potatoes, eggplant, and carrots piled high, alongside eggs and packaged snacks the everyday produce run for the week's cooking.",
    tags: ["Sibuyas", "Bawang", "Kamatis", "Patatas", "Talong", "Karot"],
    image: DRY_MARKET_IMG_1,
    secondaryImage: DRY_MARKET_IMG_2 as any,
    route: "/dry-market",
  },
  {
    slug: "home-essentials",
    label: "Home Essentials",
    heading: "Keep your space fresh & clean",
    description:
      "Bottled cooking oil, sachets, and hanging rows of snacks the everyday sari-sari staples every household restocks on the way home.",
    tags: ["Mantika", "Sabon", "Asukal", "Kape", "Toyo"],
    image: HOME_ESSENTIALS_IMG_1,
    secondaryImage: HOME_ESSENTIALS_IMG_2 as any,
    route: "/home-essentials",
  },
] as const;

// Shorter labels for the tablet/desktop editorial-style category cards
// (image on top, caption below) -- distinct from CATEGORIES[i].label/heading
// above, which are used by the cat-card treatments elsewhere.
const CATEGORY_CARDS = [
  { slug: "wet-market", name: "Wet Market", caption: "Fresh Poultry & Meat" },
  { slug: "dry-market", name: "Produce", caption: "Organic Farm Harvest" },
  { slug: "home-essentials", name: "Essentials", caption: "Sari-Sari Basics" },
] as const;

// Placeholder content -- there's no "today's highlight" field on stall
// documents in Firestore yet (see services/stallService.ts / the `stalls`
// collection), so this is static for now rather than pulled live like the
// 2D map's occupancy data.
const MARKET_PULSE = [
  {
    tag: "88% Occupied",
    vendor: "35 of 40 Stalls Rented",
    highlight: "Spaces are filling up fast! Lock in your prime spot today before full capacity.",
    vacant: false,
  },
  {
    tag: "High Traffic",
    vendor: "Heavy Daily Foot Traffic",
    highlight: "Position your business right in front of thousands of daily wet market & dry goods shoppers.",
    vacant: false,
  },
  {
    tag: "Easy Pay",
    vendor: "Digital Rent & Sales Tracking",
    highlight: "Manage monthly dues, utilities, and vendor permits directly from your mobile app.",
    vacant: false,
  },
] as const;


// The Contact Us button's hover wipe (white at rest, green sliding in on
// hover, label crossing from dark to white text) is driven with Animated
// instead of CSS :hover -- every CSS-hover attempt on this page has turned
// out unreliable across refreshes/environments, while Animated.timing is the
// same proven mechanism already driving the hero crossfade/sticky nav.
function NavCtaButton({ onPress, isTablet }: { onPress: () => void; isTablet?: boolean }) {
  const [ctaWidth, setCtaWidth] = useState(0);
  const hoverAnim = useRef(new Animated.Value(0)).current;

  const setHovered = (hovered: boolean) => {
    Animated.timing(hoverAnim, {
      toValue: hovered ? 1 : 0,
      duration: 350,
      useNativeDriver: false,
    }).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onLayout={(e) => setCtaWidth(e.nativeEvent.layout.width)}
      style={[styles.navCta, isTablet && { paddingHorizontal: 16, paddingVertical: 9 }]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: SURFACE,
            borderRadius: 4,
            transform: [
              {
                translateX: hoverAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-ctaWidth, 0],
                }),
              },
            ],
          },
        ]}
      />
      <Animated.Text
        style={[
          styles.navCtaText,
          isTablet && { fontSize: 12 },
          {
            color: hoverAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [WHITE, TEXT_DARK],
            }),
          },
        ]}
      >
        Contact Us
      </Animated.Text>
    </Pressable>
  );
}

// Nav links' hover fill (a solid panel sliding in left-to-right, label
// flipping to white) is driven with Animated for the same reason as
// NavCtaButton above -- CSS :hover on these TouchableOpacity/Pressable links
// never reliably showed up across three separate attempts this session.
function NavLinkButton({
  label,
  onPress,
  isTablet,
}: {
  label: string;
  onPress: () => void;
  isTablet?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={styles.navLinkBtn}>
      <Text style={[styles.navLinkText, isTablet && { fontSize: 12.5 }]}>{label}</Text>
    </Pressable>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function GuestLanding() {
  const { width, height, isMobile, isTablet, isDesktop } = useBreakpoints();
  // Tablet hero used to force the same side-by-side row as desktop, scaled
  // down -- but the row's combined footprint doesn't fit a typical tablet
  // width even scaled, so it fell back to the flexWrap safety net, whose
  // manual position offsets (tuned only for the unwrapped row) then pushed
  // the wrapped text half off-screen. Stacking tablet the same as mobile
  // (image on top, text centered below) sidesteps that -- it also matches
  // the reference layout for tablet.
  const isStacked = isMobile || isTablet;

  // Desktop-tier sizing (hero image/text, paddings) was tuned as fixed
  // pixel values without ever checking how much width they actually need --
  // it turns out their combined footprint (biggest hero image + its gap +
  // the text column, at native size) is ~2064px, which overflows even a
  // 1920px window, let alone a 1440px laptop. `isDesktop` alone treats every
  // width above 1024px identically, so scale desktop sizing directly off
  // how that footprint compares to the real available width instead of an
  // arbitrary reference width -- this is what actually guarantees it fits
  // rather than approximates it.
  const HERO_CONTENT_FOOTPRINT = 1240 + 64 + 760; // widest hero image + gap + text column, native size
  const HERO_SIDE_PADDING = 80; // native hPad
  const desktopScale = isDesktop
    ? Math.min(1.15, Math.max(0.4, (width - HERO_SIDE_PADDING) / HERO_CONTENT_FOOTPRINT))
    : 1;

  // Responsive helpers
  const hPad = isMobile ? 20 : isTablet ? 32 : Math.round(80 * desktopScale);
  const navPad = isMobile ? 16 : isTablet ? 32 : Math.round(64 * desktopScale);
  const secPad = isMobile ? 40 : isTablet ? 56 : Math.round(72 * desktopScale);

  const scrollRef = useRef<ScrollView>(null);
  const marketMapSectionY = useRef(0);
  const findUsSectionY = useRef(0);
  // Driven with Animated instead of a CSS @keyframes animation -- the CSS
  // version never reliably played (kept "just popping" no matter what we
  // tuned), while Animated.timing is the same proven mechanism already
  // driving the hero crossfade/text reveal above, so it's guaranteed to
  // actually run on every platform including web.
  const [showStickyNav, setShowStickyNav] = useState(false);
  const stickyNavAnim = useRef(new Animated.Value(0)).current;
  // Mobile has no room for the full desktop/tablet nav row, so it collapses
  // to a logo + hamburger button that toggles this dropdown open/closed.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // ── Hero slide carousel ───────────────────────────────────────────────────
  const [heroSlide, setHeroSlide] = useState(0);
  const HERO_SLIDES = [
    {
      image: require("../assets/hero-section/Vegie-1.png"),
      headline: "Grow Your Business\nShop Fresh",
      body: "From fresh produce to thriving stalls, Ka Domeng Talipapa is where the community shops, sells, and grows together.",
      imageOnLeft: true,
      showSecondaryBtn: true,
      desktopImageWidth: 1240,
      desktopImageHeight: 1020,
    },
    {
      image: require("../assets/hero-section/meat-1.png"),
      headline: "Prime Cuts & Produce\nFair Prices",
      body: null,
      imageOnLeft: false,
      showSecondaryBtn: false,
      desktopImageWidth: 1080,
      desktopImageHeight: 900,
    },
  ] as const;

  // Crossfade the hero image (and its accompanying text) between slides
  // instead of swapping instantly. The headline follows the same fade +
  // slide-up motion as the eyebrow, but held back 2s behind it.
  const heroFade = useRef(new Animated.Value(1)).current;
  const heroEyebrowFade = useRef(new Animated.Value(1)).current;
  const heroHeadlineFade = useRef(new Animated.Value(1)).current;
  const heroBodyFade = useRef(new Animated.Value(1)).current;
  const goToHeroSlide = (updateIndex: (i: number) => number) => {
    Animated.timing(heroFade, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => {
      setHeroSlide(updateIndex);
      heroEyebrowFade.setValue(0);
      heroHeadlineFade.setValue(0);
      heroBodyFade.setValue(0);
      Animated.timing(heroFade, { toValue: 1, duration: 250, useNativeDriver: true }).start();
      Animated.timing(heroEyebrowFade, {
        toValue: 1,
        duration: 400,
        delay: 1000,
        useNativeDriver: true,
      }).start();
      Animated.timing(heroHeadlineFade, {
        toValue: 1,
        duration: 400,
        delay: 1500,
        useNativeDriver: true,
      }).start();
      Animated.timing(heroBodyFade, {
        toValue: 1,
        duration: 400,
        delay: 2000,
        useNativeDriver: true,
      }).start();
    });
  };
  const nextHeroSlide = () => goToHeroSlide((i) => (i + 1) % HERO_SLIDES.length);

  // Auto-advances the hero carousel every 6s. Keyed on `heroSlide` so a
  // manual arrow/dot click restarts the timer from that point instead of
  // firing again right on top of the interaction.
  React.useEffect(() => {
    const timer = setTimeout(nextHeroSlide, 6000);
    return () => clearTimeout(timer);
  }, [heroSlide]);


  // Where the categories section sits, so the "About Us" nav link can
  // scroll straight to it. The section itself is nudged up 100px via
  // `top: -100` for its resting scroll position, so jumping straight to
  // this raw measured y (which reflects that same nudge) lands short and
  // exposes hero content above it -- callers add the 100 back to cancel
  // the nudge out for the direct-jump case.
  const catTrackStart = useRef(0);

  const handleScroll = (e: any) => {
    const y = e.nativeEvent.contentOffset.y;

    setShowStickyNav(y > height - 120);
  };

  // Scrolling straight to a section's measured y lands its very top exactly
  // at the viewport edge -- fine while only the hero-embedded nav is in
  // play, but once you're past the hero the sticky nav overlays that same
  // top strip (eyebrow label + start of the title), covering it. Landing a
  // little short of the true top leaves room for the sticky nav to sit over
  // empty space instead of the section's own heading.
  const STICKY_NAV_CLEARANCE = 90;
  const scrollToSection = (y: number) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, y - STICKY_NAV_CLEARANCE), animated: true });
  };

  React.useEffect(() => {
    Animated.timing(stickyNavAnim, {
      toValue: showStickyNav ? 1 : 0,
      duration: showStickyNav ? 300 : 0,
      delay: 0,
      useNativeDriver: true,
    }).start();
  }, [showStickyNav]);

  // Keeps the injected <style> tag's content in sync on every render (not
  // just on mount) -- a mount-once effect doesn't re-run on Fast Refresh, so
  // CSS edits would otherwise sit stale in the browser until a full reload.
  React.useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    let tag = document.getElementById("rw-anim") as HTMLStyleElement | null;
    if (!tag) {
      tag = document.createElement("style");
      tag.id = "rw-anim";
      document.head.appendChild(tag);
    }
    tag.textContent = HERO_ANIM_CSS;
  });

  // ── Web-only animations ────────────────────────────────────────────────────
  React.useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;

    // Scroll-reveal observer (once: true)
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

    // Wire everything up after layout settles
    const timer = setTimeout(() => {
      document.querySelectorAll(".rw-reveal").forEach((el) => revealObs.observe(el));
    }, 250);

    return () => {
      clearTimeout(timer);
      revealObs.disconnect();
    };
  }, []);

  const heroFontSize = isMobile ? 34 : isTablet ? 44 : Math.round(62 * desktopScale);
  // Hero-only override — increases side padding on mobile without touching
  // `hPad`, which every other section on the page still relies on.
  const heroPadH = isMobile ? 24 : hPad;
  // Buttons stay side-by-side down to 390px; below that they stack full-width.
  const isTinyMobile = isMobile && width < 390;

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
          style={[styles.hero, { height }]}
          {...({ className: "rw-hero" } as any)}
        >
          {SHOW_NAV && !isMobile && (
            <View
              style={[styles.navBar, { paddingHorizontal: navPad, position: "absolute", top: 30, left: 0, right: 0, zIndex: 10 }]}
            >
              <View style={{ flex: 1, alignItems: "center" }}>
              <View style={[styles.navRightGroup, isTablet && { gap: 20, left: 24 }]}>
                <View style={[styles.navLinks, isTablet && { gap: 16 }]}>
                  <View style={[styles.navBrand, isTablet && { left: -46 }]}>
                    <Image
                      source={require("../assets/hero-section/logo.png")}
                      resizeMode="contain"
                      style={[styles.navBrandMark, isTablet && { width: 54, height: 54 }]}
                    />
                    <Text style={[styles.navBrandText, isTablet && { fontSize: 17 }]}>KaDomeng</Text>
                  </View>
                  <NavLinkButton
                    label="Home"
                    isTablet={isTablet}
                    onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
                  />
                  <NavLinkButton
                    label="About Us"
                    isTablet={isTablet}
                    onPress={() => scrollToSection(catTrackStart.current + (isTablet ? 160 : 90))}
                  />
                  <NavLinkButton
                    label="2D Map View"
                    isTablet={isTablet}
                    onPress={() => scrollToSection(marketMapSectionY.current + (isTablet ? 19 : 0))}
                  />
                </View>

                <NavCtaButton
                  isTablet={isTablet}
                  onPress={() => scrollRef.current?.scrollToEnd({ animated: true })}
                />
              </View>
              </View>
            </View>
          )}
          <View
            style={[
              styles.heroContent,
              {
                paddingLeft: isStacked ? heroPadH : 0,
                paddingRight: heroPadH,
                paddingVertical: isDesktop ? 64 : isMobile ? 48 : 56,
                // Stacked (mobile + tablet) both text-on-top/image-below
                // (column-reverse, since the image is still the first JSX
                // child) -- matches tablet's arrangement.
                flexDirection: isStacked
                  ? "column-reverse"
                  : HERO_SLIDES[heroSlide].imageOnLeft
                  ? "row"
                  : "row-reverse",
                justifyContent: isStacked ? "center" : "space-between",
                // Safety net on top of desktopScale below -- if the scaled
                // image + text still don't quite fit a given desktop width,
                // this wraps them onto two lines instead of clipping off
                // the edge of the screen.
                flexWrap: isDesktop ? "wrap" : "nowrap",
                gap: isMobile ? 32 : isTablet ? 32 : Math.round(64 * desktopScale),
              },
            ]}
          >
            <Animated.Image
              source={HERO_SLIDES[heroSlide].image}
              resizeMode="contain"
              style={{
                width: isStacked
                  ? "100%"
                  : Math.round(HERO_SLIDES[heroSlide].desktopImageWidth * desktopScale),
                height: isMobile
                  ? 340
                  : isTablet
                  ? 520
                  : Math.round(HERO_SLIDES[heroSlide].desktopImageHeight * desktopScale),
                flexShrink: 0,
                position: "relative",
                top: isStacked ? 0 : Math.round((HERO_SLIDES[heroSlide].imageOnLeft ? -20 : 17) * desktopScale),
                opacity: heroFade,
              }}
            />
            <Animated.View
              style={{
                maxWidth: isMobile ? 480 : isTablet ? 560 : Math.round(760 * desktopScale),
                alignItems: isStacked ? "center" : HERO_SLIDES[heroSlide].imageOnLeft ? "flex-end" : "flex-start",
                gap: isMobile ? 10 : 14,
                position: "relative",
                opacity: heroFade,
                right: isStacked
                  ? 0
                  : Math.round((HERO_SLIDES[heroSlide].imageOnLeft ? 250 : -320) * desktopScale),
                top: isMobile
                  ? 0
                  : isTablet
                  ? 40
                  : Math.round((HERO_SLIDES[heroSlide].imageOnLeft ? -20 : 17) * desktopScale),
              }}
            >
              <Animated.View
                style={[
                  styles.heroEyebrowRow,
                  {
                    opacity: heroEyebrowFade,
                    transform: [
                      { translateY: heroEyebrowFade.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
                    ],
                  },
                ]}
              >
                <Image
                  source={require("../assets/hero-section/vegie-small-logo.png")}
                  resizeMode="contain"
                  style={styles.heroEyebrowIcon}
                />
                <Text style={styles.heroEyebrow}>100% genuine Products</Text>
              </Animated.View>
              <Animated.Text
                style={[
                  styles.heroHeadline,
                  {
                    textAlign: isStacked ? "center" : HERO_SLIDES[heroSlide].imageOnLeft ? "right" : "left",
                    fontSize: heroFontSize,
                    lineHeight: heroFontSize * 1.12,
                    opacity: heroHeadlineFade,
                    transform: [
                      { translateY: heroHeadlineFade.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
                    ],
                  },
                ]}
              >
                {HERO_SLIDES[heroSlide].headline}
              </Animated.Text>
              {!!HERO_SLIDES[heroSlide].body && (
                <Animated.View
                  style={[
                    styles.heroBodyRow,
                    isStacked && { justifyContent: "center" },
                    {
                      opacity: heroBodyFade,
                      transform: [
                        { translateY: heroBodyFade.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
                      ],
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.heroSubtext,
                      { textAlign: isStacked ? "center" : HERO_SLIDES[heroSlide].imageOnLeft ? "right" : "left", fontSize: isMobile ? 14 : 16 },
                    ]}
                  >
                    {HERO_SLIDES[heroSlide].body}
                  </Text>
                  {!isStacked && <View style={styles.heroBodyDivider} />}
                </Animated.View>
              )}
            </Animated.View>
          </View>

          <View style={styles.heroDots}>
            {HERO_SLIDES.map((_, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => goToHeroSlide(() => i)}
                hitSlop={8}
                style={[styles.heroDot, i === heroSlide && styles.heroDotActive]}
              />
            ))}
          </View>
        </View>

        {/* ── Market Pulse ─────────────────────────────────────────────────── */}
        <View
          style={[styles.pulseSection, { paddingVertical: secPad + 30, paddingHorizontal: hPad }]}
          {...({ className: "rw-reveal" } as any)}
        >
          <View
            style={[
              styles.pulseHeaderRow,
              { flexDirection: isMobile ? "column" : "row", gap: isMobile ? 20 : 0 },
            ]}
          >
            <View
              style={{
                maxWidth: 480,
                position: "relative",
                // The 210 was tuned on a wide monitor without accounting for
                // narrower desktop/laptop widths (1440, 1366, 1280) -- scale
                // it the same way the hero's fixed offsets already do.
                left: isMobile ? 0 : isTablet ? 60 : Math.round(250 * desktopScale),
              }}
            >
              <Text style={[styles.pulseHeading, { fontSize: isMobile ? 28 : isTablet ? 34 : 40 }]}>
                The Market Pulse
              </Text>
              <Text style={styles.pulseSubtext}>
                Real-time availability and highlights from our community merchants. See what's
                trending this morning.
              </Text>
            </View>
          </View>

          <View
            style={[
              styles.pulseCardsRow,
              {
                flexDirection: isMobile ? "column" : "row",
                gap: isMobile ? 16 : 20,
                maxWidth: isMobile ? undefined : "75%",
                alignSelf: "center",
              },
            ]}
          >
            {MARKET_PULSE.map((stall, i) => (
              <View key={i} style={[styles.pulseCard, !isMobile && { flex: 1 }]}>
                <View style={styles.pulseCardTopRow}>
                  <Text style={stall.vacant ? styles.pulseVacantLabel : styles.pulseStallLabel}>
                    {stall.vacant ? "Vacant" : stall.tag}
                  </Text>
                  <View style={[styles.pulseDot, stall.vacant && styles.pulseDotVacant]} />
                </View>
                <Text style={[styles.pulseVendorName, stall.vacant && { fontStyle: "italic" }]}>
                  {stall.vendor}
                </Text>
                <Text style={styles.pulseHighlight}>{stall.highlight}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Categories (card grid) ──────────────────────────────────────────── */}
        <View
          style={[
            styles.section,
            { paddingVertical: secPad * 3, paddingHorizontal: hPad, position: "relative", top: isMobile ? 0 : -100 },
          ]}
          onLayout={(e) => {
            catTrackStart.current = e.nativeEvent.layout.y;
          }}
          {...({ className: "rw-reveal" } as any)}
        >
          <Text
            style={[
              styles.sectionTitle,
              {
                // Scales down on narrower phones instead of a flat size --
                // confirmed via side-by-side testing that a flat 27 fits on
                // one line at 430px (iPhone 14 Pro Max) but wraps to two
                // lines at 390px (iPhone 12 Pro), since the box has the same
                // fixed left/right padding on both regardless of width. The
                // slope (27/430) keeps 430px+ at the same 27 ceiling while
                // shrinking proportionally below it, e.g. ~24.5 at 390px.
                fontSize: isMobile ? Math.max(18, Math.min(27, width * (27 / 430))) : isTablet ? 32 : 40,
                position: "relative",
                top: isTablet ? 40 : isMobile ? 8 : -10,
              },
              // Matches the "Market Blueprint & Stall Status" title style
              // (MarketMapEmbed.tsx) -- italic serif in the brand green.
              isMobile && {
                fontFamily: "PlayfairDisplay_400Regular_Italic",
                fontWeight: "400",
                color: PRIMARY_DARK,
                paddingVertical: 10,
                paddingHorizontal: 14,
              },
            ]}
          >
            Your One-Stop Public Market
          </Text>

          {isDesktop ? (
            // Desktop arrangement: 3 equal columns, image on top and caption
            // below (editorial style) -- middle column staggered taller for
            // visual rhythm.
            <View style={[styles.catGrid, { gap: 20 }]}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: 24,
                  width: "100%",
                }}
              >
                {CATEGORY_CARDS.map((card, i) => {
                  const isMiddle = i === 1;
                  return (
                    <View key={card.slug} style={{ flex: 1 }}>
                      <Image
                        source={CARD_IMAGES[card.slug]}
                        resizeMode="cover"
                        style={{
                          width: "100%",
                          height: isMiddle ? 560 : 520,
                          marginTop: isMiddle ? -20 : 0,
                          borderRadius: 4,
                          backgroundColor: CATEGORY_BG,
                        }}
                      />
                      <Text style={styles.catCardEditorialName}>{card.name}</Text>
                      <Text style={styles.catCardEditorialCaption}>{card.caption}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : isTablet ? (
            // Tablet arrangement: 2 plain info cards side by side on top,
            // 1 full-width card below -- no images, just a solid card
            // background with the heading/subtext inset near the bottom.
            <View style={[styles.catGrid, { gap: 20, position: "relative", top: 60 }]}>
              <View style={{ flexDirection: "row", gap: 20 }}>
                <View style={{ flex: 1, minHeight: 280, borderRadius: 20, overflow: "hidden" }}>
                  <Image
                    source={CARD_IMAGES["wet-market"]}
                    resizeMode="cover"
                    style={StyleSheet.absoluteFill}
                  />
                  <View style={styles.catCardPlainScrim} />
                  <View style={{ flex: 1, padding: 28, justifyContent: "flex-end" }}>
                    <Text style={[styles.catCardPlainHeading, { color: WHITE }]}>Quality Protein</Text>
                    <Text style={[styles.catCardPlainSubtext, { color: "rgba(255,255,255,0.85)" }]}>
                      FRESH POULTRY, SEAFOOD & MEAT
                    </Text>
                  </View>
                </View>
                <View style={{ flex: 1, minHeight: 280, borderRadius: 20, overflow: "hidden" }}>
                  <Image
                    source={CARD_IMAGES["dry-market"]}
                    resizeMode="cover"
                    style={StyleSheet.absoluteFill}
                  />
                  <View style={styles.catCardPlainScrim} />
                  <View style={{ flex: 1, padding: 28, justifyContent: "flex-end" }}>
                    <Text style={[styles.catCardPlainHeading, { color: WHITE }]}>Farm to Table</Text>
                    <Text style={[styles.catCardPlainSubtext, { color: "rgba(255,255,255,0.85)" }]}>
                      ORGANIC LEAFY GREENS
                    </Text>
                  </View>
                </View>
              </View>
              <View style={{ minHeight: 280, borderRadius: 20, overflow: "hidden" }}>
                <Image
                  source={CARD_IMAGES["home-essentials"]}
                  resizeMode="cover"
                  style={StyleSheet.absoluteFill}
                />
                <View style={styles.catCardPlainScrim} />
                <View style={{ padding: 28, justifyContent: "flex-end" }}>
                  <Text style={[styles.catCardPlainHeading, { color: WHITE, fontSize: 24 }]}>
                    Keep your space fresh &{"\n"}clean
                  </Text>
                  <Text
                    style={[
                      styles.catCardPlainSubtext,
                      { color: "rgba(255,255,255,0.85)", textTransform: "none", letterSpacing: 0 },
                    ]}
                  >
                    Everyday essentials, fully stocked for your home or business needs.
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            // Mobile: 3 full-width plain cards stacked vertically -- same
            // image+scrim+heading treatment as tablet's cards (proven to
            // render correctly), just one per row instead of tablet's
            // 2-up + 1 grid.
            <View style={{ gap: 16 }}>
              <View style={{ minHeight: 260, borderRadius: 16, overflow: "hidden" }}>
                <Image source={CARD_IMAGES["wet-market"]} resizeMode="cover" style={StyleSheet.absoluteFill} />
                <View style={styles.catCardPlainScrim} />
                <View style={{ padding: 20, justifyContent: "flex-end" }}>
                  <Text style={[styles.catCardPlainHeading, { color: WHITE }]}>Quality Protein</Text>
                  <Text style={[styles.catCardPlainSubtext, { color: "rgba(255,255,255,0.85)" }]}>
                    FRESH POULTRY, SEAFOOD & MEAT
                  </Text>
                </View>
              </View>
              <View style={{ minHeight: 200, borderRadius: 16, overflow: "hidden" }}>
                <Image source={CARD_IMAGES["dry-market"]} resizeMode="cover" style={StyleSheet.absoluteFill} />
                <View style={styles.catCardPlainScrim} />
                <View style={{ padding: 20, justifyContent: "flex-end" }}>
                  <Text style={[styles.catCardPlainHeading, { color: WHITE }]}>Farm to Table</Text>
                  <Text style={[styles.catCardPlainSubtext, { color: "rgba(255,255,255,0.85)" }]}>
                    ORGANIC LEAFY GREENS
                  </Text>
                </View>
              </View>
              <View style={{ minHeight: 200, borderRadius: 16, overflow: "hidden" }}>
                <Image source={CARD_IMAGES["home-essentials"]} resizeMode="cover" style={StyleSheet.absoluteFill} />
                <View style={styles.catCardPlainScrim} />
                <View style={{ padding: 20, justifyContent: "flex-end" }}>
                  <Text style={[styles.catCardPlainHeading, { color: WHITE, fontSize: 20 }]}>
                    Keep your space fresh &{"\n"}clean
                  </Text>
                  <Text
                    style={[
                      styles.catCardPlainSubtext,
                      { color: "rgba(255,255,255,0.85)", textTransform: "none", letterSpacing: 0 },
                    ]}
                  >
                    Everyday essentials, fully stocked for your home or business needs.
                  </Text>
                </View>
              </View>
            </View>
          )}
        </View>

        {/* ── 2D Market View (embedded, no separate page) ─────────────────────── */}
        <View
          style={[
            styles.section,
            {
              backgroundColor: BG,
              paddingVertical: secPad,
              paddingHorizontal: hPad,
              // Fills the full viewport so the Contact Us section
              // underneath doesn't peek in below the map/buttons --
              // content alone falls short of screen height.
              minHeight: height * 0.95,
              justifyContent: "center",
            },
          ]}
          onLayout={(e) => {
            marketMapSectionY.current = e.nativeEvent.layout.y;
          }}
          {...({ className: "rw-reveal" } as any)}
        >
          <MarketMapEmbed
            maxWidth={950}
            title={"Market Blueprint\n& Stall Status"}
            description={"Tap any stall to view real-time occupancy.\nGreen stalls are ready for immediate lease."}
            outerPaddingH={hPad}
          />
        </View>

        {/* ── Find Us (Mapbox) ─────────────────────────────────────────────── */}
        <View
          style={[
            styles.section,
            {
              backgroundColor: WHITE,
              paddingVertical: secPad,
              paddingHorizontal: hPad,
              // Fills the full viewport so this section reads as a full
              // screen even though its content (row + footer) falls short
              // of screen height on its own.
              minHeight: height * 0.95,
              justifyContent: "center",
              // Anchors the footer below (position: "absolute") to this
              // section's own edges instead of the page's.
              position: "relative",
            },
          ]}
          onLayout={(e) => {
            findUsSectionY.current = e.nativeEvent.layout.y;
          }}
          {...({ className: "rw-reveal" } as any)}
        >
          <View
            style={[
              styles.findUsRow,
              {
                flexDirection: isMobile ? "column" : "row",
                alignItems: isMobile ? "stretch" : "center",
                gap: isMobile ? 32 : 48,
                position: "relative",
                top: isMobile ? 0 : isTablet ? -25 : -40,
              },
            ]}
          >
            {(() => {
              const contactInfo = (
                <View
                  key="contact-info"
                  style={[
                    styles.contactInfoCol,
                    !isMobile && { flex: 1 },
                    { position: "relative", top: isMobile ? 0 : isTablet ? -90 : -160 },
                  ]}
                >
                  <Text style={[styles.contactHeading, { fontSize: isMobile ? 24 : isTablet ? 28 : 32 }]}>
                    Contact Us
                  </Text>
                  <Text style={styles.contactSubtext}>
                    Have a question about a stall, or need help finding your way around?
                    Reach out and we'll get back to you.
                  </Text>

                  <View style={styles.contactDetails}>
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
              );

              const navMap = (
                <View key="nav-map" style={[styles.mapWrap, !isMobile && { flex: 1.6 }]}>
                  <NavigableMap
                    height={isMobile ? 260 : isTablet ? 360 : 440}
                    isMobile={isMobile}
                  />
                </View>
              );

              // Mobile: map sits on top, Contact Us info below it (reversed
              // from desktop/tablet's info-then-map order).
              return isMobile ? [navMap, contactInfo] : [contactInfo, navMap];
            })()}
          </View>

          {/* ── Footer ───────────────────────────────────────────────────── */}
          <View
            style={[
              styles.footer,
              { paddingHorizontal: navPad },
              // Pinned to the section's own bottom edge (it's
              // position:"relative") on every breakpoint now -- mobile used
              // to stay in normal flow with alignSelf:"stretch", but that
              // only stretched it to the section's own (already inset)
              // content box and left it wherever it fell after the map,
              // not flush against the true bottom edge.
              { position: "absolute", left: 0, right: 0, bottom: 0 },
              // Absolute left/right:0 only reaches the section's own padding
              // edge (still inset by the section's paddingHorizontal), so on
              // mobile pull it out that same amount to actually go edge to
              // edge of the screen.
              isMobile && { marginHorizontal: -hPad },
            ]}
          >
            <Text style={styles.footerCopy}>
              © {new Date().getFullYear()} RentWise. All rights reserved.
            </Text>
          </View>
        </View>
      </ScrollView>

      {SHOW_NAV && !isMobile && (
        <Animated.View
          pointerEvents={showStickyNav ? "auto" : "none"}
          style={[
            styles.navBar,
            styles.navBarSticky,
            { paddingHorizontal: navPad },
            {
              opacity: stickyNavAnim,
              transform: [
                {
                  translateY: stickyNavAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-100, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={{ flex: 1, alignItems: "center" }}>
            <View style={[styles.navRightGroup, isTablet && { gap: 20, left: 24 }]}>
              <View style={[styles.navLinks, isTablet && { gap: 16 }]}>
                <View style={[styles.navBrand, isTablet && { left: -46 }]}>
                  <Image
                    source={require("../assets/hero-section/logo.png")}
                    resizeMode="contain"
                    style={[styles.navBrandMark, isTablet && { width: 54, height: 54 }]}
                  />
                  <Text style={[styles.navBrandText, isTablet && { fontSize: 17 }]}>KaDomeng</Text>
                </View>
                <NavLinkButton
                  label="Home"
                  isTablet={isTablet}
                  onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
                />
                <NavLinkButton
                  label="About Us"
                  isTablet={isTablet}
                  onPress={() => scrollToSection(catTrackStart.current + (isTablet ? 160 : 90))}
                />
                <NavLinkButton
                  label="2D Map View"
                  isTablet={isTablet}
                  onPress={() => scrollToSection(marketMapSectionY.current + (isTablet ? 20 : 0))}
                />
              </View>

              <NavCtaButton
                isTablet={isTablet}
                onPress={() => scrollRef.current?.scrollToEnd({ animated: true })}
              />
            </View>
          </View>
        </Animated.View>
      )}

      {/* Mobile: no room for the full nav row, so it's a persistent
          logo + hamburger bar (always visible, not scroll-triggered like
          the sticky nav above) that toggles a dropdown of the same links. */}
      {SHOW_NAV && isMobile && (
        <View style={[styles.navBar, styles.navBarSticky, { paddingHorizontal: navPad, justifyContent: "space-between" }]}>
          <View style={styles.navBrandMobile}>
            <Image
              source={require("../assets/hero-section/logo.png")}
              resizeMode="contain"
              style={styles.navBrandMarkMobile}
            />
            <Text style={styles.navBrandTextMobile}>KaDomeng</Text>
          </View>
          <Pressable onPress={() => setMobileMenuOpen((v) => !v)} hitSlop={10}>
            <Ionicons name={mobileMenuOpen ? "close" : "menu"} size={26} color={TEXT_DARK} />
          </Pressable>

          {mobileMenuOpen && (
            <View style={styles.mobileMenuPanel}>
              <Pressable
                style={styles.mobileMenuItem}
                onPress={() => {
                  scrollRef.current?.scrollTo({ y: 0, animated: true });
                  setMobileMenuOpen(false);
                }}
              >
                <Text style={styles.mobileMenuItemText}>Home</Text>
              </Pressable>
              <Pressable
                style={styles.mobileMenuItem}
                onPress={() => {
                  scrollToSection(catTrackStart.current + 120);
                  setMobileMenuOpen(false);
                }}
              >
                <Text style={styles.mobileMenuItemText}>About Us</Text>
              </Pressable>
              <Pressable
                style={styles.mobileMenuItem}
                onPress={() => {
                  scrollToSection(marketMapSectionY.current + 40);
                  setMobileMenuOpen(false);
                }}
              >
                <Text style={styles.mobileMenuItemText}>2D Map View</Text>
              </Pressable>
              <Pressable
                style={styles.mobileMenuCta}
                onPress={() => {
                  scrollRef.current?.scrollToEnd({ animated: true });
                  setMobileMenuOpen(false);
                }}
              >
                <Text style={styles.mobileMenuCtaText}>Contact Us</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: WHITE },

  scroll: { paddingBottom: 0 },

  // Nav bar
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    backgroundColor: BG,
  },
  navBarSticky: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 30,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  navBrand: {
    flexDirection: "row",
    alignItems: "center",
    position: "relative",
    // Cancels out navRightGroup's own `left` shift so the logo/brand stays
    // put while the nav links + CTA (navRightGroup's other children) move.
    left: -114,
    gap: 10,
  },
  navBrandMark: {
    width: 70,
    height: 70,
    borderRadius: 17,
  },
  navBrandText: {
    fontFamily: "PlayfairDisplay_700Bold",
    fontWeight: "900",
    fontSize: 20,
    color: TEXT_DARK,
    letterSpacing: -0.2,
  },
  navRightGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 36,
    position: "relative",
    left: 65,
  },
  navLinks: {
    flexDirection: "row",
    alignItems: "center",
    gap: 26,
  },
  navLinkText: {
    fontSize: 14.5,
    fontWeight: "600",
    color: TEXT_DARK,
  },
  navLinkBtn: {
    paddingVertical: 6,
    paddingHorizontal: 6,
    overflow: "hidden",
  },
  navCta: {
    backgroundColor: "#8BC53F",
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 4,
    overflow: "hidden",
  },
  navCtaText: {
    color: WHITE,
    fontSize: 13.5,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  // Mobile nav (logo + hamburger, matches desktop/tablet's persistent-bar
  // treatment via navBarSticky, but always visible instead of scroll-in)
  navBrandMobile: { flexDirection: "row", alignItems: "center", gap: 8 },
  navBrandMarkMobile: { width: 40, height: 40, borderRadius: 10 },
  navBrandTextMobile: {
    fontFamily: "PlayfairDisplay_700Bold",
    fontWeight: "900",
    fontSize: 16,
    color: TEXT_DARK,
    letterSpacing: -0.2,
  },
  mobileMenuPanel: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    backgroundColor: SURFACE,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 6,
  },
  mobileMenuItem: { paddingVertical: 12 },
  mobileMenuItemText: { fontSize: 15.5, fontWeight: "600", color: TEXT_DARK },
  mobileMenuCta: {
    backgroundColor: "#8BC53F",
    borderRadius: 4,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 8,
    marginBottom: 8,
  },
  mobileMenuCtaText: {
    color: WHITE,
    fontSize: 13.5,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  // Hero
  hero: {
    position: "relative",
    backgroundColor: BG,
    justifyContent: "center",
  },
  heroContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    width: "100%",
  },
  heroEyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  heroEyebrowIcon: {
    width: 50,
    height: 50,
    position: "relative",
    left: 12,
  },
  heroEyebrow: {
    color: TEXT_DARK,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
  },
  heroHeadline: {
    color: TEXT_DARK,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    letterSpacing: -0.5,
  },
  heroBodyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    marginTop: 4,
  },
  heroBodyDivider: {
    width: 2,
    alignSelf: "stretch",
    backgroundColor: CREAM_LINE,
  },
  heroSubtext: {
    color: TEXT_MUTED,
    lineHeight: 24,
    maxWidth: 380,
    flexShrink: 1,
  },
  heroActions: {
    flexDirection: "row",
    gap: 14,
    marginTop: 10,
  },
  heroPrimaryBtn: {
    backgroundColor: "#8BC53F",
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 4,
    alignItems: "center",
  },
  heroPrimaryBtnText: { color: WHITE, fontSize: 14, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  heroSecondaryBtn: {
    backgroundColor: SURFACE,
    borderWidth: 1.5,
    borderColor: BORDER,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 4,
    alignItems: "center",
  },
  heroSecondaryBtnText: { color: TEXT_DARK, fontSize: 14, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  heroDots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    paddingBottom: 28,
    position: "relative",
    bottom: 16,
  },
  heroDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#D8D3C6",
  },
  heroDotActive: {
    backgroundColor: PRIMARY,
  },

  // Market Pulse
  pulseSection: {
    backgroundColor: PRIMARY_DARK,
  },
  pulseHeaderRow: {
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 40,
  },
  pulseHeading: {
    fontFamily: "PlayfairDisplay_400Regular_Italic",
    color: WHITE,
    marginBottom: 10,
  },
  pulseSubtext: {
    color: "#B9D6C6",
    fontSize: 15,
    lineHeight: 22,
  },
  pulseCardsRow: {
    width: "100%",
  },
  pulseCard: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 16,
    padding: 24,
  },
  pulseCardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pulseStallLabel: {
    color: "#8BC53F",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  pulseVacantLabel: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#8BC53F",
  },
  pulseDotVacant: {
    backgroundColor: "rgba(255,255,255,0.35)",
  },
  pulseVendorName: {
    fontFamily: "PlayfairDisplay_700Bold",
    color: WHITE,
    fontSize: 19,
    marginTop: 14,
  },
  pulseHighlight: {
    color: "#B9D6C6",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
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

  // Categories (card grid)
  catGrid: {
    width: "100%",
    maxWidth: 1180,
    alignSelf: "center",
    marginTop: 32,
  },
  catCardEditorialName: {
    fontFamily: "PlayfairDisplay_400Regular_Italic",
    color: TEXT_DARK,
    fontSize: 20,
    marginTop: 16,
  },
  catCardEditorialCaption: {
    color: TEXT_MUTED,
    fontSize: 13,
    marginTop: 4,
  },
  catCardPlainHeading: {
    fontFamily: "PlayfairDisplay_700Bold",
    color: PRIMARY_DARK,
    fontSize: 22,
  },
  catCardPlainSubtext: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginTop: 6,
  },
  // Fades the card photo from clear at the top to dark at the bottom (real
  // CSS gradient -- rentwise-guest is web-only, so this passes straight
  // through react-native-web to the underlying div's style) so the white
  // heading/subtext sitting on top of it stays readable against any image.
  catCardPlainScrim: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0) 35%, rgba(0,0,0,0.7) 100%)",
  } as any,

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
    alignItems: "center",
  },
  contactInfoCol: {
    gap: 16,
  },
  contactHeading: {
    fontFamily: "PlayfairDisplay_400Regular_Italic",
    color: PRIMARY_DARK,
    fontWeight: "400",
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
});
