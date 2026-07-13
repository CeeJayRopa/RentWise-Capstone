import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../theme";

interface StatCardProps {
  label: string;
  value: string;
  icon?: React.ReactNode;
  tone?: "emerald" | "gold" | "neutral";
}

export function StatCard({ label, value, icon, tone = "neutral" }: StatCardProps) {
  return (
    <View style={[styles.wrap, shadow.card]}>
      {icon && (
        <View style={[styles.iconWrap, tone === "emerald" && styles.iconEmerald, tone === "gold" && styles.iconGold]}>
          {icon}
        </View>
      )}
      <Text style={styles.value} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.mist,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  iconEmerald: { backgroundColor: colors.emeraldSoft },
  iconGold: { backgroundColor: colors.goldSoft },
  value: {
    fontFamily: fontFamily.extrabold,
    fontSize: fontSize.xl,
    color: colors.textPrimary,
  },
  label: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
