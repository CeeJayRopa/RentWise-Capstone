import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  ScrollView,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ArrowLeft, KeyRound, Lock, Eye, EyeOff, AlertCircle, CheckCircle2 } from "lucide-react-native";
import { getFunctions, httpsCallable } from "firebase/functions";

import { firebaseApp } from "../shared/firebaseConfig";
import { loginUser } from "../shared/services/auth";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../shared/theme";

const cloudFunctions = getFunctions(firebaseApp);

type Step = "loading" | "answer" | "reveal" | "unavailable";

export default function OwnerForgotPassword() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>("loading");
  const [verifying, setVerifying] = useState(false);
  const [proceeding, setProceeding] = useState(false);
  const [error, setError] = useState("");

  const [ownerId, setOwnerId] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>(["", "", ""]);
  const [revealedEmail, setRevealedEmail] = useState("");
  const [revealedPassword, setRevealedPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const submitBtnRef = useRef<View>(null);
  const scrollViewHeightRef = useRef(0);

  // Same fixed-target scroll trick as login.tsx: always scroll so the
  // submit button (just below the last question) clears the keyboard,
  // regardless of which field triggered it — the 3rd question sits right
  // above that button, so this reveals it too.
  function scrollToRevealForm() {
    setTimeout(() => {
      const target = submitBtnRef.current;
      const scroller = scrollRef.current;
      if (!target || !scroller) return;
      target.measureLayout(
        scroller as unknown as React.ComponentRef<typeof View>,
        (_x: number, y: number, _w: number, h: number) => {
          const bottomPadding = 24;
          const desired = y + h + bottomPadding - scrollViewHeightRef.current;
          scroller.scrollTo({ y: Math.max(desired, 0), animated: true });
        },
        () => {},
      );
    }, 100);
  }

  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", scrollToRevealForm);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const getQuestionsFn = httpsCallable(cloudFunctions, "getOwnerSecurityQuestions");
        const result: any = await getQuestionsFn();
        setOwnerId(result.data.ownerId);
        setQuestions(result.data.questions);
        setStep("answer");
      } catch {
        setStep("unavailable");
      }
    })();
  }, []);

  async function handleVerify() {
    setError("");
    if (answers.some((a) => !a.trim())) {
      setError("Please answer all 3 questions.");
      return;
    }
    setVerifying(true);
    try {
      const verifyFn = httpsCallable(cloudFunctions, "verifyOwnerSecurityAnswers");
      const result: any = await verifyFn({ ownerId, answers });
      setRevealedPassword(result.data.password ?? "");
      setRevealedEmail(result.data.email ?? "");
      setStep("reveal");
    } catch {
      setError("One or more answers are incorrect.");
    } finally {
      setVerifying(false);
    }
  }

  async function handleProceed() {
    if (!revealedEmail || !revealedPassword) {
      router.replace("/login");
      return;
    }
    setProceeding(true);
    try {
      await loginUser(revealedEmail, revealedPassword);
      router.replace("/welcome");
    } catch {
      router.replace("/login");
    } finally {
      setProceeding(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.emerald }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onLayout={(e) => { scrollViewHeightRef.current = e.nativeEvent.layout.height; }}
      >
        <LinearGradient
          colors={[colors.emerald, colors.ink]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.topSection, { paddingTop: insets.top + 24 }]}
        >
          <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={12}>
            <ArrowLeft size={22} color={colors.white} />
          </Pressable>
          <View style={styles.logoCircle}>
            <KeyRound size={28} color={colors.emerald} />
          </View>
          <Text style={styles.appName}>Recover Password</Text>
          <Text style={styles.portalText}>Owner portal</Text>
        </LinearGradient>

        <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, 24) }]}>
          {step === "loading" && (
            <View style={{ paddingVertical: 40, alignItems: "center" }}>
              <ActivityIndicator color={colors.emerald} size="large" />
            </View>
          )}

          {step === "unavailable" && (
            <>
              <Text style={styles.heading}>Not available</Text>
              <Text style={styles.subheading}>
                No security questions have been set up yet. Set them up under My Account, under Change Password.
              </Text>
              <Pressable
                style={({ pressed }) => [styles.signInBtn, { marginTop: spacing.xxl }, pressed && { backgroundColor: colors.ink }]}
                onPress={() => router.replace("/login")}
              >
                <Text style={styles.signInText}>Back to Sign in</Text>
              </Pressable>
            </>
          )}

          {step === "answer" && (
            <>
              <Text style={styles.heading}>Answer your questions</Text>
              <Text style={styles.subheading}>Answer all 3 correctly to recover your password.</Text>
              {questions.map((q, i) => (
                <View key={i} style={{ marginTop: spacing.lg + 2 }}>
                  <Text style={styles.fieldLabel}>{q}</Text>
                  <TextInput
                    style={styles.textInput}
                    value={answers[i]}
                    onChangeText={(t) => {
                      setAnswers((prev) => {
                        const next = [...prev];
                        next[i] = t;
                        return next;
                      });
                      setError("");
                    }}
                    placeholder="Your answer"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    editable={!verifying}
                    onFocus={scrollToRevealForm}
                  />
                </View>
              ))}
              {!!error && <ErrorBanner text={error} />}
              <View ref={submitBtnRef}>
                <SubmitButton label="Verify Answers" loading={verifying} onPress={handleVerify} />
              </View>
            </>
          )}

          {step === "reveal" && (
            <>
              <View style={styles.successIconCircle}>
                <CheckCircle2 size={40} color={colors.emerald} />
              </View>
              <Text style={styles.heading}>Verified!</Text>
              <Text style={styles.subheading}>Here is your current password.</Text>
              <View style={[styles.inputWrapper, { marginTop: spacing.xl }]}>
                <Lock size={17} color={colors.emeraldBright} style={styles.leftIcon} />
                <TextInput
                  style={[styles.textInput, { paddingLeft: 40, paddingRight: 40 }]}
                  value={revealedPassword}
                  editable={false}
                  secureTextEntry={!showPassword}
                />
                <Pressable style={styles.rightIcon} onPress={() => setShowPassword((v) => !v)}>
                  {showPassword ? <Eye size={17} color={colors.textMuted} /> : <EyeOff size={17} color={colors.textMuted} />}
                </Pressable>
              </View>
              <SubmitButton label="Proceed" loading={proceeding} onPress={handleProceed} />
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ErrorBanner({ text }: { text: string }) {
  return (
    <View style={styles.errorBanner}>
      <AlertCircle size={16} color={colors.error} style={{ marginRight: 8 }} />
      <Text style={styles.errorText}>{text}</Text>
    </View>
  );
}

function SubmitButton({ label, loading, onPress }: { label: string; loading: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.signInBtn,
        { marginTop: spacing.xxl },
        loading && styles.signInBtnDisabled,
        pressed && !loading && { backgroundColor: colors.ink, transform: [{ scale: 0.98 }] },
      ]}
      onPress={onPress}
      disabled={loading}
    >
      {loading ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={styles.signInText}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topSection: {
    alignItems: "center",
    paddingBottom: 32,
  },
  backBtn: {
    position: "absolute",
    left: 16,
    top: 0,
    padding: spacing.sm,
  },
  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.parchment,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md + 2,
  },
  appName: { color: colors.white, fontSize: fontSize.xxl - 2, fontFamily: fontFamily.bold },
  portalText: { color: colors.emeraldSoft, fontSize: fontSize.sm, fontFamily: fontFamily.medium, marginTop: 4 },

  card: {
    flex: 1,
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    marginTop: -radius.xl,
    paddingHorizontal: spacing.xxl + 4,
    paddingTop: spacing.xxl + 4,
  },

  heading: { fontSize: fontSize.xl + 2, fontFamily: fontFamily.bold, color: colors.ink },
  subheading: { fontSize: fontSize.base, color: colors.textSecondary, fontFamily: fontFamily.regular, marginTop: 2 },

  successIconCircle: { alignItems: "center", marginBottom: spacing.md },

  fieldLabel: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.emerald, marginBottom: 6 },

  inputWrapper: { position: "relative", flexDirection: "row", alignItems: "center" },
  leftIcon: { position: "absolute", left: 13, zIndex: 1 },
  rightIcon: { position: "absolute", right: 13, zIndex: 1, padding: 2 },

  textInput: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.emeraldSoft,
    backgroundColor: colors.mist,
    paddingVertical: 13,
    paddingHorizontal: spacing.md + 2,
    color: colors.ink,
    fontFamily: fontFamily.medium,
    fontSize: fontSize.base,
  },

  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.lg,
    backgroundColor: colors.errorSoft,
    borderRadius: radius.sm - 2,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg - 2,
  },
  errorText: { fontSize: fontSize.sm, color: colors.error, fontFamily: fontFamily.medium, flex: 1 },

  signInBtn: {
    width: "100%",
    borderRadius: radius.md + 2,
    backgroundColor: colors.emerald,
    paddingVertical: 15,
    alignItems: "center",
    ...shadow.button,
  },
  signInBtnDisabled: { opacity: 0.5 },
  signInText: { color: colors.white, fontSize: fontSize.md, fontFamily: fontFamily.bold, textAlign: "center" },
});
