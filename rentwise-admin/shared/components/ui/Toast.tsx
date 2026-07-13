import { CheckCircle2, XCircle } from "lucide-react-native";
import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text } from "react-native";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../theme";

interface ToastProps {
  visible: boolean;
  message: string;
  tone?: "success" | "error";
}

export function Toast({ visible, message, tone = "success" }: ToastProps) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(anim, {
        toValue: visible ? 1 : 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, anim]);

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.box,
        shadow.raised,
        tone === "error" ? styles.error : styles.success,
        {
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [16, 0],
              }),
            },
          ],
        },
      ]}
    >
      {tone === "success" ? (
        <CheckCircle2 size={20} color={colors.white} />
      ) : (
        <XCircle size={20} color={colors.white} />
      )}
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: "absolute",
    bottom: spacing.xxxl,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    maxWidth: "88%",
  },
  success: { backgroundColor: colors.ink },
  error: { backgroundColor: colors.error },
  text: {
    color: colors.white,
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    flexShrink: 1,
  },
});
