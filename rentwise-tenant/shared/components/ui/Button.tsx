import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../theme";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  disabled = false,
  loading = false,
  icon,
  fullWidth = true,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        size === "lg" ? styles.lg : styles.md,
        variantStyles[variant],
        fullWidth && styles.fullWidth,
        variant === "primary" && !isDisabled && shadow.button,
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === "primary" || variant === "danger" ? colors.white : colors.emerald}
        />
      ) : (
        <View style={styles.content}>
          {icon}
          <Text style={[styles.label, labelStyles[variant]]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  md: { paddingVertical: 13, paddingHorizontal: spacing.xl },
  lg: { paddingVertical: 16, paddingHorizontal: spacing.xxl },
  fullWidth: { width: "100%" },
  content: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  label: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.base,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.5 },
});

const variantStyles = StyleSheet.create({
  primary: { backgroundColor: colors.emerald },
  secondary: { backgroundColor: colors.mist, borderWidth: 1, borderColor: colors.border },
  ghost: { backgroundColor: "transparent" },
  danger: { backgroundColor: colors.error },
});

const labelStyles = StyleSheet.create({
  primary: { color: colors.white },
  secondary: { color: colors.ink },
  ghost: { color: colors.emerald },
  danger: { color: colors.white },
});
