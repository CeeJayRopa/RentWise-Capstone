import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, fontFamily, fontSize } from "../../theme";

interface AvatarProps {
  name?: string;
  size?: number;
  icon?: React.ReactNode;
}

export function Avatar({ name, size = 48, icon }: AvatarProps) {
  const initials = name
    ? name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((n) => n[0]?.toUpperCase())
        .join("")
    : "";

  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      {icon ?? (
        <Text style={[styles.initials, { fontSize: size * 0.36 }]}>{initials}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    backgroundColor: colors.emeraldSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    fontFamily: fontFamily.bold,
    color: colors.emerald,
  },
});
