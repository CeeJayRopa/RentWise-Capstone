import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { X, AlertCircle, CheckCircle2, Eye, EyeOff } from "lucide-react-native";
import { verifyPasswordResetCode, confirmPasswordReset } from "firebase/auth";

import { auth } from "../shared/firebaseConfig";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../shared/theme";

type Step = "checking" | "invalid" | "form" | "done";

// Reached from login.tsx's Forgot Password flow, which generates the reset
// code server-side and navigates straight here with it — no email, no
// WebView, no Android App Links needed, since this never has to work
// outside the app itself.
export default function ResetPassword() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ oobCode?: string }>();
  const [step, setStep] = useState<Step>("checking");
  const [email, setEmail] = useState("");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [pwError, setPwError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!params.oobCode) {
      setStep("invalid");
      return;
    }
    verifyPasswordResetCode(auth, params.oobCode)
      .then((resolvedEmail) => {
        setEmail(resolvedEmail);
        setStep("form");
      })
      .catch(() => setStep("invalid"));
  }, [params.oobCode]);

  function goToLogin() {
    router.replace("/login");
  }

  async function handleSubmit() {
    const pwRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]).{8,12}$/;
    let valid = true;

    if (!pwRegex.test(newPassword)) {
      setPwError("8–12 characters with letters, numbers, and special characters.");
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

    if (!valid || !params.oobCode) return;

    setSubmitting(true);
    try {
      await confirmPasswordReset(auth, params.oobCode, newPassword);
      setStep("done");
    } catch {
      setPwError("This link has expired or was already used. Please request a new one.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Text style={styles.headerTitle}>Reset Password</Text>
        <TouchableOpacity style={styles.closeBtn} onPress={goToLogin} activeOpacity={0.7}>
          <X size={22} color={colors.emeraldSoft} />
        </TouchableOpacity>
      </View>

      {step === "checking" && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.emerald} />
        </View>
      )}

      {step === "invalid" && (
        <View style={styles.center}>
          <AlertCircle size={44} color={colors.error} style={{ marginBottom: 12 }} />
          <Text style={styles.errorText}>
            This link has expired or was already used. Please request a new one from the login screen.
          </Text>
          <TouchableOpacity style={styles.backBtn} onPress={goToLogin} activeOpacity={0.8}>
            <Text style={styles.backBtnText}>Back to Sign in</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === "done" && (
        <View style={styles.center}>
          <CheckCircle2 size={44} color={colors.emeraldBright} style={{ marginBottom: 12 }} />
          <Text style={styles.doneText}>Password updated!</Text>
          <Text style={styles.doneSubtext}>You can now sign in with your new password.</Text>
          <TouchableOpacity style={styles.backBtn} onPress={goToLogin} activeOpacity={0.8}>
            <Text style={styles.backBtnText}>Back to Sign in</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === "form" && (
        <View style={styles.formBody}>
          <Text style={styles.formTitle}>Choose a new password</Text>
          <Text style={styles.formSubtitle}>For {email}</Text>

          <Text style={styles.fieldLabel}>New Password</Text>
          <View style={[styles.pwField, !!pwError && styles.pwFieldError]}>
            <TextInput
              style={styles.pwInput}
              value={newPassword}
              onChangeText={(t) => {
                setNewPassword(t);
                setPwError("");
                if (confirmPassword && confirmPassword === t) setConfirmError("");
              }}
              secureTextEntry={!showNewPass}
              placeholder="New password"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              maxLength={12}
              editable={!submitting}
            />
            <Pressable style={styles.eyeBtn} onPress={() => setShowNewPass((v) => !v)} hitSlop={8}>
              {showNewPass ? (
                <Eye size={18} color={colors.emeraldBright} />
              ) : (
                <EyeOff size={18} color={colors.emeraldBright} />
              )}
            </Pressable>
          </View>
          {!!pwError && <Text style={styles.fieldError}>{pwError}</Text>}
          <Text style={styles.pwHint}>Min. 8 characters with a letter, number, and special character.</Text>

          <Text style={styles.fieldLabel}>Confirm Password</Text>
          <View style={[styles.pwField, !!confirmError && styles.pwFieldError]}>
            <TextInput
              style={styles.pwInput}
              value={confirmPassword}
              onChangeText={(t) => {
                setConfirmPassword(t);
                setConfirmError(t && t !== newPassword ? "Passwords do not match." : "");
              }}
              secureTextEntry={!showConfirmPass}
              placeholder="Confirm new password"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              maxLength={12}
              editable={!submitting}
            />
            <Pressable style={styles.eyeBtn} onPress={() => setShowConfirmPass((v) => !v)} hitSlop={8}>
              {showConfirmPass ? (
                <Eye size={18} color={colors.emeraldBright} />
              ) : (
                <EyeOff size={18} color={colors.emeraldBright} />
              )}
            </Pressable>
          </View>
          {!!confirmError && <Text style={styles.fieldError}>{confirmError}</Text>}

          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.8}
          >
            {submitting ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.submitBtnText}>Save New Password</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.parchment },
  header: {
    backgroundColor: colors.emerald,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  headerTitle: { color: colors.white, fontSize: fontSize.lg - 1, fontFamily: fontFamily.bold },
  closeBtn: { padding: 4 },

  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxl },
  errorText: { fontSize: fontSize.md, fontFamily: fontFamily.regular, color: colors.error, textAlign: "center", marginBottom: spacing.xl, lineHeight: 21 },
  doneText: { fontSize: fontSize.lg, fontFamily: fontFamily.bold, color: colors.ink, marginBottom: 6 },
  doneSubtext: { fontSize: fontSize.base, fontFamily: fontFamily.regular, color: colors.textSecondary, marginBottom: spacing.xl, textAlign: "center" },
  backBtn: {
    backgroundColor: colors.emerald,
    borderRadius: radius.md + 2,
    paddingVertical: 13,
    paddingHorizontal: spacing.xxxl,
    ...shadow.button,
  },
  backBtnText: { color: colors.white, fontSize: fontSize.base, fontFamily: fontFamily.semibold },

  formBody: { flex: 1, padding: spacing.xxl },
  formTitle: { fontSize: fontSize.xl, fontFamily: fontFamily.bold, color: colors.ink, marginBottom: 4 },
  formSubtitle: { fontSize: fontSize.sm, fontFamily: fontFamily.regular, color: colors.textSecondary, marginBottom: spacing.xxl },

  fieldLabel: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.emerald, marginBottom: 6 },
  pwField: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.emeraldSoft,
    marginBottom: 4,
  },
  pwFieldError: { borderColor: colors.error },
  pwInput: {
    flex: 1,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
    fontSize: fontSize.base,
    fontFamily: fontFamily.medium,
    color: colors.ink,
  },
  eyeBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  fieldError: { fontSize: fontSize.xs + 1, fontFamily: fontFamily.medium, color: colors.error, marginBottom: 4 },
  pwHint: { fontSize: fontSize.xs, fontFamily: fontFamily.regular, color: colors.textSecondary, marginBottom: spacing.lg },

  submitBtn: {
    marginTop: spacing.xl,
    backgroundColor: colors.emerald,
    borderRadius: radius.md + 2,
    paddingVertical: 15,
    alignItems: "center",
    ...shadow.button,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: colors.white, fontSize: fontSize.md, fontFamily: fontFamily.bold },
});
