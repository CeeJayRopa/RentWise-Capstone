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
import { useBreakpoints } from "../shared/hooks/useBreakpoints";
import { submitContactMessage } from "../services/contactService";

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
// Category rows background — a near-white mint, subtler than PRIMARY_TINT.
const CATEGORY_BG = "#F6FBF7";
const CREAM_LINE = "#DCD0B8";
const CREAM_TAG_BG = "#FBF8F1";

const FACEBOOK_URL = "https://www.facebook.com/kadomeng.talipapa";

// ─── Data ────────────────────────────────────────────────────────────────────
const WET_MARKET_IMG_1 = require("../assets/wet-market/Wet_Market_1.png");
const WET_MARKET_IMG_2 = require("../assets/wet-market/Wet_Market_2.png");
const DRY_MARKET_IMG_1 = require("../assets/dry-market/Dry_market_1.png");
const DRY_MARKET_IMG_2 = require("../assets/dry-market/Dry_market_2.png");
const HOME_ESSENTIALS_IMG_1 = require("../assets/home-essentials/Home_Essentials_1.png");
const HOME_ESSENTIALS_IMG_2 = require("../assets/home-essentials/Home_Essentials_2.png");

const CATEGORIES = [
  {
    slug: "wet-market",
    label: "Wet Market",
    heading: "Fresh from the coast, on ice by dawn.",
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
    heading: "Straight from the farm, piled high daily.",
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
    heading: "The stall you didn't know you needed.",
    description:
      "Bottled cooking oil, sachets, and hanging rows of snacks the everyday sari-sari staples every household restocks on the way home.",
    tags: ["Mantika", "Sabon", "Asukal", "Kape", "Toyo"],
    image: HOME_ESSENTIALS_IMG_1,
    secondaryImage: HOME_ESSENTIALS_IMG_2 as any,
    route: "/home-essentials",
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
  const CATEGORY_SCROLL_LENGTH = PIN_H * 1.4;

  const scrollRef = useRef<ScrollView>(null);
  const marketMapSectionY = useRef(0);
  const contactSectionY = useRef(0);
  const [activeCatIndex, setActiveCatIndex] = useState(0);

  // ── Contact form ──────────────────────────────────────────────────────────
  const [contactFirstName, setContactFirstName] = useState("");
  const [contactLastName, setContactLastName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactMessage, setContactMessage] = useState("");
  const [contactSubmitting, setContactSubmitting] = useState(false);
  const [contactStatus, setContactStatus] = useState<"idle" | "success" | "error">("idle");
  const [contactError, setContactError] = useState("");

  const handleContactSubmit = async () => {
    const firstName = contactFirstName.trim();
    const lastName = contactLastName.trim();
    const email = contactEmail.trim();
    const message = contactMessage.trim();

    if (!firstName || !lastName) {
      setContactStatus("error");
      setContactError("Please enter your first and last name.");
      return;
    }
    // Simple, deliberately permissive shape check -- this only needs to catch
    // "clearly not an email", not validate every RFC 5322 edge case.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setContactStatus("error");
      setContactError("Please enter a valid email address.");
      return;
    }
    if (!message) {
      setContactStatus("error");
      setContactError("Please let us know how we can help.");
      return;
    }

    setContactSubmitting(true);
    setContactStatus("idle");
    try {
      await submitContactMessage({
        firstName,
        lastName,
        email,
        phone: contactPhone.trim(),
        message,
      });
      setContactStatus("success");
      setContactFirstName("");
      setContactLastName("");
      setContactEmail("");
      setContactPhone("");
      setContactMessage("");
    } catch (err) {
      console.error("[Contact] failed to submit message:", err);
      setContactStatus("error");
      setContactError("Something went wrong sending your message. Please try again.");
    } finally {
      setContactSubmitting(false);
    }
  };

  // Panel crossfade — eased by hand every frame, since CSS transitions on
  // toggled opacity weren't reliably animating in this RN-Web setup.
  const activeCatIndexRef = useRef(0);
  const catPanelRefs = useRef<any[]>([]);
  const catPanelOpacity = useRef<number[]>(CATEGORIES.map((_, i) => (i === 0 ? 1 : 0)));
  // Image "pop": a real spring (velocity + damping), not just an ease,
  // so the incoming category's photo overshoots past its resting scale and
  // settles back instead of just fading in flat — the tiny bounce Parsec's
  // site uses on its own scroll-driven feature illustrations. Kept on a
  // separate ref/node from the opacity crossfade above since only the photo
  // itself should bounce, not the badge label sitting on top of it.
  const catImageRefs = useRef<any[]>([]);
  const catImageScale = useRef<number[]>(CATEGORIES.map((_, i) => (i === 0 ? 1 : 0.88)));
  const catImageVelocity = useRef<number[]>(CATEGORIES.map(() => 0));
  // Same spring feel on the text column (number/heading/description/tags),
  // but as a rise-up translateY rather than a scale -- scaling multi-line
  // text from a center origin reads as blurry/jittery, a translateY pop
  // doesn't have that problem and still gives the same bounce-into-place
  // motion as the image.
  const catTextRefs = useRef<any[]>([]);
  const catTextOffset = useRef<number[]>(CATEGORIES.map((_, i) => (i === 0 ? 0 : 16)));
  const catTextVelocity = useRef<number[]>(CATEGORIES.map(() => 0));
  React.useEffect(() => {
    if (Platform.OS !== "web") return;
    let rafId: number;
    const EASE = 0.07;
    const SPRING_STIFFNESS = 0.12;
    const SPRING_DAMPING = 0.72;
    const loop = () => {
      CATEGORIES.forEach((_, i) => {
        const isActive = activeCatIndexRef.current === i;

        const target = isActive ? 1 : 0;
        catPanelOpacity.current[i] += (target - catPanelOpacity.current[i]) * EASE;
        const node = catPanelRefs.current[i];
        if (node && node.style) {
          node.style.opacity = String(catPanelOpacity.current[i]);
        }

        const scaleTarget = isActive ? 1 : 0.88;
        catImageVelocity.current[i] =
          (catImageVelocity.current[i] + (scaleTarget - catImageScale.current[i]) * SPRING_STIFFNESS) *
          SPRING_DAMPING;
        catImageScale.current[i] += catImageVelocity.current[i];
        const imgNode = catImageRefs.current[i];
        if (imgNode && imgNode.style) {
          imgNode.style.transform = `scale(${catImageScale.current[i]})`;
        }

        const offsetTarget = isActive ? 0 : 16;
        catTextVelocity.current[i] =
          (catTextVelocity.current[i] + (offsetTarget - catTextOffset.current[i]) * SPRING_STIFFNESS) *
          SPRING_DAMPING;
        catTextOffset.current[i] += catTextVelocity.current[i];
        const textNode = catTextRefs.current[i];
        if (textNode && textNode.style) {
          textNode.style.transform = `translateY(${catTextOffset.current[i]}px)`;
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
  const heroFontSize = isMobile ? 34 : isTablet ? 44 : 54;
  // Hero-only override — increases side padding on mobile without touching
  // `hPad`, which every other section on the page still relies on.
  const heroPadH = isMobile ? 24 : hPad;
  // Buttons stay side-by-side down to 390px; below that they stack full-width.
  const isTinyMobile = isMobile && width < 390;

  // Shared between the pinned (desktop/tablet) and stacked (mobile) category
  // layouts so the number/heading/description/tags markup isn't duplicated.
  const renderCategoryText = (cat: (typeof CATEGORIES)[number], compact?: boolean) => (
    <>
      <Text style={[styles.marketRowEyebrow, isDesktop && { fontSize: 13.5 }]}>{cat.label}</Text>
      <Text
        style={[
          styles.marketRowHeading,
          { fontSize: isMobile ? 26 : isDesktop ? 40 : compact ? 30 : 34 },
        ]}
      >
        {cat.heading}
      </Text>
      <Text
        style={[
          styles.marketRowDesc,
          compact && { marginBottom: 20 },
          isDesktop && { fontSize: 17.5, lineHeight: 28 },
        ]}
      >
        {cat.description}
      </Text>

      <Text style={[styles.marketRowFindLabel, isDesktop && { fontSize: 13 }]}>WHAT YOU'LL FIND</Text>
      <View style={styles.marketRowTags}>
        {cat.tags.map((tag) => (
          <View key={tag} style={[styles.marketRowTag, isDesktop && styles.marketRowTagDesktop]}>
            <Text style={[styles.marketRowTagText, isDesktop && { fontSize: 15 }]}>{tag}</Text>
          </View>
        ))}
      </View>
    </>
  );

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
            { minHeight: isDesktop ? 640 : isMobile ? 480 : 560 },
          ]}
        >
          {/* Solid dark-green base + a faint diagonal mesh grid and a soft
              glow accent — an abstract, tech-forward feel per the reference,
              replacing the real market photo the hero used to bleed in from
              the right. Web-only (gradients aren't a real style prop). */}
          <View
            style={[
              StyleSheet.absoluteFill,
              Platform.OS === "web"
                ? ({
                    backgroundImage: `
                      repeating-linear-gradient(120deg, rgba(76,175,120,0.10) 0px, rgba(76,175,120,0.10) 1px, transparent 1px, transparent 64px),
                      repeating-linear-gradient(60deg, rgba(76,175,120,0.10) 0px, rgba(76,175,120,0.10) 1px, transparent 1px, transparent 64px),
                      radial-gradient(circle at 84% 18%, rgba(76,175,120,0.30), transparent 45%)
                    `,
                  } as any)
                : null,
            ]}
          />

          <View
            style={[
              styles.heroContent,
              {
                paddingHorizontal: heroPadH,
                paddingVertical: isDesktop ? 0 : isMobile ? 40 : 60,
                justifyContent: "center",
                alignItems: "center",
              },
            ]}
          >
            <View style={{ maxWidth: 720, alignItems: "center", gap: isMobile ? 0 : 16 }}>
              <Text
                style={[
                  styles.heroEyebrow,
                  { textAlign: "center" },
                  isMobile && { fontSize: 12, marginBottom: 8 },
                ]}
              >
                Ka Domeng Talipapa Market
              </Text>
              <Text
                style={[
                  styles.heroHeadline,
                  {
                    textAlign: "center",
                    fontSize: heroFontSize,
                    lineHeight: heroFontSize * (isMobile ? 1.1 : 1.15),
                  },
                  isMobile && { marginBottom: 16 },
                ]}
              >
                Shop Fresh. Grow Your Business.{"\n"}All in One Market.
              </Text>
              <Text
                style={[
                  styles.heroSubtext,
                  { textAlign: "center", fontSize: isMobile ? 14 : 16, maxWidth: 520 },
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
          </View>
        </View>

        {/* ── Market sections (numbered, alternating image/text) ─────────────── */}
        {/* Pinned scroll-crossfade now runs at every breakpoint -- only the
            inner layout changes (side-by-side on desktop, stacked on
            tablet/phone, matching each one's own available width). The
            "Your One-Stop Public Market" title is repeated inside each
            category panel's own content instead of living as a separate
            shared header above them -- that read as its own floating card
            with a gap under it, rather than being part of the categories. */}
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
            {CATEGORIES.map((cat, i) => {
              const reversed = i % 2 === 1;

              let imgW: number;
              let imgH: number;
              if (isDesktop) {
                imgH = Math.min(PIN_H * 0.56, 460);
                // Capped by the actual available width too, not just PIN_H
                // -- a laptop-height screen at a narrow "just barely
                // desktop" width (or an unmaximized browser window) could
                // otherwise ask for an image wider than there's room for
                // next to a readable text column, squeezing it to nothing.
                const rowContentWidth = Math.min(width - hPad * 2, 1180);
                const TEXT_MIN_WIDTH = 320;
                const IMAGE_TEXT_GAP = 56;
                const maxImgWByWidth = Math.max(240, rowContentWidth - TEXT_MIN_WIDTH - IMAGE_TEXT_GAP);
                imgW = Math.min(PIN_H * 0.74, 540, maxImgWByWidth);
              } else {
                // Explicit pixel width/height instead of the stylesheet's
                // `aspectRatio` -- that wasn't reliably respected by these
                // source photos on web (each rendered at its own real,
                // sometimes very tall portrait-phone-photo aspect instead
                // of the intended box).
                imgW = (width - hPad * 2) * 0.85;
                imgH = imgW / 1.05;
              }
              const insetW = imgW * 0.4;
              const insetH = insetW * 0.84;
              const insetPokeOut = insetH * 0.4;

              return (
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
                  {(() => {
                    const content = (
                      <>
                        <Text
                          style={[
                            styles.sectionTitle,
                            { fontSize: isMobile ? 18 : 24, paddingHorizontal: hPad },
                          ]}
                        >
                          Your One-Stop Public Market
                        </Text>
                        <View
                          style={[
                            styles.pinRowInner,
                            isDesktop
                              ? { flexDirection: reversed ? "row-reverse" : "row", paddingHorizontal: hPad }
                              : { flexDirection: "column", paddingHorizontal: hPad },
                          ]}
                        >
                        <View style={{ width: imgW, position: "relative", marginLeft: isDesktop ? 0 : 32 }}>
                          <Image
                            ref={(el) => {
                              catImageRefs.current[i] = el;
                            }}
                            source={cat.image}
                            style={{ width: imgW, height: imgH, borderRadius: 20 }}
                            resizeMode="cover"
                          />
                          {cat.secondaryImage && (
                            <Image
                              source={cat.secondaryImage}
                              style={[
                                styles.catCollageInset,
                                { width: insetW, height: insetH, bottom: -insetPokeOut, left: -insetW * 0.2 },
                              ]}
                              resizeMode="cover"
                            />
                          )}
                        </View>

                        <View
                          ref={(el) => {
                            catTextRefs.current[i] = el;
                          }}
                          style={[
                            styles.marketRowTextCol,
                            isDesktop
                              ? reversed
                                ? { marginRight: 56 }
                                : { marginLeft: 56 }
                              : {
                                  flex: 0,
                                  width: "100%",
                                  maxWidth: "100%",
                                  marginTop: 28 + (cat.secondaryImage ? insetPokeOut : 0),
                                },
                          ]}
                        >
                          {renderCategoryText(cat, true)}
                        </View>
                      </View>
                      </>
                    );

                    // Safety net for short phone/tablet viewports: stacked
                    // image + full text block (heading, description, up to
                    // 6 tag chips) can end up taller than what's left of
                    // PIN_H once the title above it is accounted for. Rather
                    // than trust every device to have enough room and let
                    // overflow:hidden silently clip whatever doesn't fit, a
                    // scroll view lets it still all be reachable. Desktop's
                    // side-by-side layout uses far less vertical space, so
                    // it keeps the plain (non-scrolling) centered box.
                    return isDesktop ? (
                      content
                    ) : (
                      <ScrollView
                        style={{ width: "100%", height: "100%" }}
                        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", alignItems: "center" }}
                        showsVerticalScrollIndicator={false}
                      >
                        {content}
                      </ScrollView>
                    );
                  })()}
                </View>
              );
            })}
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
          style={[styles.section, { backgroundColor: PRIMARY_TINT, paddingVertical: secPad, paddingHorizontal: hPad }]}
          onLayout={(e) => {
            marketMapSectionY.current = e.nativeEvent.layout.y;
          }}
          {...({ className: "rw-reveal" } as any)}
        >
          <MarketMapEmbed
            maxWidth={1100}
            eyebrow="2D MARKET VIEW"
            title="Market Blueprint"
            description="Tap any stall to see its status, or check what's vacant right now."
          />
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
                  value={contactFirstName}
                  onChangeText={setContactFirstName}
                  maxLength={60}
                />
                <TextInput
                  style={[styles.contactInput, { flex: 1 }]}
                  placeholder="Last name"
                  placeholderTextColor={TEXT_MUTED}
                  value={contactLastName}
                  onChangeText={setContactLastName}
                  maxLength={60}
                />
              </View>
              <TextInput
                style={styles.contactInput}
                placeholder="Your email"
                placeholderTextColor={TEXT_MUTED}
                keyboardType="email-address"
                autoCapitalize="none"
                value={contactEmail}
                onChangeText={setContactEmail}
                maxLength={200}
              />
              <TextInput
                style={styles.contactInput}
                placeholder="Phone number"
                placeholderTextColor={TEXT_MUTED}
                keyboardType="phone-pad"
                value={contactPhone}
                onChangeText={setContactPhone}
                maxLength={30}
              />
              <TextInput
                style={[styles.contactInput, styles.contactTextarea]}
                placeholder="How can we help?"
                placeholderTextColor={TEXT_MUTED}
                multiline
                numberOfLines={4}
                value={contactMessage}
                onChangeText={setContactMessage}
                maxLength={2000}
              />

              {contactStatus === "error" && (
                <Text style={styles.contactStatusError}>{contactError}</Text>
              )}
              {contactStatus === "success" && (
                <Text style={styles.contactStatusSuccess}>
                  Message sent — we'll get back to you soon.
                </Text>
              )}

              <TouchableOpacity
                style={[styles.contactSubmitBtn, contactSubmitting && { opacity: 0.6 }]}
                onPress={handleContactSubmit}
                disabled={contactSubmitting}
                {...({ className: "rw-btn-primary" } as any)}
              >
                <Text style={styles.contactSubmitBtnText}>
                  {contactSubmitting ? "Sending…" : "Submit"}
                </Text>
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
  heroContent: {
    flex: 1,
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

  // Market sections (numbered, alternating image/text)
  catPinWrap: {
    position: "relative",
    width: "100%",
    overflow: "hidden",
    backgroundColor: CATEGORY_BG,
  },
  catPinPanel: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    overflow: "hidden",
    justifyContent: "center",
  },
  pinRowInner: {
    width: "100%",
    maxWidth: 1180,
    alignSelf: "center",
    alignItems: "center",
  },
  // Small overlapping inset photo -- only rendered when a category has a
  // real secondaryImage set.
  catCollageInset: {
    position: "absolute",
    bottom: -20,
    left: -20,
    borderRadius: 14,
    borderWidth: 4,
    borderColor: WHITE,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 14,
    elevation: 6,
  },
  marketRowTextCol: {
    flex: 1,
    maxWidth: 560,
  },
  marketRowEyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
    color: TEXT_MUTED,
    marginBottom: 14,
    textTransform: "uppercase",
  },
  marketRowHeading: {
    fontFamily: "Inter_800ExtraBold",
    color: TEXT_DARK,
    marginBottom: 16,
  },
  marketRowDesc: {
    fontSize: 15.5,
    lineHeight: 25,
    color: TEXT_MUTED,
    marginBottom: 28,
    maxWidth: 460,
  },
  marketRowFindLabel: {
    fontSize: 11.5,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: PRIMARY_DARK,
    marginBottom: 12,
  },
  marketRowTags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  marketRowTag: {
    backgroundColor: CREAM_TAG_BG,
    borderWidth: 1,
    borderColor: CREAM_LINE,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  marketRowTagDesktop: { paddingHorizontal: 18, paddingVertical: 10 },
  marketRowTagText: { fontSize: 13.5, fontWeight: "600", color: TEXT_DARK },
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
  contactStatusError: { color: "#C0392B", fontSize: 13.5, fontWeight: "600" },
  contactStatusSuccess: { color: PRIMARY_DARK, fontSize: 13.5, fontWeight: "600" },
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
});
