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
}

export function normalizeStallName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export const MARKET_LAYOUT: StallHotspot[] = [
  // Diagonal row, B-19 (lower-left) through B-11 (upper-right). B-19/B-18/B-17 are close
  // enough to axis-aligned to leave unrotated; B-16 onward are visibly tilted parallelograms
  // in the source image, so those get a measured rotationDeg.
  { name: "B2 Stall B-19", xPct: 12.88, yPct: 27.38, widthPct: 3.98, heightPct: 6.99 },

  { name: "B2 Stall B-18", xPct: 17.10, yPct: 27.00, widthPct: 1.30, heightPct: 8.10, rotationDeg: -5.0 },
  { name: "B2 Stall B-18", xPct: 18.23, yPct: 26.19, widthPct: 3.45, heightPct: 8.58, rotationDeg: -5.0 },

  { name: "B2 Stall B-17", xPct: 21.88, yPct: 25.60, widthPct: 0.8, heightPct: 8.90, rotationDeg: -8.0 },
  { name: "B2 Stall B-17", xPct: 22.48, yPct: 25.0, widthPct: 3.17, heightPct: 8.95, rotationDeg: -10.0 },

  { name: "B2 Stall B-16", xPct: 26.0, yPct: 23.0, widthPct: 2.73, heightPct: 9.62, rotationDeg: -25.3 },
  { name: "B2 Stall B-16", xPct: 26.0, yPct: 25.90, widthPct: 0.50, heightPct: 7.50, rotationDeg: -25.50 },
  { name: "B2 Stall B-16", xPct: 26.0, yPct: 28.90, widthPct: 0.50, heightPct: 4.70, rotationDeg: -25.50 },

  { name: "B2 Stall B-15", xPct: 28.75, yPct: 20.69, widthPct: 2.25, heightPct: 8.7, rotationDeg: -38.6 },
  { name: "B2 Stall B-15", xPct: 28.85, yPct: 22.29, widthPct: 0.53, heightPct: 8.7, rotationDeg: -35.6 },
  { name: "B2 Stall B-15", xPct: 28.65, yPct: 22.29, widthPct: 0.43, heightPct: 8.7, rotationDeg: -27.6 },

  { name: "B2 Stall B-14", xPct: 30.61, yPct: 17.56, widthPct: 2.52, heightPct: 8.0, rotationDeg: -43.4 },
  { name: "B2 Stall B-14", xPct: 30.35, yPct: 19, widthPct: 0.80, heightPct: 8.5, rotationDeg: -43.4 },
  
  { name: "B2 Stall B-13", xPct: 32.85, yPct: 14.5, widthPct: 2.92, heightPct: 7.69, rotationDeg: -45.2 },
  { name: "B2 Stall B-13", xPct: 32.85, yPct: 16.3, widthPct: 0.65, heightPct: 7.69, rotationDeg: -45.2 },

  { name: "B2 Stall B-12", xPct: 34.40, yPct: 11.60, widthPct: 3.40, heightPct: 7.23, rotationDeg: -45.9 },
  { name: "B2 Stall B-11", xPct: 36.46, yPct: 8.25, widthPct: 3.9, heightPct: 7.0, rotationDeg: -45.7 },

  // Row of 10, B-10 (left) through B-01 (right)
  { name: "B2 Stall B-10", xPct: 35.13, yPct: 31.55, widthPct: 3.13, heightPct: 8.48 },
  { name: "B2 Stall B-09", xPct: 38.73, yPct: 31.55, widthPct: 3.5, heightPct: 8.48 },
  { name: "B2 Stall B-08", xPct: 42.61, yPct: 31.55, widthPct: 3.79, heightPct: 8.48 },
  { name: "B2 Stall B-07", xPct: 46.78, yPct: 31.55, widthPct: 5.02, heightPct: 8.48 },
  { name: "B2 Stall B-06", xPct: 52.27, yPct: 31.55, widthPct: 4.07, heightPct: 8.48 },
  { name: "B2 Stall B-05", xPct: 56.72, yPct: 31.55, widthPct: 5.21, heightPct: 8.48 },
  { name: "B2 Stall B-04", xPct: 62.41, yPct: 31.55, widthPct: 5.49, heightPct: 8.48 },
  { name: "B2 Stall B-03", xPct: 68.28, yPct: 31.55, widthPct: 4.07, heightPct: 8.48 },
  { name: "B2 Stall B-02", xPct: 72.82, yPct: 31.55, widthPct: 3.69, heightPct: 8.48 },
  { name: "B2 Stall B-01", xPct: 76.89, yPct: 31.55, widthPct: 3.88, heightPct: 8.48 },

  // Row of 5, A-10 (left) through A-06 (right)
  { name: "B1 Stall A-10", xPct: 35.13, yPct: 48.07, widthPct: 3.31, heightPct: 7.14 },
  { name: "B1 Stall A-09", xPct: 38.92, yPct: 48.07, widthPct: 3.13, heightPct: 7.14 },
  { name: "B1 Stall A-08", xPct: 42.52, yPct: 48.07, widthPct: 4.36, heightPct: 7.14 },
  { name: "B1 Stall A-07", xPct: 47.35, yPct: 48.07, widthPct: 3.88, heightPct: 7.14 },
  { name: "B1 Stall A-06", xPct: 51.7, yPct: 48.07, widthPct: 2.65, heightPct: 7.14 },

  // Row of 5, A-05..A-03 (narrower) then A-02, A-01 (wider)
  { name: "B1 Stall A-05", xPct: 57.39, yPct: 48.07, widthPct: 3.03, heightPct: 7.14 },
  { name: "B1 Stall A-04", xPct: 60.8, yPct: 48.07, widthPct: 3.5, heightPct: 7.14 },
  { name: "B1 Stall A-03", xPct: 64.77, yPct: 48.07, widthPct: 3.6, heightPct: 7.14 },
  { name: "B1 Stall A-02", xPct: 68.85, yPct: 48.07, widthPct: 5.78, heightPct: 7.14 },
  { name: "B1 Stall A-01", xPct: 75.09, yPct: 48.07, widthPct: 5.68, heightPct: 7.14 },

  // Vertical column, B-20 (top) through B-26 (bottom)
  { name: "B2 Stall B-20", xPct: 12.88, yPct: 43.3, widthPct: 5.02, heightPct: 4.76 },
  { name: "B2 Stall B-21", xPct: 12.88, yPct: 48.81, widthPct: 5.02, heightPct: 5.95 },
  { name: "B2 Stall B-22", xPct: 12.88, yPct: 55.36, widthPct: 5.02, heightPct: 4.46 },
  { name: "B2 Stall B-23", xPct: 12.88, yPct: 60.42, widthPct: 5.02, heightPct: 5.21 },
  { name: "B2 Stall B-24", xPct: 12.88, yPct: 66.22, widthPct: 5.02, heightPct: 4.32 },
  { name: "B2 Stall B-25", xPct: 12.88, yPct: 71.28, widthPct: 5.02, heightPct: 3.87 },
  { name: "B2 Stall B-26", xPct: 12.88, yPct: 75.89, widthPct: 5.02, heightPct: 4.17 },

  // B-27, B-28 side by side
  { name: "B2 Stall B-27", xPct: 18.37, yPct: 71.13, widthPct: 2.84, heightPct: 8.93 },
  { name: "B2 Stall B-28", xPct: 21.59, yPct: 71.13, widthPct: 2.65, heightPct: 8.93 },

  // B-29, B-30 stacked
  { name: "B2 Stall B-29", xPct: 28.41, yPct: 71.13, widthPct: 4.64, heightPct: 4.32 },
  { name: "B2 Stall B-30", xPct: 28.41, yPct: 76.04, widthPct: 4.64, heightPct: 4.02 },
];
