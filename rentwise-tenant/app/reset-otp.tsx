import { useEffect, useRef, useState } from "react";
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
import { X } from "lucide-react-native";
import { getFunctions, httpsCallable } from "firebase/functions";

import { firebaseApp } from "../shared/firebaseConfig";
import { colors, fontFamily, fontSize, lineHeight, radius, spacing, shadow } from "../shared/theme";

const cloudFunctions = getFunctions(firebaseApp);
const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 45; // seconds

// Second step of the SMS-OTP password reset (after /reset-sending). The tenant
// enters the 6-digit code we texted; verifyResetOtp checks it server-side and,
// ONLY on a correct code, returns the Firebase reset oobCode -- which we hand
// to the unchanged /reset-password screen. See functions/src/index.ts and
// OTP_RESET_PLAN.md.
export default function ResetOtp() {
  const insets = useSafeAreaInsets();
  const { email, phoneHint } = useLocalSearchParams<{ email?: string; phoneHint?: string }>();

  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);
  const inputRef = useRef<TextInput>(null);

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
    if (otp.length !== OTP_LENGTH || submitting) return;
    if (!email) {
      setError("Something went wrong. Please restart from the sign-in screen.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const verifyResetOtp = httpsCallable(cloudFunctions, "verifyResetOtp");
      const res = (await verifyResetOtp({ email, otp })).data as { oobCode?: string };
      if (!res.oobCode) {
        setError("Something went wrong. Please request a new code.");
        setOtp("");
        return;
      }
      // Success: the oobCode was minted only just now, after the correct OTP.
      router.replace({ pathname: "/reset-password", params: { oobCode: res.oobCode } });
    } catch (err: any) {
      // Server messages are already user-facing (incorrect + attempts left,
      // expired, locked out). Clear the field and let them retry / resend.
      console.log("[reset-otp] verifyResetOtp error:", err);
      setError(err?.message || "Incorrect code. Please try again.");
      setOtp("");
      inputRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (cooldown > 0 || resending || !email) return;
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      const sendResetOtp = httpsCallable(cloudFunctions, "sendResetOtp");
      const res = (await sendResetOtp({ email })).data as { status: string };
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

  const canSubmit = otp.length === OTP_LENGTH && !submitting;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Text style={styles.headerTitle}>Enter Code</Text>
        <TouchableOpacity style={styles.closeBtn} onPress={goToLogin} activeOpacity={0.7}>
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
      </View>
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
});
