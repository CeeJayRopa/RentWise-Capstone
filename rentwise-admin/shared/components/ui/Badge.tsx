import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, fontFamily, fontSize, radius, spacing } from "../../theme";

type Tone = "success" | "warning" | "error" | "neutral" | "gold";

interface BadgeProps {
  label: string;
  tone?: Tone;
}

const toneStyles: Record<Tone, { bg: string; fg: string }> = {
  success: { bg: colors.successSoft, fg: colors.emerald },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  error: { bg: colors.errorSoft, fg: colors.error },
  neutral: { bg: colors.mist, fg: colors.textSecondary },
  gold: { bg: colors.goldSoft, fg: "#8A6D14" },
};

export function Badge({ label, tone = "neutral" }: BadgeProps) {
  const t = toneStyles[tone];
  return (
    <View style={[styles.wrap, { backgroundColor: t.bg }]}>
      <Text style={[styles.label, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
  },
  label: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.xs,
  },
});
