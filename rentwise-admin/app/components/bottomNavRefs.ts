import { createRef } from "react";
import type { View } from "react-native";

// Stable, module-level refs to the persistent bottom tab bar's individual
// buttons (BottomNav.tsx attaches these on mount) — since the bar now lives
// in the (tabs) layout rather than being rendered per-page, any future
// dashboard HelpTour can't create these refs itself; it would point its
// nav-tab tour steps at this shared registry instead.
export const bottomNavRefs = {
  financials: createRef<View>(),
  building: createRef<View>(),
  tenants: createRef<View>(),
  archives: createRef<View>(),
  reports: createRef<View>(),
};
