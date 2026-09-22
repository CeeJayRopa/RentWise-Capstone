import { useEffect, useRef, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Info, AlertCircle } from "lucide-react-native";
import { getFunctions, httpsCallable } from "firebase/functions";

import { firebaseApp } from "../shared/firebaseConfig";
import { colors, fontFamily, fontSize, lineHeight, radius, spacing, shadow } from "../shared/theme";

const cloudFunctions = getFunctions(firebaseApp);

type SendResult = { status: "sent"; phoneHint?: string } | { status: "manual" };

// Transient loading screen between the login "Forgot password?" modal and the
// OTP entry screen. It does the real work: ask the backend to verify the
// account and text a 6-digit code, then hand off to /reset-otp. The Firebase
// reset code is NEVER minted here -- only after the OTP is verified on
// /reset-otp. See sendResetOtp in functions/src/index.ts and OTP_RESET_PLAN.md.
export default function ResetSending() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  const [phase, setPhase] = useState<"sending" | "manual" | "error">("sending");
  const [errorMsg, setErrorMsg] = useState("");
  const startedRef = useRef(false);

  useEffect(() => {
    // Latch so a re-render or fast-refresh can't fire a second SMS.
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      if (!email) {
        setErrorMsg("Something went wrong. Please try again from the sign-in screen.");
        setPhase("error");
        return;
      }
      try {
        const sendResetOtp = httpsCallable(cloudFunctions, "sendResetOtp");
        const res = (await sendResetOtp({ email })).data as SendResult;
        if (res.status === "sent") {
          router.replace({
            pathname: "/reset-otp",
            params: { email, phoneHint: res.phoneHint ?? "" },
          });
          return;
        }
        // Every gate failure (unknown email, unverified, no phone on file)
        // returns the same "manual" result with the same message below, so
        // this screen can't be used to probe which emails exist/are verified.
        setPhase("manual");
      } catch (err: any) {
        console.log("[reset-sending] sendResetOtp error:", err);
        const friendlyMessage =
          err?.code === "functions/unavailable"
            ? "We couldn't send the reset code right now. Please try again in a few minutes."
            : "We couldn't start the password reset. Please try again. If the problem continues, contact your administrator.";
        setErrorMsg(friendlyMessage);
        setPhase("error");
      }
    })();
  }, [email]);

  function goToLogin() {
    router.replace("/login");
  }

  if (phase === "sending") {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.gold} />
        <Text style={styles.caption}>Sending your reset code…</Text>
        <Text style={styles.subcaption}>
          Checking your account and texting the code to the phone on file.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {phase === "manual" ? (
        <Info size={48} color={colors.gold} style={styles.icon} />
      ) : (
        <AlertCircle size={48} color={colors.gold} style={styles.icon} />
      )}
      <Text style={styles.caption}>{phase === "manual" ? "Request received" : "We hit a snag"}</Text>
      <Text style={styles.subcaption}>
        {phase === "manual"
          ? "Your reset request has been sent to the admin, who'll help you reset your password. Tip: verify your email in your profile to reset instantly next time."
          : errorMsg}
      </Text>
      <Pressable
        style={({ pressed }) => [styles.backBtn, pressed && styles.backBtnPressed]}
        onPress={goToLogin}
      >
        {({ pressed }) => (
          <Text style={[styles.backBtnText, pressed && styles.backBtnTextPressed]}>
            Back to Sign in
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.ink,
    padding: spacing.xxl,
  },
  icon: { marginBottom: spacing.lg },
  caption: {
    color: colors.white,
    marginTop: spacing.lg,
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
    textAlign: "center",
  },
  subcaption: {
    color: colors.emeraldSoft,
    marginTop: spacing.sm,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    textAlign: "center",
    lineHeight: lineHeight.base,
    maxWidth: 320,
  },
  backBtn: {
    marginTop: spacing.xxl,
    backgroundColor: colors.gold,
    borderRadius: radius.md + 2,
    paddingVertical: 13,
    paddingHorizontal: spacing.xxxl,
    borderWidth: 1.5,
    borderColor: "transparent",
    ...shadow.button,
  },
  backBtnPressed: { backgroundColor: colors.goldSoft, borderColor: colors.gold },
  backBtnText: { color: colors.ink, fontSize: fontSize.base, fontFamily: fontFamily.semibold },
  backBtnTextPressed: { color: colors.ink },
});
