import React, { useRef } from "react";
import { View, Text, Image, Platform, StyleSheet } from "react-native";

export interface CarouselCard {
  id: number;
  image: any;
}

interface Props {
  cards: readonly CarouselCard[];
  /** Available width to size cards against (usually the window width, since panels are full-bleed). */
  panelWidth: number;
  visibleCount?: number;
  gap?: number;
  /** Optional caption rendered directly above the carousel. */
  topText?: string;
  /** Optional caption rendered directly below the carousel. */
  bottomText?: string;
}

const DEFAULT_GAP = 24;
// Below this panel width, switch to "peek" mode: one big centered card with
// the neighbors cropped to a half-visible sliver at each edge, instead of
// squeezing several full cards down to fit (which reads as illegibly small
// on a phone).
const PEEK_MAX_PANEL_WIDTH = 480;
const PEEK_CARD_WIDTH_FACTOR = 0.42;
const PEEK_GAP = 16;

// Falls back to a width-appropriate card count when the caller doesn't pass
// an explicit `visibleCount` — 5 cards at 320px would render illegibly thin
// slivers, so this keeps cards a sane minimum size on phones/tablets.
function defaultVisibleCount(panelWidth: number) {
  if (panelWidth <= PEEK_MAX_PANEL_WIDTH) return 3;
  if (panelWidth <= 1024) return 3;
  return 5;
}
const STEP_MS = 1800;
const EASE = 0.06;
const ANGLE_STEP = 26;

// Self-contained scroll-free carousel: auto-advances one direction forever
// (the card list is rendered twice back-to-back so it can wrap seamlessly),
// with a 3D "fanned door" formation — cards rotate/scale/fade based on
// distance from whichever one is centered. Everything is animated by hand
// via requestAnimationFrame writing straight to the DOM node styles, since
// CSS transitions on toggled/computed styles weren't reliably animating in
// this RN-Web setup. Each instance owns its own refs/state, so multiple
// carousels (one per category) run fully independently.
export default function CategoryCarousel({
  cards,
  panelWidth,
  visibleCount = defaultVisibleCount(panelWidth),
  gap = DEFAULT_GAP,
  topText,
  bottomText,
}: Props) {
  // Triple-buffered so there's always a real card to peek at on BOTH sides,
  // at every point in the loop — a plain double-up (cards + cards) has
  // nothing before index 0, so the left neighbor goes blank right after
  // each wrap. The animation starts in the middle third and only ever
  // wraps by exactly one band-length, so both edges always have a
  // rendered neighbor.
  const loopCards = React.useMemo(() => [...cards, ...cards, ...cards], [cards]);

  const rowRef = useRef<any>(null);
  const cardRefs = useRef<any[]>([]);
  const windowRef = useRef(0);
  const currentX = useRef(0);
  const lastTick = useRef(0);

  const isPeek = panelWidth <= PEEK_MAX_PANEL_WIDTH;
  const cardW = isPeek
    ? Math.min(panelWidth * PEEK_CARD_WIDTH_FACTOR, 340)
    : Math.min((panelWidth * 0.92 - (visibleCount - 1) * gap) / visibleCount, 340);
  const cardH = cardW * 1.28;
  const rowGap = isPeek ? PEEK_GAP : gap;
  const step = cardW + rowGap;
  // Non-peek mode: viewport fits exactly `visibleCount` cards, and the
  // "centered" card for the fan effect is the one in the middle of that set.
  // Peek mode: viewport is only ~2 card-widths wide, and the row is shifted
  // so the current card's center lands on the viewport's center — leaving
  // roughly half a card visible on each side.
  const viewportWidth = isPeek ? step * 2 - rowGap : visibleCount * step - gap;
  const centerOffset = isPeek ? viewportWidth / 2 - cardW / 2 : Math.floor(visibleCount / 2) * step;

  const stepRef = useRef(step);
  stepRef.current = step;
  const centerOffsetRef = useRef(centerOffset);
  centerOffsetRef.current = centerOffset;

  React.useEffect(() => {
    if (Platform.OS !== "web") return;
    const cardCount = cards.length;
    // Start in the middle band of the triple-buffered array, so there's
    // always a real "previous" card rendered to peek at — jump straight to
    // the matching row position too, so this doesn't play out as a big
    // unwanted slide-in from the (now-irrelevant) x=0 origin on mount.
    windowRef.current = cardCount;
    currentX.current = -cardCount * stepRef.current + centerOffsetRef.current;
    let rafId: number;
    const tick = (now: number) => {
      if (!lastTick.current) lastTick.current = now;
      if (now - lastTick.current >= STEP_MS) {
        lastTick.current = now;
        // Always advance — once it's about to leave the middle band, wrap
        // back by exactly one band-length. Same visual content on either
        // side of the wrap, so the reset is invisible, and both neighbors
        // stay within the triple-buffered array at every position.
        let next = windowRef.current + 1;
        if (next >= cardCount * 2) {
          next -= cardCount;
          currentX.current += cardCount * stepRef.current;
        }
        windowRef.current = next;
      }

      const target = -windowRef.current * stepRef.current + centerOffsetRef.current;
      currentX.current += (target - currentX.current) * EASE;
      if (rowRef.current && rowRef.current.style) {
        rowRef.current.style.transform = `translateX(${currentX.current}px)`;
      }

      // Fanned "door/book" formation: each card rotates in 3D away from
      // whichever one is currently centered, based on the same continuously
      // eased position driving the slide, so the fan re-forms smoothly as
      // the row glides between cards.
      const continuousCenter = (centerOffsetRef.current - currentX.current) / stepRef.current;
      loopCards.forEach((_, ci) => {
        const node = cardRefs.current[ci];
        if (!node || !node.style) return;
        const dist = ci - continuousCenter;
        const angle = Math.max(-55, Math.min(55, dist * ANGLE_STEP));
        const scale = Math.max(0.78, 1 - Math.abs(dist) * 0.09);
        const opacity = Math.max(0.4, 1 - Math.abs(dist) * 0.2);
        node.style.transform = `perspective(1000px) rotateY(${angle}deg) scale(${scale})`;
        node.style.opacity = String(opacity);
      });

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards]);

  return (
    <View style={styles.wrap} pointerEvents="none">
      {topText ? <Text style={styles.topCaption}>{topText}</Text> : null}

      <View style={[styles.viewport, { width: viewportWidth }]}>
        <View ref={rowRef} style={[styles.row, { gap: rowGap }]}>
          {loopCards.map((card, ci) => (
            <View
              key={`${card.id}-${ci}`}
              ref={(el) => {
                cardRefs.current[ci] = el;
              }}
              style={[styles.card, { width: cardW, height: cardH }]}
            >
              <Image source={card.image} style={styles.cardImg} resizeMode="cover" />
            </View>
          ))}
        </View>
      </View>

      {bottomText ? <Text style={styles.bottomCaption}>{bottomText}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    paddingHorizontal: 24,
  },
  topCaption: {
    color: "#E8994A",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    textAlign: "center",
  },
  bottomCaption: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.3,
    lineHeight: 26,
    textAlign: "center",
    maxWidth: 520,
  },
  viewport: {
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  card: {
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    overflow: "hidden",
  },
  cardImg: {
    width: "100%",
    height: "100%",
  },
});
