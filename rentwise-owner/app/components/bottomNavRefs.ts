import { createRef } from "react";
import type { View } from "react-native";

// Stable, module-level refs to the persistent bottom tab bar's individual
// buttons (BottomNav.tsx attaches these on mount) — since the bar now lives
// in the (tabs) layout rather than being rendered per-page, dashboard.tsx's
// HelpTour can't create these refs itself anymore; it points its nav-tab
// tour steps at this shared registry instead.
export const bottomNavRefs = {
  financials: createRef<View>(),
  building: createRef<View>(),
  admins: createRef<View>(),
  archives: createRef<View>(),
  reports: createRef<View>(),
};
