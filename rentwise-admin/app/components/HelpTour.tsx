import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  useWindowDimensions,
  findNodeHandle,
  UIManager,
  Animated,
  Easing,
} from "react-native";
import { ArrowRight } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, Mask, Rect as SvgRect, Circle as SvgCircle } from "react-native-svg";
import { colors, fontFamily, fontSize, radius, spacing } from "../../shared/theme";

export type HelpStep = {
  key: string;
  ref: React.RefObject<View | null>;
  title: string;
  description: string;
  // Which system-bar edge this step's target sits near, so its spotlight
  // can be corrected by this device's OWN real inset instead of a flat
  // pixel guess tuned against one test device (which is exactly why the
  // old approach broke on other resolutions/OEMs). Defaults to "top".
  edgeInset?: "top" | "bottom";
  // Set for fully circular targets (e.g. round header icon buttons) so the
  // spotlight border is drawn as a circle instead of the default rounded
  // rectangle — otherwise the corners visibly poke out past the icon.
  round?: boolean;
  // Called (and awaited) right before measuring this step's target, so a
  // screen can scroll it into view first — e.g. a FlatList row that isn't
  // currently rendered/visible would otherwise measure to nothing.
  onBeforeMeasure?: () => void | Promise<void>;
  // Trims the spotlight so it never extends within this many px of the
  // screen's bottom edge — for a `flex: 1` target that structurally spans
  // behind a fixed bottom bar (e.g. a list container behind BottomNav),
  // the measured rect includes that area even though it's a separate,
  // absolutely-positioned element on top, so the spotlight would otherwise
  // light up the nav bar too.
  clipBottom?: number;
  // Caps the spotlight's bottom edge at this second element's bottom edge
  // instead of `ref`'s own measured height -- for a step whose ref wraps
  // more content than should actually be highlighted (e.g. a form card
  // that also contains a button meant to be its own separate tour step),
  // this stays correct across devices/content-length/font-scale because
  // it's a live measurement, not a guessed pixel cutoff.
  endRef?: React.RefObject<View | null>;
  // Shrinks the spotlight inward from both the left and right edges by this
  // fraction (0-1) of the measured width -- for a target that's a full-bleed
  // block (only inner padding, no real width constraint), the measured rect
  // is the full screen width, so the spotlight would otherwise stretch
  // edge-to-edge even though the actual content it's meant to highlight is
  // narrower than that. A fraction (not a flat px count) scales with the
  // real measured width instead of staying a fixed size regardless of
  // device screen width.
  insetXPercent?: number;
  // Per-step manual vertical fine-tune, added on top of everything else --
  // for a one-off target that needs its own nudge without touching the
  // shared BOTTOM_NUDGE/EDGE_MARGIN constants other already-confirmed
  // bottom-anchored steps (like the bottom nav icons) rely on.
  nudgeY?: number;
  // Same as nudgeY but as a fraction of screenHeight instead of a flat px
  // count -- scales with the actual device instead of staying a fixed size
  // regardless of screen height. Adds on top of nudgeY if both are set.
  nudgeYPercent?: number;
  // Trims this many px off the spotlight's bottom edge, shrinking its
  // height without moving its top -- for a target whose measured height
  // is taller than what should actually be highlighted.
  heightTrim?: number;
  // Same as heightTrim but as a fraction of the target's own measured
  // height instead of a flat px count -- scales with the target instead of
  // staying a fixed size regardless of device/content. Adds on top of
  // heightTrim if both are set.
  heightTrimPercent?: number;
};

type Rect = { x: number; y: number; width: number; height: number };

const PADDING = 6;
// Safety margin the dim background is deliberately oversized by on every
// edge -- useWindowDimensions() can report a slightly-too-small value on
// the very first render (before it settles to the real screen size) or
// after a Modal reopen, and undersizing the dim rect to match exactly
// leaves a visible uncovered strip. Overhanging past the real screen edges
// has no visual downside (nothing to see out there), so erring oversized
// is strictly safer than erring exact.
const DIM_OVERSIZE = 200;
// How long the title/description/step-counter text keeps showing the
// PREVIOUS step after the card has already faded back in at the new
// position -- deliberately independent of the card's own reveal timing
// (150ms hidden-dwell + 180ms fade-in, ~330ms total), so the text visibly
// lags a beat behind the card rather than switching in lockstep with it.
// Tune this one constant to change just the text's delay.
const TEXT_REVEAL_DELAY_MS = 100;

// First-paint fallback only: real placement switches to the tooltip card's
// own measured height (via onLayout, see tooltipHeight state below) almost
// immediately -- well before measureStable resolves a spotlight rect, which
// waits >=120ms. The trailing safe-area clamp on tooltipTop protects
// placement even on the rare frame this estimate is wrong for a step's
// actual content.
const DEFAULT_TOOLTIP_HEIGHT = 150;

function measure(ref: React.RefObject<View | null>): Promise<Rect | null> {
  return new Promise((resolve) => {
    const node = findNodeHandle(ref.current);
    if (!node) { resolve(null); return; }
    UIManager.measureInWindow(node, (x, y, width, height) => {
      if (width === 0 && height === 0) { resolve(null); return; }
      resolve({ x, y, width, height });
    });
  });
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

// Polls the measurement instead of guessing a fixed delay — header elements
// in particular can report a wrong (too-high) position for a few layout
// passes right after the screen mounts, while safe-area insets are still
// settling to their real value. A brief initial wait plus requiring THREE
// consecutive matching reads (not just two) guards against catching a
// value that's merely stable-for-a-moment mid-transition rather than truly
// final — two-in-a-row was occasionally fooled by exactly that, landing on
// a position hundreds of pixels off from where the element actually settles.
// Falls back to the last reading after `maxAttempts` so it can't hang forever.
async function measureStable(
  ref: React.RefObject<View | null>,
  isCancelled: () => boolean,
  maxAttempts = 14,
  intervalMs = 60,
): Promise<Rect | null> {
  await new Promise((resolve) => setTimeout(resolve, 120));
  if (isCancelled()) return null;

  let last: Rect | null = null;
  let matchStreak = 0;
  for (let i = 0; i < maxAttempts; i++) {
    if (isCancelled()) return null;
    const r = await measure(ref);
    if (sameRect(r, last)) {
      matchStreak++;
      if (matchStreak >= 2) return r;
    } else {
      matchStreak = 0;
    }
    last = r;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return last;
}

export default function HelpTour({
  visible,
  steps,
  onClose,
}: {
  visible: boolean;
  steps: HelpStep[];
  onClose: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [endRect, setEndRect] = useState<Rect | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Live window height, not a one-time Dimensions.get() snapshot — a module-level constant
  // was captured once at whatever moment this file first loaded (often before the window
  // has settled to its real size on some devices), so tooltip placement math built on it
  // could end up using the wrong screen height for that specific device, making the
  // tooltip overlap page content instead of clearing it.
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // Diagnostic only: the Modal's own actual rendered container height, via
  // onLayout, compared against screenHeight (from useWindowDimensions) in
  // the debug readout below -- if these disagree, particularly on a REOPEN
  // of an already-shown tour, that would point to the Modal reusing a
  // stale/undersized native container instead of the real full screen.
  const [containerHeight, setContainerHeight] = useState<number | null>(null);

  // Real rendered height of the tooltip card, captured via onLayout below.
  // Deliberately NOT reset to null on step change -- a stale-but-real height
  // from the previous step is a better estimate than a blind constant, and
  // onLayout corrects it to the new step's real height on the next layout
  // pass (imperceptible in practice).
  const [tooltipHeight, setTooltipHeight] = useState<number | null>(null);

  // Always holds the latest `steps` array without being a dependency of the
  // measurement effect below — every screen recreates its tourSteps array
  // on every render (it isn't memoized), so depending on it directly would
  // restart (and cancel) the in-progress measurement on any unrelated
  // parent re-render, e.g. a Firestore listener updating dashboard stats
  // while the tour is open.
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  // The most recently successful measurement, and which step/index/endRect it
  // belongs to -- kept separate from `rect` (which goes null while a fresh
  // measurement is in flight) so the spotlight/tooltip keep rendering at
  // their last KNOWN GOOD position+text while faded out, instead of jumping
  // to a fallback/partial value that would flash visibly for a frame. Updated
  // below once `step` is in scope.
  const lastGoodRef = useRef<{ rect: Rect; endRect: Rect | null; step: HelpStep; stepIndex: number } | null>(null);

  // The title/description/counter text specifically -- deliberately a
  // SEPARATE snapshot from lastGoodRef (which drives the spotlight's
  // position and the card's own fade/pop timing, unchanged). Updated on its
  // own delay below (TEXT_REVEAL_DELAY_MS), independent of when the card
  // itself repositions/reappears, so the description can lag a beat behind
  // the card instead of switching in lockstep with it.
  const [displayedText, setDisplayedText] = useState<{
    title: string;
    description: string;
    stepIndex: number;
  } | null>(null);

  // Fade-and-pop instead of a sliding/morphing glide -- the dim+hole fades as
  // one piece, while the spotlight BORDER and TOOLTIP additionally scale in
  // from slightly smaller, all while a fresh measurement is in flight, then
  // reverse once it resolves. Driven off `rect` itself (goes null while
  // remeasuring, see the measurement effect below). Since the displayed
  // content always reads through lastGoodRef (a fully resolved snapshot),
  // it's never visible at a wrong/hybrid position -- only ever fully faded
  // out, or showing a fully-consistent step. The scale is deliberately only
  // applied to the border/tooltip, NOT the full-screen dim rect -- scaling
  // something meant to always fill the screen would open a visible gap at
  // the edges mid-animation.
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const popScale = contentOpacity.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });
  useEffect(() => {
    if (!rect) {
      // Snappier exit than the entrance -- the card should disappear fast
      // the moment Next is tapped, well before the next step's measurement
      // (which takes >=240ms, see measureStable) resolves and swaps the
      // text, so the description is never visibly changing while any of
      // the card is still showing.
      Animated.timing(contentOpacity, {
        toValue: 0,
        duration: 60,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
      return;
    }
    // Extra pause fully hidden before revealing the new step, on top of the
    // fade-out + remeasurement time already elapsed -- gives any transient
    // visual artifact tied to the previous step's target (e.g. a lingering
    // native touch/ripple highlight) more time to clear before anything
    // becomes visible again, instead of revealing the instant the new
    // measurement resolves.
    const timer = setTimeout(() => {
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    }, 150);
    return () => clearTimeout(timer);
  }, [rect]);

  // Text swap, on its own separate delay from the card's reveal above -- see
  // TEXT_REVEAL_DELAY_MS. Reads stepIndex fresh via stepsRef (current as of
  // the render that set rect) rather than relying on a variable computed
  // later in this function (past the early-return point below, so it can't
  // be a dependency here).
  useEffect(() => {
    if (!rect) return;
    const timer = setTimeout(() => {
      const currentStep = stepsRef.current[stepIndex];
      if (!currentStep) return;
      setDisplayedText({ title: currentStep.title, description: currentStep.description, stepIndex });
    }, TEXT_REVEAL_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rect]);

  useEffect(() => {
    if (!visible) return;
    setStepIndex(0);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const step = stepsRef.current[stepIndex];
    if (!step) return;

    // Clears the old spotlight immediately so a stale box from the previous
    // step is never shown while the new one is still being measured.
    setRect(null);
    setEndRect(null);

    let cancelled = false;
    Promise.resolve(step.onBeforeMeasure?.()).then(() => {
      if (cancelled) return;
      measureStable(step.ref, () => cancelled).then((r) => {
        if (mountedRef.current && !cancelled) setRect(r);
      });
      if (step.endRef) {
        measureStable(step.endRef, () => cancelled).then((r) => {
          if (mountedRef.current && !cancelled) setEndRect(r);
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [visible, stepIndex]);

  if (!visible || steps.length === 0) return null;

  const step = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;

  // Freeze a full snapshot (rect + the step/endRect it belongs to) the
  // instant a fresh measurement lands -- read through THIS everywhere below
  // instead of the raw (possibly-null-mid-remeasure) rect/step/endRect, so
  // the displayed spotlight/tooltip only ever shows a fully-consistent,
  // fully-measured combination, never a half-updated hybrid.
  if (rect) {
    lastGoodRef.current = { rect, endRect, step, stepIndex };
  }
  const displayRect = lastGoodRef.current?.rect ?? null;
  const displayEndRect = lastGoodRef.current?.endRect ?? null;
  const displayStep = lastGoodRef.current?.step ?? step;
  const displayStepIndex = lastGoodRef.current?.stepIndex ?? stepIndex;

  const spot: Rect = displayRect
    ? (() => {
        // The Modal is statusBarTranslucent, so measureInWindow's coordinate
        // space is shifted from the real screen by ~insets.top -- confirmed
        // on-device for top-anchored spots. That shift comes from the top
        // status bar and applies uniformly across the whole window, so it's
        // the correct fix for bottom-anchored spots too. The previous
        // formula instead added insets.bottom (plus a flat -8 fudge tuned on
        // one device) on the theory that the bottom nav's own reserved
        // gesture-nav padding needed separate compensation -- re-tested
        // across 3 more resolutions (720x1544, 2316x1080, 1220x2712) and
        // that theory was wrong: insets.bottom varies a lot by device
        // (gesture vs 3-button nav) while the real coordinate shift doesn't
        // track it at all, which consistently left the spotlight sitting
        // too high.
        const EDGE_MARGIN = 0;
        const y =
          displayRect.y - PADDING + insets.top + EDGE_MARGIN +
          (displayStep.nudgeY ?? 0) +
          screenHeight * (displayStep.nudgeYPercent ?? 0);
        // When endRef is set and measured, the box's bottom tracks that
        // element's real position instead of rect's own height -- correct
        // regardless of screen size or how much taller the content grows.
        const rawHeight = Math.max(
          0,
          (displayEndRect
            ? Math.max(0, displayEndRect.y + displayEndRect.height - displayRect.y) + PADDING * 2
            : displayRect.height + PADDING * 2) -
            (displayStep.heightTrim ?? 0) -
            displayRect.height * (displayStep.heightTrimPercent ?? 0),
        );
        const maxHeight = displayStep.clipBottom != null ? screenHeight - displayStep.clipBottom - y : rawHeight;
        const insetX = displayRect.width * (displayStep.insetXPercent ?? 0);
        return {
          x: displayRect.x - PADDING + insetX,
          y,
          width: Math.max(0, displayRect.width + PADDING * 2 - insetX * 2),
          height: Math.max(0, Math.min(rawHeight, maxHeight)),
        };
      })()
    : { x: 0, y: 0, width: 0, height: 0 };

  const measuredTooltipHeight = tooltipHeight ?? DEFAULT_TOOLTIP_HEIGHT;

  // screenHeight is the full raw window height (Modal is statusBarTranslucent
  // and useWindowDimensions doesn't subtract system bars), so insets.bottom
  // is what actually distinguishes usable space from a reserved 3-button nav
  // bar, and insets.top is what distinguishes it from under the status bar.
  const spaceBelow = screenHeight - insets.bottom - (spot.y + spot.height);
  const showBelow = !displayRect || spaceBelow > measuredTooltipHeight + 14;
  const idealTooltipTop = displayRect
    ? showBelow
      ? spot.y + spot.height + 14
      : spot.y - 20 - measuredTooltipHeight
    : screenHeight / 2 - 80;

  // Final clamp: whichever branch above fired, the card itself can never
  // render under the status bar (top) or the reserved system nav bar
  // (bottom). Top wins if the card is taller than the remaining safe area on
  // a very short screen (a genuine physical constraint, not a regression --
  // today's Math.max(60, ...) has no bottom protection at all in that case).
  const safeTop = insets.top + 8;
  const safeBottom = screenHeight - insets.bottom - 8;
  const tooltipTop = Math.min(
    Math.max(idealTooltipTop, safeTop),
    Math.max(safeTop, safeBottom - measuredTooltipHeight),
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View
        style={[StyleSheet.absoluteFill, styles.overlayRoot]}
        onLayout={(e) => setContainerHeight(e.nativeEvent.layout.height)}
      >
        {displayRect ? (
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: contentOpacity }]}>
            {/* Explicit pixel width/height (from useWindowDimensions), not
                "100%" -- a percentage here depends on this Svg's own
                container reporting the correct size, which a Modal can get
                wrong on reopen (reusing a stale/undersized native container
                instead of remeasuring against the real screen). Sizing
                directly off screenWidth/screenHeight can't inherit that.
                Also deliberately oversized by DIM_OVERSIZE on every edge (and
                shifted to stay centered on the real screen) so even a
                slightly-too-small screenWidth/screenHeight reading still
                fully covers the true screen with margin to spare -- an
                oversized dim has no visual downside (nothing exists past the
                real edges to reveal), unlike an undersized one. The hole's
                own coordinates below are offset by +DIM_OVERSIZE to land in
                the same true position despite this shift; the spotlight
                border (a sibling below, not inside this shifted wrapper)
                doesn't need any such adjustment. */}
            <View
              style={{
                position: "absolute",
                left: -DIM_OVERSIZE,
                top: -DIM_OVERSIZE,
                width: screenWidth + DIM_OVERSIZE * 2,
                height: screenHeight + DIM_OVERSIZE * 2,
              }}
            >
              <Svg width={screenWidth + DIM_OVERSIZE * 2} height={screenHeight + DIM_OVERSIZE * 2}>
                <Defs>
                  <Mask id="spotlightMask">
                    <SvgRect
                      x={0}
                      y={0}
                      width={screenWidth + DIM_OVERSIZE * 2}
                      height={screenHeight + DIM_OVERSIZE * 2}
                      fill="#fff"
                    />
                    {displayStep.round ? (
                      <SvgCircle
                        cx={spot.x + spot.width / 2 + DIM_OVERSIZE}
                        cy={spot.y + spot.height / 2 + DIM_OVERSIZE}
                        r={spot.width / 2}
                        fill="#000"
                      />
                    ) : (
                      <SvgRect
                        x={spot.x + DIM_OVERSIZE}
                        y={spot.y + DIM_OVERSIZE}
                        width={spot.width}
                        height={spot.height}
                        rx={radius.lg - 2}
                        fill="#000"
                      />
                  )}
                </Mask>
              </Defs>
              <SvgRect
                x={0}
                y={0}
                width={screenWidth + DIM_OVERSIZE * 2}
                height={screenHeight + DIM_OVERSIZE * 2}
                fill={colors.overlay}
                mask="url(#spotlightMask)"
              />
            </Svg>
            </View>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.spotlightBorder,
                {
                  top: spot.y,
                  left: spot.x,
                  width: spot.width,
                  height: spot.height,
                  borderRadius: displayStep.round ? spot.width / 2 : radius.lg - 2,
                  transform: [{ scale: popScale }],
                },
              ]}
            />
          </Animated.View>
        ) : (
          <View style={[styles.dim, StyleSheet.absoluteFill]} />
        )}

        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />

        <Animated.View
          style={[styles.tooltip, { top: tooltipTop, opacity: contentOpacity, transform: [{ scale: popScale }] }]}
          pointerEvents="box-none"
        >
          <View
            style={styles.tooltipCard}
            onLayout={(e) => setTooltipHeight(e.nativeEvent.layout.height)}
          >
            <Text style={styles.stepCount}>
              Step {(displayedText?.stepIndex ?? displayStepIndex) + 1} of {steps.length}
            </Text>
            <Text style={styles.tooltipTitle}>{displayedText?.title ?? displayStep.title}</Text>
            <Text style={styles.tooltipDesc}>{displayedText?.description ?? displayStep.description}</Text>
            {__DEV__ && (
              // Temporary calibration readout -- remove once the spotlight
              // offset is confirmed correct across devices. Screenshot this
              // to report exact numbers instead of eyeballing pixel gaps.
              <Text style={styles.debugText} selectable>
                step={displayStep.key} rect.x={Math.round(displayRect?.x ?? -1)} rect.y={Math.round(displayRect?.y ?? -1)}{"\n"}
                rect.w={Math.round(displayRect?.width ?? -1)} rect.h={Math.round(displayRect?.height ?? -1)}{"\n"}
                spot.x={Math.round(spot.x)} spot.y={Math.round(spot.y)} spot.w={Math.round(spot.width)}{"\n"}
                insets.top={Math.round(insets.top)} insets.bottom={Math.round(insets.bottom)} screenH={Math.round(screenHeight)}{"\n"}
                containerH={containerHeight != null ? Math.round(containerHeight) : -1}
              </Text>
            )}
            <View style={styles.tooltipActions}>
              <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
                <Text style={styles.skipText}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.nextBtn}
                activeOpacity={0.8}
                onPress={() => (isLast ? onClose() : setStepIndex((i) => i + 1))}
              >
                <Text style={styles.nextBtnText}>{isLast ? "Got it" : "Next"}</Text>
                {!isLast && <ArrowRight size={14} color={colors.white} style={{ marginLeft: 6 }} />}
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Forces this above elevated siblings (e.g. BottomNav's shadow.raised,
  // elevation: 6) on Android, where some OEM ROMs let a high-elevation
  // view poke through an open Modal's content instead of staying behind it.
  overlayRoot: { elevation: 999, zIndex: 999 },
  dim: { position: "absolute", backgroundColor: colors.overlay },
  spotlightBorder: {
    position: "absolute",
    borderRadius: radius.lg - 2,
    borderWidth: 2,
    borderColor: colors.emeraldBright,
  },
  tooltip: { position: "absolute", left: 16, right: 16 },
  tooltipCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg - 2,
    padding: spacing.md,
    borderWidth: 0.5,
    borderColor: colors.emeraldSoft,
  },
  stepCount: {
    fontSize: fontSize.xs - 1,
    fontFamily: fontFamily.bold,
    color: colors.emeraldBright,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  tooltipTitle: { fontSize: fontSize.sm, fontFamily: fontFamily.bold, color: colors.ink, marginBottom: 3 },
  tooltipDesc: { fontSize: fontSize.xs + 1, color: colors.textSecondary, fontFamily: fontFamily.regular, lineHeight: 16 },
  debugText: { fontSize: 10, color: "#D22", fontFamily: "monospace", marginTop: 6, lineHeight: 13 },
  tooltipActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm + 2,
  },
  skipText: { fontSize: fontSize.xs + 1, fontFamily: fontFamily.semibold, color: colors.textSecondary },
  nextBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.emerald,
    borderRadius: radius.sm,
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
  },
  nextBtnText: { fontSize: fontSize.xs + 1, fontFamily: fontFamily.bold, color: colors.white },
});
