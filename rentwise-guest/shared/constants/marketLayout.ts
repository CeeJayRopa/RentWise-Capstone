// Static floor-plan hotspot layout for the "2D Market View" screen
// (app/market-map.tsx), measured against assets/market-2Dlayout.png
// (1056x672). Coordinates are percentages of the image's width/height, so
// they stay correct at any render size as long as the image keeps its
// original aspect ratio.
//
// These were measured programmatically (connected-component analysis of the
// actual pixel data — finding each box's real bounding rectangle, not eyeballed)
// so they should land right on top of each stall's real outline, including the
// rotated diagonal row.
//
// `name` must match (case/whitespace-insensitively — see normalizeStallName)
// the `name` field on each stall's Firestore document, since that's how a
// hotspot here gets matched up with its live status/price/etc.

export interface StallHotspot {
  name: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  // Degrees to rotate the hotspot around its own center, for the handful of stalls drawn
  // as tilted parallelograms rather than axis-aligned boxes (see the diagonal row below —
  // angle was measured via PCA on each stall's actual pixel footprint, not guessed).
  rotationDeg?: number;
  // Which side of the stall the hover tooltip opens on. Defaults to "top" —
  // only needs overriding for stalls that sit right at the top edge of the
  // blueprint (the diagonal row below), where a tooltip opening upward would
  // have nowhere to go.
  tooltipPlacement?: "top" | "bottom";
}

export function normalizeStallName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// ── Global calibration correction ───────────────────────────────────────────
// The hotspot percentages below were measured against one specific version of
// assets/market-2Dlayout.png. Whenever that image gets redrawn/replaced with
// a new one that shifts the floor plan by roughly the same amount for every
// stall, re-measuring all ~40 boxes by hand isn't necessary -- one shared
// correction, applied to every hotspot at once, does it.
//
// HOW TO TUNE THIS YOURSELF:
// 1. Open the 2D map, tap a stall whose highlight box is clearly off from
//    the real stall outline in the image.
// 2. Box sits too far RIGHT of the real stall -> DECREASE
//    HOTSPOT_OFFSET_X_PCT (negative moves it left). Too far LEFT -> increase it.
// 3. Box sits too far DOWN -> DECREASE HOTSPOT_OFFSET_Y_PCT. Too far UP ->
//    increase it.
// 4. Box is roughly the right position but the wrong SIZE (bigger/smaller
//    than the real stall) -> adjust HOTSPOT_SCALE_X / HOTSPOT_SCALE_Y
//    instead. Above 1 grows every box, below 1 shrinks every box.
// 5. Save, reload, check a stall on the OPPOSITE side of the map too --
//    this correction applies to every stall identically, so if one side
//    lines up but the far side doesn't, the fix needed is here (try a
//    slightly different number), not a per-stall edit below.
//
// Small nudges go a long way: these are percentages of the whole image's
// width/height, same units as xPct/yPct/widthPct/heightPct on each hotspot,
// so even 1-2 is a real, visible shift.
export const HOTSPOT_OFFSET_X_PCT = 0;
export const HOTSPOT_OFFSET_Y_PCT = 0;
export const HOTSPOT_SCALE_X = 1;
export const HOTSPOT_SCALE_Y = 1;

// Both app/market-map.tsx and shared/components/MarketMapEmbed.tsx call this
// instead of reading a hotspot's raw xPct/yPct/widthPct/heightPct directly,
// so the correction above only has to be applied in one place and both
// screens always stay in sync with each other.
export function getCorrectedHotspot(hotspot: StallHotspot): StallHotspot {
  return {
    ...hotspot,
    xPct: hotspot.xPct * HOTSPOT_SCALE_X + HOTSPOT_OFFSET_X_PCT,
    yPct: hotspot.yPct * HOTSPOT_SCALE_Y + HOTSPOT_OFFSET_Y_PCT,
    widthPct: hotspot.widthPct * HOTSPOT_SCALE_X,
    heightPct: hotspot.heightPct * HOTSPOT_SCALE_Y,
  };
}

export const MARKET_LAYOUT: StallHotspot[] = [
  // Diagonal row, B-19 (lower-left) through B-11 (upper-right). B-19/B-18/B-17 are close
  // enough to axis-aligned to leave unrotated; B-16 onward are visibly tilted parallelograms
  // in the source image, so those get a measured rotationDeg.
  { name: "B2 Stall B-19", xPct: 12.88, yPct: 22.9, widthPct: 3.28, heightPct: 7.45, tooltipPlacement: "bottom" },
  { name: "B2 Stall B-18", xPct: 16.47, yPct: 22.9, widthPct: 3.28, heightPct: 7.45, tooltipPlacement: "bottom" },
  { name: "B2 Stall B-17", xPct: 19.95, yPct: 22.5, widthPct: 3.38, heightPct: 7.85, rotationDeg: -5.0, tooltipPlacement: "bottom" },
  { name: "B2 Stall B-16", xPct: 23.50, yPct: 21.5, widthPct: 3.48, heightPct: 8.35, rotationDeg: -9.5, tooltipPlacement: "bottom" },
  { name: "B2 Stall B-15", xPct: 27.05, yPct: 20.69, widthPct: 3.58, heightPct: 8.35, rotationDeg: -13.6, tooltipPlacement: "bottom" },
  { name: "B2 Stall B-14", xPct: 30.51, yPct: 19.26, widthPct: 3.58, heightPct: 8.35, rotationDeg: -17.4, tooltipPlacement: "bottom" },
  { name: "B2 Stall B-13", xPct: 33.95, yPct: 17.45, widthPct: 3.68, heightPct: 8.35, rotationDeg: -21.4, tooltipPlacement: "bottom" },
  { name: "B2 Stall B-12", xPct: 37.20, yPct: 15, widthPct: 3.58, heightPct: 8.49, rotationDeg: -24.9, tooltipPlacement: "bottom" },
  { name: "B2 Stall B-11", xPct: 40.40, yPct: 13.10, widthPct: 3.58, heightPct: 8.45, rotationDeg: -24.9, tooltipPlacement: "bottom" },

  // Row of 10, B-10 (left) through B-01 (right)
  { name: "B2 Stall B-10", xPct: 35.13, yPct: 31.55, widthPct: 3.53, heightPct: 8.48 },
  { name: "B2 Stall B-09", xPct: 38.73, yPct: 31.55, widthPct: 3.8, heightPct: 8.48 },
  { name: "B2 Stall B-08", xPct: 42.61, yPct: 31.55, widthPct: 4.19, heightPct: 8.48 },
  { name: "B2 Stall B-07", xPct: 46.78, yPct: 31.55, widthPct: 5.52, heightPct: 8.48 },
  { name: "B2 Stall B-06", xPct: 52.27, yPct: 31.55, widthPct: 4.57, heightPct: 8.48 },
  { name: "B2 Stall B-05", xPct: 56.72, yPct: 31.55, widthPct: 5.61, heightPct: 8.48 },
  { name: "B2 Stall B-04", xPct: 62.41, yPct: 31.55, widthPct: 5.89, heightPct: 8.48 },
  { name: "B2 Stall B-03", xPct: 68.28, yPct: 31.55, widthPct: 4.57, heightPct: 8.48 },
  { name: "B2 Stall B-02", xPct: 72.82, yPct: 31.55, widthPct: 4.17, heightPct: 8.48 },
  { name: "B2 Stall B-01", xPct: 76.89, yPct: 31.55, widthPct: 4.98, heightPct: 8.48 },

  // Row of 5, A-10 (left) through A-06 (right)
  { name: "B1 Stall A-10", xPct: 35.13, yPct: 46.07, widthPct: 3.63, heightPct: 7.14 },
  { name: "B1 Stall A-09", xPct: 38.92, yPct: 46.07, widthPct: 3.43, heightPct: 7.14 },
  { name: "B1 Stall A-08", xPct: 42.52, yPct: 46.07, widthPct: 4.66, heightPct: 7.14 },
  { name: "B1 Stall A-07", xPct: 47.35, yPct: 46.07, widthPct: 4.28, heightPct: 7.14 },
  { name: "B1 Stall A-06", xPct: 51.7, yPct: 46.07, widthPct: 3.21, heightPct: 7.14 },

  // Row of 5, A-05..A-03 (narrower) then A-02, A-01 (wider)
  { name: "B1 Stall A-05", xPct: 57.42, yPct: 46.07, widthPct: 3.43, heightPct: 7.42 },
  { name: "B1 Stall A-04", xPct: 60.8, yPct: 46.07, widthPct: 3.99, heightPct: 7.50 },
  { name: "B1 Stall A-03", xPct: 64.77, yPct: 46.07, widthPct: 3.99, heightPct: 7.50 },
  { name: "B1 Stall A-02", xPct: 68.85, yPct: 46.07, widthPct: 6.15, heightPct: 7.50 },
  { name: "B1 Stall A-01", xPct: 75.09, yPct: 46.07, widthPct: 6.18, heightPct: 7.50 },

  // Vertical column, B-20 (top) through B-26 (bottom)
  { name: "B2 Stall B-20", xPct: 9.78, yPct: 41.1, widthPct: 5.02, heightPct: 5.56 },
  { name: "B2 Stall B-21", xPct: 9.78, yPct: 46.61, widthPct: 5.02, heightPct: 5.95 },
  { name: "B2 Stall B-22", xPct: 9.78, yPct: 53, widthPct: 5.02, heightPct: 4.46 },
  { name: "B2 Stall B-23", xPct: 9.78, yPct: 57.87, widthPct: 5.02, heightPct: 5.21 },
  { name: "B2 Stall B-24", xPct: 9.78, yPct: 63.32, widthPct: 5.02, heightPct: 4.32 },
  { name: "B2 Stall B-25", xPct: 9.78, yPct: 68, widthPct: 5.02, heightPct: 4.27 },
  { name: "B2 Stall B-26", xPct: 9.78, yPct: 72.39, widthPct: 5.02, heightPct: 4.37 },

  // B-27, B-28 side by side
  { name: "B2 Stall B-27", xPct: 14.8, yPct: 72.39, widthPct: 5.04, heightPct: 4.37 },
  { name: "B2 Stall B-28", xPct: 19.69, yPct: 72.39, widthPct: 5.04, heightPct: 4.37 },

  // B-29, B-30 stacked
  { name: "B2 Stall B-29", xPct: 28.41, yPct: 67.93, widthPct: 5.14, heightPct: 4.32 },
  { name: "B2 Stall B-30", xPct: 28.41, yPct: 72.64, widthPct: 5.14, heightPct: 4.02 },
];
