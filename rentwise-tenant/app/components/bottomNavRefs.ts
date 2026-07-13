import { createRef } from "react";
import type { View } from "react-native";

// Stable, module-level refs to the persistent bottom tab bar's individual
// buttons (BottomNavBar.tsx attaches these on mount) — since the bar now
// lives in the (tabs) layout rather than being rendered per-page, a
// dashboard HelpTour can't create these refs itself; it points its nav-tab
// tour steps at this shared registry instead.
export const bottomNavRefs = {
  home: createRef<View>(),
  payments: createRef<View>(),
  profile: createRef<View>(),
};
