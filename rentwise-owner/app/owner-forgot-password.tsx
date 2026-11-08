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
import { ArrowLeft, KeyRound, Lock, Eye, EyeOff, AlertCircle, Phone, ShieldCheck } from "lucide-react-native";
import { getFunctions, httpsCallable } from "firebase/functions";
import { confirmPasswordReset } from "firebase/auth";

import { firebaseApp } from "../shared/firebaseConfig";
import { auth } from "../shared/services/auth";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../shared/theme";

const cloudFunctions = getFunctions(firebaseApp);

// Owner's own password policy, matching owner-profile.tsx's handleChangePassword exactly —
// this is the same new-password form, just reached via security questions instead of
// already being logged in.
const PASSWORD_REGEX =
  /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]).{8,12}$/;

type Step = "contact" | "otp" | "answer" | "reset" | "unavailable";

export default function OwnerForgotPassword() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>("contact");
  const [verifying, setVerifying] = useState(false);
  const [proceeding, setProceeding] = useState(false);
  const [error, setError] = useState("");
  const [contactNo, setContactNo] = useState("");
  const [otp, setOtp] = useState("");
  const [recoveryToken, setRecoveryToken] = useState("");
  const [phoneHint, setPhoneHint] = useState("");
  const [resendCount, setResendCount] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [resending, setResending] = useState(false);

  const [ownerId, setOwnerId] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>(["", "", ""]);
  const [revealedEmail, setRevealedEmail] = useState("");
  const [oobCode, setOobCode] = useState("");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [pwError, setPwError] = useState("");
  const [confirmError, setConfirmError] = useState("");

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
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function handleSendOtp() {
    if (!contactNo) {
      setError("Mobile number is required.");
      return;
    }
    if (!/^\d+$/.test(contactNo)) {
      setError("Enter a valid mobile number.");
      return;
    }
    if (contactNo.length !== 11) {
      setError("Mobile number must be 11 digits.");
      return;
    }
    if (!contactNo.startsWith("09")) {
      setError("Mobile number must start with 09.");
      return;
    }
    setProceeding(true);
    setError("");
    try {
      const startRecovery = httpsCallable(cloudFunctions, "startOwnerPasswordRecovery");
      const result: any = await startRecovery({contactNo});
      setRecoveryToken(result.data.recoveryToken);
      setPhoneHint(result.data.phoneHint ?? "your registered phone");
      setResendCount(0);
      setCooldown(60);
      setStep("otp");
    } catch (err: any) {
      setError(err?.message || "We couldn't verify the account using that contact number.");
    } finally {
      setProceeding(false);
    }
  }

  async function handleResendOtp() {
    if (!recoveryToken || cooldown > 0 || resending || resendCount >= 3) return;
    setResending(true);
    setError("");
    try {
      const resend = httpsCallable(cloudFunctions, "resendOwnerPasswordRecovery");
      const result: any = await resend({recoveryToken});
      setResendCount(Number(result.data.resendCount ?? resendCount + 1));
      setOtp("");
      setCooldown(60);
    } catch (err: any) {
      setError(err?.message || "We couldn't resend the code.");
    } finally {
      setResending(false);
    }
  }

  async function handleVerifyOtp() {
    if (!/^\d{6}$/.test(otp)) {
      setError("Enter the 6-digit verification code.");
      return;
    }
    setVerifying(true);
    setError("");
    try {
      const verify = httpsCallable(cloudFunctions, "verifyOwnerRecoveryOtp");
      const result: any = await verify({recoveryToken, otp});
      setOobCode(result.data.oobCode ?? "");
      setRevealedEmail(result.data.email ?? "");
      setStep("reset");
    } catch (err: any) {
      setError(err?.message || "The verification code is incorrect.");
    } finally {
      setVerifying(false);
    }
  }

  async function handleSecurityFallback() {
    setProceeding(true);
    setError("");
    try {
      const getQuestionsFn = httpsCallable(cloudFunctions, "getOwnerSecurityQuestions");
      const result: any = await getQuestionsFn({recoveryToken});
      setOwnerId(result.data.ownerId);
      setQuestions(result.data.questions);
      setStep("answer");
    } catch (err: any) {
      setError(err?.message || "Security-question recovery is unavailable.");
    } finally {
      setProceeding(false);
    }
  }

  async function handleVerify() {
    setError("");
    if (answers.some((a) => !a.trim())) {
      setError("Please answer all 3 questions.");
      return;
    }
    setVerifying(true);
    try {
      const verifyFn = httpsCallable(cloudFunctions, "verifyOwnerSecurityAnswers");
      const result: any = await verifyFn({ ownerId, answers, recoveryToken });
      setOobCode(result.data.oobCode ?? "");
      setRevealedEmail(result.data.email ?? "");
      setStep("reset");
    } catch {
      setError("One or more answers are incorrect.");
    } finally {
      setVerifying(false);
    }
  }

  async function handleResetPassword() {
    let valid = true;

    if (!PASSWORD_REGEX.test(newPassword)) {
      setPwError("8–12 characters with at least 1 uppercase letter, number & special character.");
      valid = false;
    } else {
      setPwError("");
    }

    if (!confirmPassword) {
      setConfirmError("Please confirm your password.");
      valid = false;
    } else if (newPassword !== confirmPassword) {
      setConfirmError("Passwords do not match.");
      valid = false;
    } else {
      setConfirmError("");
    }

    if (!valid || !oobCode) return;

    setProceeding(true);
    try {
      await confirmPasswordReset(auth, oobCode, newPassword);
      router.replace("/login");
    } catch {
      setPwError("This code has expired or was already used. Please start over.");
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
          <Pressable
            style={[styles.backBtn, { top: insets.top + 12 }]}
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={22} color={colors.white} />
          </Pressable>
          <View style={styles.logoCircle}>
            <KeyRound size={28} color={colors.emerald} />
          </View>
          <Text style={styles.appName}>Recover Password</Text>
          <Text style={styles.portalText}>Owner portal</Text>
        </LinearGradient>

        <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, 24) }]}>
          {step === "contact" && (
            <>
              <Text style={styles.heading}>Recover your password</Text>
              <Text style={styles.subheading}>
                Enter the contact number registered to the Owner account. We will send a verification code by SMS.
              </Text>

              <View style={{ marginTop: spacing.xl }}>
                <Text style={styles.fieldLabel}>Contact Number</Text>
                <View style={styles.inputWrapper}>
                  <Phone size={17} color={colors.emeraldBright} style={styles.leftIcon} />
                  <TextInput
                    style={[styles.textInput, { paddingLeft: 40 }]}
                    value={contactNo}
                    onChangeText={(value) => {
                      const digitsOnly = value.replace(/\D/g, "").slice(0, 11);
                      setContactNo(digitsOnly);
                      setError(value && /\D/.test(value) ? "Enter a valid mobile number." : "");
                    }}
                    placeholder="e.g. 09123456789"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="number-pad"
                    maxLength={11}
                    autoComplete="tel"
                    editable={!proceeding}
                    onSubmitEditing={handleSendOtp}
                  />
                </View>
              </View>

              {!!error && <ErrorBanner text={error} />}
              <SubmitButton label="Send Verification Code" loading={proceeding} onPress={handleSendOtp} />
            </>
          )}

          {step === "otp" && (
            <>
              <Text style={styles.heading}>Enter verification code</Text>
              <Text style={styles.subheading}>We sent a 6-digit code to {phoneHint}.</Text>

              <View style={{ marginTop: spacing.xl }}>
                <Text style={styles.fieldLabel}>Verification Code</Text>
                <TextInput
                  style={[styles.textInput, styles.otpInput]}
                  value={otp}
                  onChangeText={(value) => {
                    setOtp(value.replace(/\D/g, "").slice(0, 6));
                    setError("");
                  }}
                  placeholder="000000"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  maxLength={6}
                  editable={!verifying}
                  onSubmitEditing={handleVerifyOtp}
                />
              </View>

              {!!error && <ErrorBanner text={error} />}
              <SubmitButton label="Verify Code" loading={verifying} onPress={handleVerifyOtp} />

              <View style={styles.resendRow}>
                <Text style={styles.resendInfo}>Resend attempts: {resendCount} of 3</Text>
                <Pressable
                  onPress={handleResendOtp}
                  disabled={cooldown > 0 || resending || resendCount >= 3}
                  hitSlop={8}
                >
                  {resending ? (
                    <ActivityIndicator color={colors.emerald} size="small" />
                  ) : (
                    <Text style={[
                      styles.resendAction,
                      (cooldown > 0 || resendCount >= 3) && styles.resendDisabled,
                    ]}>
                      {resendCount >= 3 ? "Resend limit reached" : cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                    </Text>
                  )}
                </Pressable>
              </View>

              {resendCount >= 3 && (
                <Pressable
                  style={({ pressed }) => [styles.fallbackBtn, pressed && { opacity: 0.75 }]}
                  onPress={handleSecurityFallback}
                  disabled={proceeding}
                >
                  {proceeding ? (
                    <ActivityIndicator color={colors.emerald} size="small" />
                  ) : (
                    <>
                      <ShieldCheck size={18} color={colors.emerald} />
                      <Text style={styles.fallbackText}>Use Security Questions Instead</Text>
                    </>
                  )}
                </Pressable>
              )}
            </>
          )}

          {step === "unavailable" && (
            <>
              <Text style={styles.heading}>Not available</Text>
              <Text style={styles.subheading}>
                No security questions have been set up yet. Set them up under My Account, under Change Password.
              </Text>
              <Pressable
                style={({ pressed }) => [styles.signInBtn, { marginTop: spacing.xxl }, pressed && { backgroundColor: colors.white }]}
                onPress={() => router.replace("/login")}
              >
                {({ pressed }) => (
                  <Text style={[styles.signInText, pressed && styles.signInTextPressed]}>Back to Sign in</Text>
                )}
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

          {step === "reset" && (
            <>
              <Text style={[styles.subheading, { fontFamily: fontFamily.bold }]}>Choose a new password.</Text>

              <View style={{ marginTop: spacing.xl }}>
                <Text style={styles.fieldLabel}>New Password</Text>
                <View style={[styles.inputWrapper, !!pwError && { borderColor: colors.error }]}>
                  <Lock size={17} color={colors.emeraldBright} style={styles.leftIcon} />
                  <TextInput
                    style={[styles.textInput, { paddingLeft: 40, paddingRight: 40 }]}
                    value={newPassword}
                    onChangeText={(t) => {
                      setNewPassword(t);
                      setPwError("");
                      if (confirmPassword && confirmPassword === t) setConfirmError("");
                    }}
                    secureTextEntry={!showNewPassword}
                    placeholder="New password"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    maxLength={12}
                    editable={!proceeding}
                    onFocus={scrollToRevealForm}
                  />
                  <Pressable style={styles.rightIcon} onPress={() => setShowNewPassword((v) => !v)}>
                    {showNewPassword ? <Eye size={17} color={colors.textMuted} /> : <EyeOff size={17} color={colors.textMuted} />}
                  </Pressable>
                </View>
                {!!pwError && <Text style={styles.fieldError}>{pwError}</Text>}
              </View>

              <View style={{ marginTop: spacing.lg }}>
                <Text style={styles.fieldLabel}>Confirm Password</Text>
                <View style={[styles.inputWrapper, !!confirmError && { borderColor: colors.error }]}>
                  <Lock size={17} color={colors.emeraldBright} style={styles.leftIcon} />
                  <TextInput
                    style={[styles.textInput, { paddingLeft: 40, paddingRight: 40 }]}
                    value={confirmPassword}
                    onChangeText={(t) => {
                      setConfirmPassword(t);
                      setConfirmError(t && t !== newPassword ? "Passwords do not match." : "");
                    }}
                    secureTextEntry={!showConfirmPassword}
                    placeholder="Confirm new password"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    maxLength={12}
                    editable={!proceeding}
                    onFocus={scrollToRevealForm}
                  />
                  <Pressable style={styles.rightIcon} onPress={() => setShowConfirmPassword((v) => !v)}>
                    {showConfirmPassword ? <Eye size={17} color={colors.textMuted} /> : <EyeOff size={17} color={colors.textMuted} />}
                  </Pressable>
                </View>
                {!!confirmError && <Text style={styles.fieldError}>{confirmError}</Text>}
              </View>

              <View ref={submitBtnRef}>
                <SubmitButton label="Save New Password" loading={proceeding} onPress={handleResetPassword} />
              </View>
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
        pressed && !loading && { backgroundColor: colors.white, transform: [{ scale: 0.98 }] },
      ]}
      onPress={onPress}
      disabled={loading}
    >
      {({ pressed }) =>
        loading ? (
          <ActivityIndicator color={colors.white} size="small" />
        ) : (
          <Text style={[styles.signInText, pressed && styles.signInTextPressed]}>{label}</Text>
        )
      }
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
    padding: spacing.sm,
    zIndex: 2,
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


  fieldLabel: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.emerald, marginBottom: 6 },
  fieldError: { fontSize: fontSize.xs, color: colors.error, fontFamily: fontFamily.medium, marginTop: 4 },

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

  otpInput: {
    textAlign: "center",
    fontSize: fontSize.xl,
    fontFamily: fontFamily.bold,
    letterSpacing: 8,
  },
  resendRow: {
    marginTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 28,
  },
  resendInfo: { color: colors.textSecondary, fontSize: fontSize.sm, fontFamily: fontFamily.regular },
  resendAction: { color: colors.emerald, fontSize: fontSize.sm, fontFamily: fontFamily.bold },
  resendDisabled: { color: colors.textMuted },
  fallbackBtn: {
    marginTop: spacing.xl,
    minHeight: 50,
    borderWidth: 1.5,
    borderColor: colors.emerald,
    borderRadius: radius.md + 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  fallbackText: { color: colors.emerald, fontSize: fontSize.base, fontFamily: fontFamily.bold },

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
  signInTextPressed: { color: colors.emerald },
});
