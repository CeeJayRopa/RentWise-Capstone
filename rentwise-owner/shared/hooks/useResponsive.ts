import { useWindowDimensions } from "react-native";

// Screens here are designed phone-first with fixed spacing/font tokens —
// rather than rebuilding every layout with tablet-specific columns, the app
// root (see app/_layout.tsx) letterboxes the whole navigator to this width
// on wider screens, so content just reads like a phone app centered on a
// tablet instead of stretching into unreadably-wide rows.
export const TABLET_BREAKPOINT = 768;
export const MAX_CONTENT_WIDTH = 520;

export function useResponsive() {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= TABLET_BREAKPOINT;
  return { width, height, isTablet };
}
