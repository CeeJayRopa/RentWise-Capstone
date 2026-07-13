import React from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import { colors, radius, shadow, spacing } from "../../theme";

interface CardProps {
  children: React.ReactNode;
  accent?: boolean;
  surface?: "white" | "mist";
  style?: ViewStyle;
  noPadding?: boolean;
}

export function Card({ children, accent = false, surface = "white", style, noPadding = false }: CardProps) {
  return (
    <View
      style={[
        styles.base,
        surface === "mist" ? styles.mist : styles.white,
        shadow.card,
        style,
      ]}
    >
      {accent && <View style={styles.accentBar} />}
      <View style={[styles.contentWrap, !noPadding && styles.padding]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
    flexDirection: "row",
    overflow: "hidden",
  },
  white: { backgroundColor: colors.white },
  mist: { backgroundColor: colors.mist },
  padding: { padding: spacing.lg },
  accentBar: {
    width: 4,
    backgroundColor: colors.emerald,
  },
  contentWrap: { flex: 1 },
});
