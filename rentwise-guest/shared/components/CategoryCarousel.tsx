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

const DEFAULT_VISIBLE = 5;
const DEFAULT_GAP = 24;
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
  visibleCount = DEFAULT_VISIBLE,
  gap = DEFAULT_GAP,
  topText,
  bottomText,
}: Props) {
  const loopCards = React.useMemo(() => [...cards, ...cards], [cards]);

  const rowRef = useRef<any>(null);
  const cardRefs = useRef<any[]>([]);
  const windowRef = useRef(0);
  const currentX = useRef(0);
  const lastTick = useRef(0);

  const cardW = Math.min((panelWidth * 0.92 - (visibleCount - 1) * gap) / visibleCount, 340);
  const cardH = cardW * 1.28;
  const step = cardW + gap;
  const stepRef = useRef(step);
  stepRef.current = step;

  React.useEffect(() => {
    if (Platform.OS !== "web") return;
    const cardCount = cards.length;
    let rafId: number;
    const tick = (now: number) => {
      if (!lastTick.current) lastTick.current = now;
      if (now - lastTick.current >= STEP_MS) {
        lastTick.current = now;
        // Always advance — once it lands on the duplicated half of the row,
        // silently rewind both the index and the eased position by exactly
        // one loop-length. Same visual content, so the reset is invisible.
        let next = windowRef.current + 1;
        if (next >= cardCount) {
          next -= cardCount;
          currentX.current += cardCount * stepRef.current;
        }
        windowRef.current = next;
      }

      const target = -windowRef.current * stepRef.current;
      currentX.current += (target - currentX.current) * EASE;
      if (rowRef.current && rowRef.current.style) {
        rowRef.current.style.transform = `translateX(${currentX.current}px)`;
      }

      // Fanned "door/book" formation: each card rotates in 3D away from
      // whichever one is currently centered, based on the same continuously
      // eased position driving the slide, so the fan re-forms smoothly as
      // the row glides between cards.
      const continuousCenter = -currentX.current / stepRef.current + Math.floor(visibleCount / 2);
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

      <View style={[styles.viewport, { width: visibleCount * step - gap }]}>
        <View ref={rowRef} style={[styles.row, { gap }]}>
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
