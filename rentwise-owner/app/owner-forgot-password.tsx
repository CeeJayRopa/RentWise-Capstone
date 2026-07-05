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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getFunctions, httpsCallable } from "firebase/functions";

import { firebaseApp } from "../shared/firebaseConfig";
import { loginUser } from "../shared/services/auth";

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
      style={{ flex: 1, backgroundColor: "#0C2D6B" }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onLayout={(e) => { scrollViewHeightRef.current = e.nativeEvent.layout.height; }}
      >
        <View style={[styles.topSection, { paddingTop: insets.top + 24 }]}>
          <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
          </Pressable>
          <View style={styles.logoCircle}>
            <Ionicons name="key-outline" size={28} color="#0C2D6B" />
          </View>
          <Text style={styles.appName}>Recover Password</Text>
          <Text style={styles.portalText}>Owner portal</Text>
        </View>

        <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, 24) }]}>
          {step === "loading" && (
            <View style={{ paddingVertical: 40, alignItems: "center" }}>
              <ActivityIndicator color="#0C2D6B" size="large" />
            </View>
          )}

          {step === "unavailable" && (
            <>
              <Text style={styles.heading}>Not available</Text>
              <Text style={styles.subheading}>
                No security questions have been set up yet. Set them up under My Account, under Change Password.
              </Text>
              <Pressable
                style={({ pressed }) => [styles.signInBtn, { marginTop: 24 }, pressed && { backgroundColor: "#091f4a" }]}
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
                <View key={i} style={{ marginTop: 18 }}>
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
                    placeholderTextColor="#B4B2A9"
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
                <Ionicons name="checkmark-circle" size={40} color="#1D9E75" />
              </View>
              <Text style={styles.heading}>Verified!</Text>
              <Text style={styles.subheading}>Here is your current password.</Text>
              <View style={[styles.inputWrapper, { marginTop: 20 }]}>
                <Ionicons name="lock-closed-outline" size={17} color="#2E6FD9" style={styles.leftIcon} />
                <TextInput
                  style={[styles.textInput, { paddingLeft: 40, paddingRight: 40 }]}
                  value={revealedPassword}
                  editable={false}
                  secureTextEntry={!showPassword}
                />
                <Pressable style={styles.rightIcon} onPress={() => setShowPassword((v) => !v)}>
                  <Ionicons name={showPassword ? "eye-outline" : "eye-off-outline"} size={17} color="#B4B2A9" />
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
      <Ionicons name="alert-circle-outline" size={16} color="#A32D2D" style={{ marginRight: 8 }} />
      <Text style={styles.errorText}>{text}</Text>
    </View>
  );
}

function SubmitButton({ label, loading, onPress }: { label: string; loading: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.signInBtn,
        { marginTop: 24 },
        loading && styles.signInBtnDisabled,
        pressed && !loading && { backgroundColor: "#091f4a", transform: [{ scale: 0.98 }] },
      ]}
      onPress={onPress}
      disabled={loading}
    >
      {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.signInText}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topSection: {
    backgroundColor: "#0C2D6B",
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    alignItems: "center",
    paddingBottom: 32,
  },
  backBtn: {
    position: "absolute",
    left: 16,
    top: 0,
    padding: 8,
  },
  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#E6F1FB",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  appName: { color: "#FFFFFF", fontSize: 22, fontWeight: "500" },
  portalText: { color: "#B5D4F4", fontSize: 13, marginTop: 4 },

  card: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -16,
    paddingHorizontal: 28,
    paddingTop: 28,
  },

  heading: { fontSize: 22, fontWeight: "500", color: "#0C2D6B" },
  subheading: { fontSize: 14, color: "#888780", marginTop: 2 },

  successIconCircle: { alignItems: "center", marginBottom: 12 },

  fieldLabel: { fontSize: 13, fontWeight: "500", color: "#1A4DA0", marginBottom: 6 },

  inputWrapper: { position: "relative", flexDirection: "row", alignItems: "center" },
  leftIcon: { position: "absolute", left: 13, zIndex: 1 },
  rightIcon: { position: "absolute", right: 13, zIndex: 1, padding: 2 },

  textInput: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#B5D4F4",
    backgroundColor: "#F0F4FA",
    paddingVertical: 13,
    paddingHorizontal: 14,
    color: "#0C2D6B",
    fontSize: 15,
  },

  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
    backgroundColor: "#FCEBEB",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  errorText: { fontSize: 13, color: "#A32D2D", flex: 1 },

  signInBtn: {
    width: "100%",
    borderRadius: 14,
    backgroundColor: "#0C2D6B",
    paddingVertical: 15,
    alignItems: "center",
  },
  signInBtnDisabled: { opacity: 0.5 },
  signInText: { color: "#FFFFFF", fontSize: 16, fontWeight: "500", textAlign: "center" },
});
