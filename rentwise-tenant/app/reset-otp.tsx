import { useEffect, useRef, useState } from "react";
import {
  BackHandler,
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { X } from "lucide-react-native";
import { getFunctions, httpsCallable } from "firebase/functions";

import { firebaseApp } from "../shared/firebaseConfig";
import { colors, fontFamily, fontSize, lineHeight, radius, spacing, shadow } from "../shared/theme";

const cloudFunctions = getFunctions(firebaseApp, "us-central1");
const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 60; // seconds

// Second step of the SMS-OTP password reset (after /reset-sending). The tenant
// enters the 6-digit code we texted; verifyResetOtp checks it server-side and,
// ONLY on a correct code, returns the Firebase reset oobCode -- which we hand
// to the unchanged /reset-password screen. See functions/src/index.ts and
// OTP_RESET_PLAN.md.
export default function ResetOtp() {
  const insets = useSafeAreaInsets();
  const { recoveryToken, phoneHint } = useLocalSearchParams<{ recoveryToken?: string; phoneHint?: string }>();

  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);
  const [recoveryModal, setRecoveryModal] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const inputRef = useRef<TextInput>(null);
  const verifyInFlight = useRef(false);
  const verificationLocked = submitting && verifyInFlight.current;

  useEffect(() => {
    if (!verificationLocked) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => subscription.remove();
  }, [verificationLocked]);

  // Resend cooldown countdown -- a code was just sent by /reset-sending, so
  // start locked and tick down to 0.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  function goToLogin() {
    router.replace("/login");
  }

  function handleChange(text: string) {
    const digits = text.replace(/\D/g, "").slice(0, OTP_LENGTH);
    setOtp(digits);
    if (error) setError(null);
    if (notice) setNotice(null);
  }

  async function handleVerify() {
    if (otp.length !== OTP_LENGTH || submitting || verifyInFlight.current) return;
    if (!recoveryToken) {
      setError("Something went wrong. Please restart from the sign-in screen.");
      return;
    }
    // Lock synchronously so rapid taps cannot start two verification requests
    // before React has committed the submitting state.
    verifyInFlight.current = true;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const verifyResetOtp = httpsCallable(cloudFunctions, "verifyResetOtp");
      const res = (await verifyResetOtp({ recoveryToken, otp })).data as { resetToken?: string };
      if (!res.resetToken) {
        setError("Something went wrong. Please request a new code.");
        setOtp("");
        return;
      }
      router.replace({ pathname: "/reset-password", params: { resetToken: res.resetToken } });
    } catch (err: any) {
      // Server messages are already user-facing (incorrect + attempts left,
      // expired, locked out). Clear the field and let them retry / resend.
      console.log("[reset-otp] verifyResetOtp error:", err);
      setError(err?.message || "Incorrect code. Please try again.");
      setOtp("");
      inputRef.current?.focus();
    } finally {
      verifyInFlight.current = false;
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (cooldown > 0 || resending || !recoveryToken) return;
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      const sendResetOtp = httpsCallable(cloudFunctions, "sendResetOtp");
      const res = (await sendResetOtp({ recoveryToken })).data as { status: string };
      // Stay generic regardless of outcome -- don't reveal account state.
      setOtp("");
      setCooldown(RESEND_COOLDOWN);
      setNotice(
        res.status === "sent"
          ? "A new code is on its way."
          : "If we can reach your phone, a new code is on its way.",
      );
      inputRef.current?.focus();
    } catch (err: any) {
      console.log("[reset-otp] resend error:", err);
      setError(err?.message || "Couldn't resend the code. Please try again.");
    } finally {
      setResending(false);
    }
  }

  async function handleAdminRecovery() {
    if (!recoveryToken || submitting || resending) return;
    if (!/^9\d{9}$/.test(newPhone)) {
      setError("Enter a valid 10-digit mobile number starting with 9.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const requestRecovery = httpsCallable(cloudFunctions, "requestTenantAdminRecovery");
      await requestRecovery({recoveryToken, newPhone, confirmPhone: newPhone});
      setRecoveryModal(false);
      router.replace({pathname: "/login", params: {recoveryWaiting: "1"}});
    } catch (err: any) {
      setError(err?.message || "Couldn't send the recovery request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = otp.length === OTP_LENGTH && !submitting;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Text style={styles.headerTitle}>Enter Code</Text>
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={goToLogin}
          disabled={verificationLocked}
          activeOpacity={0.7}
        >
          <X size={22} color={colors.emeraldSoft} />
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        <Text style={styles.title}>Verify it's you</Text>
        <Text style={styles.subtitle}>
          Enter the 6-digit code we texted to {phoneHint || "your phone"}.
        </Text>

        {/* 6 visual boxes driven by one hidden input -- avoids the well-known
            RN multi-input focus/backspace bugs. Tapping anywhere on the row
            focuses the hidden field. */}
        <View style={styles.otpWrap}>
          <View style={styles.otpRow} pointerEvents="none">
            {Array.from({ length: OTP_LENGTH }).map((_, i) => {
              const active = i === otp.length;
              const filled = i < otp.length;
              return (
                <View
                  key={i}
                  style={[
                    styles.otpBox,
                    filled && styles.otpBoxFilled,
                    active && styles.otpBoxActive,
                    !!error && styles.otpBoxError,
                  ]}
                >
                  <Text style={styles.otpDigit}>{otp[i] ?? ""}</Text>
                </View>
              );
            })}
          </View>
          <TextInput
            ref={inputRef}
            style={styles.otpHiddenInput}
            value={otp}
            onChangeText={handleChange}
            keyboardType="number-pad"
            maxLength={OTP_LENGTH}
            autoFocus
            caretHidden
            editable={!submitting}
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
          />
        </View>

        {!!error && <Text style={styles.errorText}>{error}</Text>}
        {!!notice && !error && <Text style={styles.noticeText}>{notice}</Text>}

        <Pressable
          style={({ pressed }) => [
            styles.submitBtn,
            !canSubmit && styles.submitBtnDisabled,
            pressed && canSubmit && styles.submitBtnPressed,
          ]}
          onPress={handleVerify}
          disabled={!canSubmit}
        >
          {({ pressed }) =>
            submitting ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={[styles.submitBtnText, pressed && canSubmit && styles.submitBtnTextPressed]}>
                Verify code
              </Text>
            )
          }
        </Pressable>

        <View style={styles.resendRow}>
          {cooldown > 0 ? (
            <Text style={styles.resendMuted}>Resend code in {cooldown}s</Text>
          ) : (
            <TouchableOpacity onPress={handleResend} disabled={resending} activeOpacity={0.7}>
              <Text style={styles.resendLink}>{resending ? "Sending…" : "Resend code"}</Text>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={styles.adminHelpButton}
          onPress={() => { setError(null); setRecoveryModal(true); }}
          disabled={submitting || resending}
          activeOpacity={0.7}
        >
          <Text style={styles.adminHelpText}>I can't access this phone</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={recoveryModal} transparent animationType="fade" onRequestClose={() => setRecoveryModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Use a new mobile number</Text>
            <Text style={styles.modalSubtitle}>Admin approval is required. Your registered number will change only after you sign in and create a new password.</Text>
            <Text style={styles.modalLabel}>New Mobile Number</Text>
            <View style={styles.phoneField}><Text style={styles.phonePrefix}>+63</Text><TextInput style={styles.phoneInput} value={newPhone} onChangeText={(v) => setNewPhone(v.replace(/\D/g, "").slice(0, 10))} keyboardType="phone-pad" placeholder="9XXXXXXXXX" /></View>
            {!!error && <Text style={styles.errorText}>{error}</Text>}
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setRecoveryModal(false)} disabled={submitting}><Text style={styles.modalCancelText}>Cancel</Text></Pressable>
              <Pressable style={[styles.modalSubmit, submitting && styles.submitBtnDisabled]} onPress={handleAdminRecovery} disabled={submitting}>{submitting ? <ActivityIndicator color={colors.white} /> : <Text style={styles.modalSubmitText}>Send Request</Text>}</Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {verificationLocked && (
        <View
          style={styles.interactionLock}
          pointerEvents="auto"
          accessibilityViewIsModal
          accessibilityLabel="Verifying code"
        >
          <View style={styles.interactionLockIndicator}>
            <ActivityIndicator color={colors.emerald} size="large" />
            <Text style={styles.interactionLockText}>Verifying code...</Text>
          </View>
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

  body: { flex: 1, padding: spacing.xxl },
  title: { fontSize: fontSize.xl, fontFamily: fontFamily.bold, color: colors.ink, marginBottom: 4 },
  subtitle: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    marginBottom: spacing.xxl,
    lineHeight: lineHeight.base,
  },

  otpWrap: { position: "relative", alignSelf: "stretch" },
  otpRow: { flexDirection: "row", gap: spacing.sm },
  otpBox: {
    flex: 1,
    height: 56,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.emeraldSoft,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  otpBoxFilled: { borderColor: colors.emeraldBright },
  otpBoxActive: { borderColor: colors.emerald },
  otpBoxError: { borderColor: colors.error },
  otpDigit: { fontSize: fontSize.xl, fontFamily: fontFamily.bold, color: colors.ink },
  otpHiddenInput: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    color: "transparent",
  },

  errorText: {
    fontSize: fontSize.xs + 1,
    fontFamily: fontFamily.medium,
    color: colors.error,
    marginTop: spacing.md,
  },
  noticeText: {
    fontSize: fontSize.xs + 1,
    fontFamily: fontFamily.medium,
    color: colors.emerald,
    marginTop: spacing.md,
  },

  submitBtn: {
    marginTop: spacing.xl,
    backgroundColor: colors.emerald,
    borderRadius: radius.md + 2,
    paddingVertical: 15,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "transparent",
    ...shadow.button,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnPressed: { backgroundColor: colors.white, borderColor: colors.emerald },
  submitBtnText: { color: colors.white, fontSize: fontSize.md, fontFamily: fontFamily.bold },
  submitBtnTextPressed: { color: colors.emerald },

  resendRow: { alignItems: "center", marginTop: spacing.xl },
  resendMuted: { fontSize: fontSize.sm, fontFamily: fontFamily.regular, color: colors.textMuted },
  resendLink: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.emerald },
  adminHelpButton: { alignItems: "center", marginTop: spacing.lg, paddingVertical: spacing.sm },
  adminHelpText: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.textSecondary },
  interactionLock: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
    elevation: 1000,
    backgroundColor: "rgba(247, 246, 240, 0.72)",
    alignItems: "center",
    justifyContent: "center",
  },
  interactionLockIndicator: {
    minWidth: 170,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    alignItems: "center",
    gap: spacing.sm,
    ...shadow.card,
  },
  interactionLockText: {
    color: colors.ink,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
  },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(4,25,21,0.66)", justifyContent: "center", padding: spacing.xl },
  modalCard: { backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.xl, ...shadow.raised },
  modalTitle: { fontSize: fontSize.lg, fontFamily: fontFamily.bold, color: colors.ink },
  modalSubtitle: { marginTop: spacing.sm, marginBottom: spacing.lg, color: colors.textSecondary, fontFamily: fontFamily.regular, lineHeight: 20 },
  modalLabel: { marginTop: spacing.sm, marginBottom: 6, color: colors.emerald, fontFamily: fontFamily.semibold, fontSize: fontSize.sm },
  phoneField: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: colors.emeraldSoft, borderRadius: radius.sm },
  phonePrefix: { paddingHorizontal: spacing.md, color: colors.ink, fontFamily: fontFamily.semibold },
  phoneInput: { flex: 1, padding: spacing.md, color: colors.ink, fontFamily: fontFamily.medium },
  modalActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xl },
  modalCancel: { flex: 1, alignItems: "center", padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.emerald },
  modalCancelText: { color: colors.emerald, fontFamily: fontFamily.bold },
  modalSubmit: { flex: 1, alignItems: "center", padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.emerald },
  modalSubmitText: { color: colors.white, fontFamily: fontFamily.bold },
});
