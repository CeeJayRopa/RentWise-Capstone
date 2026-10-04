import { createRef } from "react";
import type { View } from "react-native";

export const bottomNavRefs = {
  financials: createRef<View>(),
  building: createRef<View>(),
  tenants: createRef<View>(),
  archives: createRef<View>(),
  reports: createRef<View>(),
};
