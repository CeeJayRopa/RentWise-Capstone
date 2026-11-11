import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ArrowLeft, ChevronDown, ChevronRight, CircleHelp, Route, X } from "lucide-react-native";
import {
  loadHelpLanguage,
  saveHelpLanguage,
  tagalogStepText,
  type HelpStep,
  type TourLanguage,
} from "./HelpTour";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";

type Props = { visible: boolean; steps: HelpStep[]; onClose: () => void; onReplayTour: () => void };

export default function HelpSupportModal({ visible, steps, onClose, onReplayTour }: Props) {
  const [view, setView] = useState<"menu" | "faq">("menu");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [language, setLanguage] = useState<TourLanguage>("en");
  const replayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) { setView("menu"); setExpandedKey(null); return; }
    loadHelpLanguage().then(setLanguage).catch(() => {});
  }, [visible]);
  useEffect(() => () => { if (replayTimerRef.current) clearTimeout(replayTimerRef.current); }, []);

  const replayTour = () => {
    onClose();
    replayTimerRef.current = setTimeout(() => { replayTimerRef.current = null; onReplayTour(); }, 250);
  };

  const changeLanguage = (value: TourLanguage) => {
    setLanguage(value);
    saveHelpLanguage(value).catch(() => {});
  };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={(event) => event.stopPropagation()}>
          <View style={styles.header}>
            {view === "faq" ? <TouchableOpacity style={styles.iconButton} onPress={() => setView("menu")} accessibilityLabel="Back to Help and Support"><ArrowLeft size={19} color={colors.ink} /></TouchableOpacity> : null}
            <View style={styles.headerText}>
              <Text style={styles.title}>{view === "faq" ? (language === "tl" ? "Common Questions" : "Frequently Asked Questions") : "Help & Support"}</Text>
              {view === "faq" ? null : <Text style={styles.subtitle}>How can we help you?</Text>}
            </View>
            <TouchableOpacity style={styles.iconButton} onPress={onClose} accessibilityLabel="Close Help and Support"><X size={19} color={colors.ink} /></TouchableOpacity>
          </View>
          {view === "menu" ? (
            <View style={styles.menuList}>
              <TouchableOpacity style={styles.menuItem} onPress={() => setView("faq")} activeOpacity={0.75}>
                <CircleHelp size={21} color={colors.ink} /><View style={styles.menuTextWrap}><Text style={styles.menuTitle}>Frequently Asked Questions</Text><Text style={styles.menuSubtitle}>Find answers to common questions.</Text></View><ChevronRight size={20} color={colors.ink} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuItem} onPress={replayTour} activeOpacity={0.75}>
                <Route size={21} color={colors.ink} /><View style={styles.menuTextWrap}><Text style={styles.menuTitle}>Replay Help Tour</Text><Text style={styles.menuSubtitle}>Review how to use this page.</Text></View><ChevronRight size={20} color={colors.ink} />
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.faqIntroRow}>
                <Text style={styles.subtitle}>{language === "tl" ? "Quick answers tungkol sa page na ito." : "Answers for this page."}</Text>
                <View style={styles.languageToggle}>
                  {(["en", "tl"] as TourLanguage[]).map((value) => (
                    <Pressable key={value} onPress={() => changeLanguage(value)} style={[styles.languageOption, language === value && styles.languageOptionActive]}>
                      <Text style={[styles.languageText, language === value && styles.languageTextActive]}>{value.toUpperCase()}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={styles.divider} />
              <ScrollView style={styles.faqScroll} contentContainerStyle={styles.faqList} showsVerticalScrollIndicator={false}>
              {steps.map((step) => { const expanded = expandedKey === step.key; const translated = language === "tl" ? tagalogStepText(step) : step; return (
                <TouchableOpacity key={step.key} style={styles.faqItem} onPress={() => setExpandedKey(expanded ? null : step.key)} activeOpacity={0.78}>
                  <View style={styles.faqQuestionRow}><Text style={styles.faqQuestion}>{language === "tl" ? `Paano gamitin ang ${translated.title}?` : `How does ${translated.title} work?`}</Text><ChevronDown size={18} color={colors.emerald} style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }} /></View>
                  {expanded ? <Text style={styles.faqAnswer}>{translated.description}</Text> : null}
                </TouchableOpacity>
              ); })}
              </ScrollView>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.lg, backgroundColor: "rgba(4, 25, 21, 0.64)" },
  modalCard: { maxHeight: "78%", padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.white, ...shadow.raised },
  header: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }, headerText: { flex: 1 },
  title: { fontSize: fontSize.lg, fontFamily: fontFamily.bold, color: colors.ink }, subtitle: { marginTop: 6, fontSize: fontSize.sm, fontFamily: fontFamily.regular, color: colors.textSecondary },
  iconButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 16 }, menuList: { marginTop: spacing.lg, gap: spacing.md },
  menuItem: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.white },
  menuTextWrap: { flex: 1 }, menuTitle: { fontSize: fontSize.base, fontFamily: fontFamily.bold, color: colors.ink }, menuSubtitle: { marginTop: 4, fontSize: fontSize.xs, fontFamily: fontFamily.regular, color: colors.textSecondary },
  faqIntroRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm },
  languageToggle: { flexDirection: "row", padding: 2, borderRadius: 14, backgroundColor: colors.parchment },
  languageOption: { minWidth: 34, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 12, alignItems: "center" },
  languageOptionActive: { backgroundColor: colors.emerald },
  languageText: { fontSize: fontSize.xs - 1, fontFamily: fontFamily.bold, color: colors.textSecondary },
  languageTextActive: { color: colors.white },
  divider: { height: 1, backgroundColor: colors.border, marginTop: spacing.md },
  faqScroll: { flexShrink: 1, marginTop: spacing.md }, faqList: { gap: spacing.sm, paddingBottom: spacing.xs }, faqItem: { padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.mist },
  faqQuestionRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm }, faqQuestion: { flex: 1, fontSize: fontSize.sm, lineHeight: 19, fontFamily: fontFamily.semibold, color: colors.ink }, faqAnswer: { marginTop: spacing.sm, fontSize: fontSize.xs, lineHeight: 18, fontFamily: fontFamily.regular, color: colors.textSecondary },
});
