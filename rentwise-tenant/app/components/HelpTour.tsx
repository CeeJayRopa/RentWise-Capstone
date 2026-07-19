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
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

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

  const spot: Rect = rect
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
          rect.y - PADDING + insets.top + EDGE_MARGIN +
          (step.nudgeY ?? 0) +
          screenHeight * (step.nudgeYPercent ?? 0);
        // When endRef is set and measured, the box's bottom tracks that
        // element's real position instead of rect's own height -- correct
        // regardless of screen size or how much taller the content grows.
        const rawHeight = Math.max(
          0,
          (endRect ? Math.max(0, endRect.y + endRect.height - rect.y) + PADDING * 2 : rect.height + PADDING * 2) -
            (step.heightTrim ?? 0) -
            rect.height * (step.heightTrimPercent ?? 0),
        );
        const maxHeight = step.clipBottom != null ? screenHeight - step.clipBottom - y : rawHeight;
        const insetX = rect.width * (step.insetXPercent ?? 0);
        return {
          x: rect.x - PADDING + insetX,
          y,
          width: Math.max(0, rect.width + PADDING * 2 - insetX * 2),
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
  const showBelow = !rect || spaceBelow > measuredTooltipHeight + 14;
  const idealTooltipTop = rect
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
      <View style={[StyleSheet.absoluteFill, styles.overlayRoot]}>
        {rect ? (
          <>
            <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
              <Defs>
                <Mask id="spotlightMask">
                  <SvgRect x="0" y="0" width="100%" height="100%" fill="#fff" />
                  {step.round ? (
                    <SvgCircle
                      cx={spot.x + spot.width / 2}
                      cy={spot.y + spot.height / 2}
                      r={spot.width / 2}
                      fill="#000"
                    />
                  ) : (
                    <SvgRect
                      x={spot.x}
                      y={spot.y}
                      width={spot.width}
                      height={spot.height}
                      rx={radius.lg - 2}
                      fill="#000"
                    />
                  )}
                </Mask>
              </Defs>
              <SvgRect
                x="0"
                y="0"
                width="100%"
                height="100%"
                fill={colors.overlay}
                mask="url(#spotlightMask)"
              />
            </Svg>
            <View
              pointerEvents="none"
              style={[
                styles.spotlightBorder,
                {
                  top: spot.y,
                  left: spot.x,
                  width: spot.width,
                  height: spot.height,
                  borderRadius: step.round ? spot.width / 2 : radius.lg - 2,
                },
              ]}
            />
          </>
        ) : (
          <View style={[styles.dim, StyleSheet.absoluteFill]} />
        )}

        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />

        <View style={[styles.tooltip, { top: tooltipTop }]} pointerEvents="box-none">
          <View
            style={styles.tooltipCard}
            onLayout={(e) => setTooltipHeight(e.nativeEvent.layout.height)}
          >
            <Text style={styles.stepCount}>
              Step {stepIndex + 1} of {steps.length}
            </Text>
            <Text style={styles.tooltipTitle}>{step.title}</Text>
            <Text style={styles.tooltipDesc}>{step.description}</Text>
            {__DEV__ && (
              // Temporary calibration readout -- remove once the spotlight
              // offset is confirmed correct across devices. Screenshot this
              // to report exact numbers instead of eyeballing pixel gaps.
              <Text style={styles.debugText} selectable>
                rect.y={Math.round(rect?.y ?? -1)} rect.h={Math.round(rect?.height ?? -1)}{"\n"}
                insets.top={Math.round(insets.top)} insets.bottom={Math.round(insets.bottom)}{"\n"}
                spot.y={Math.round(spot.y)} screenH={Math.round(screenHeight)}
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
        </View>
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
