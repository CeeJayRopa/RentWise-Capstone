import { Platform } from "react-native";
import { colors } from "./colors";

export const shadow = {
  card: Platform.select({
    ios: {
      shadowColor: colors.ink,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.08,
      shadowRadius: 16,
    },
    android: { elevation: 3 },
    default: {},
  }),
  raised: Platform.select({
    ios: {
      shadowColor: colors.ink,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.14,
      shadowRadius: 24,
    },
    android: { elevation: 6 },
    default: {},
  }),
  button: Platform.select({
    ios: {
      shadowColor: colors.emerald,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 10,
    },
    android: { elevation: 4 },
    default: {},
  }),
} as const;
