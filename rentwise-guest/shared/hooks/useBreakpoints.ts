import { useWindowDimensions } from "react-native";

// Single source of truth for the breakpoints used across the guest site
// (landing page, market subpages, etc.) so every screen agrees on where
// "mobile" ends and "tablet"/"desktop" begin.
export function useBreakpoints() {
  const { width, height } = useWindowDimensions();

  const isMobile = width <= 480;
  const isTablet = width > 480 && width <= 1024;
  const isDesktop = width > 1024;

  return { width, height, isMobile, isTablet, isDesktop };
}
