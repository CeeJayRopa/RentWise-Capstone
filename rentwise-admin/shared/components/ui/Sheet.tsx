import { X } from "lucide-react-native";
import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../theme";

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  position?: "center" | "bottom";
}

export function Sheet({ visible, onClose, title, children, position = "center" }: SheetProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.card,
            shadow.raised,
            position === "bottom" ? styles.bottom : styles.center,
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          {!!title && (
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              <Pressable onPress={onClose} hitSlop={10}>
                <X size={20} color={colors.textSecondary} />
              </Pressable>
            </View>
          )}
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    backgroundColor: colors.white,
    padding: spacing.xl,
    width: "88%",
    maxWidth: 420,
  },
  center: {
    borderRadius: radius.xl,
  },
  bottom: {
    position: "absolute",
    bottom: 0,
    width: "100%",
    maxWidth: undefined,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: colors.textPrimary,
  },
});
