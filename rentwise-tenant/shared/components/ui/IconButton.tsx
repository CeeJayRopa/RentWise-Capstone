import React from "react";
import { Pressable, StyleSheet, View, ViewStyle } from "react-native";
import { colors, radius } from "../../theme";

interface IconButtonProps {
  children: React.ReactNode;
  onPress: () => void;
  variant?: "filled" | "ghost";
  size?: number;
  style?: ViewStyle;
}

export function IconButton({ children, onPress, variant = "ghost", size = 40, style }: IconButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.base,
        { width: size, height: size, borderRadius: radius.pill },
        variant === "filled" && styles.filled,
        pressed && styles.pressed,
        style,
      ]}
    >
      <View style={styles.content}>{children}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
  },
  filled: { backgroundColor: colors.mist },
  pressed: { opacity: 0.7 },
  content: { alignItems: "center", justifyContent: "center" },
});
