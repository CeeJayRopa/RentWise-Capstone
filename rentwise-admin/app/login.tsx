import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Animated,
  Easing,
  Pressable,
  Dimensions,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Alert,
  Image,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useState, useRef, useEffect } from "react";
import { router } from "expo-router";
import { Mail, Lock, Eye, EyeOff, AlertCircle, X, Info, Check } from "lucide-react-native";
import { collection, query, where, getDocs, addDoc, serverTimestamp } from "firebase/firestore";

import { loginUser } from "../shared/services/auth";
import { getUserByUsername } from "../shared/services/userServices";
import { db } from "../shared/services/firestore";
import {
  checkLockout,
  recordFailedAttempt,
  resetLockout,
  formatLockoutRemaining,
} from "../shared/services/loginLockout";
import { setRememberMe } from "../shared/services/rememberMe";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../shared/theme";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

export default function Login() {
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [, setLockoutTick] = useState(0);
  const [rememberMe, setRememberMeChecked] = useState(false);

  const [showForgotModal, setShowForgotModal] = useState(false);
  const [fpEmail, setFpEmail] = useState("");
  const [fpEmailFocused, setFpEmailFocused] = useState(false);
  const [fpLoading, setFpLoading] = useState(false);
  const [fpError, setFpError] = useState<string | null>(null);
  const [fpSuccess, setFpSuccess] = useState(false);

  const pulseScale = useRef(new Animated.Value(0.92)).current;
  const pulseOpacity = useRef(new Animated.Value(0.6)).current;
  const logoAnim = useRef(new Animated.Value(0)).current;
  const headingAnim = useRef(new Animated.Value(0)).current;
  const emailAnim = useRef(new Animated.Value(0)).current;
  const passwordAnim = useRef(new Animated.Value(0)).current;
  const buttonAnim = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);
  const emailInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);
  const buttonRef = useRef<View>(null);
  const scrollViewHeightRef = useRef(SCREEN_HEIGHT);

  // Always scrolls to the SAME fixed target — the sign-in button — no matter
  // which of the two fields was tapped. Measuring each field individually
  // used to land in a different spot depending on whether the keyboard was
  // already open (email vs. password), which looked inconsistent.
  //
  // The target is computed against the ScrollView's OWN current height
  // (which KeyboardAvoidingView actually shrinks once the keyboard is up),
  // not a guessed pixel constant — a fixed offset would either undershoot
  // on tall keyboards or overshoot far enough to scroll the entire navy
  // header off-screen, leaving nothing but the white card filling the
  // whole screen.
  function scrollToRevealForm() {
    setTimeout(() => {
      const target = buttonRef.current;
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
    // onFocus fires before the keyboard has finished animating in, so a
    // fixed delay can land short if the OS is still resizing the window —
    // scroll again once Android/iOS confirms the keyboard is fully shown.
    // Skipped while the forgot-password modal is open — its own text field
    // triggers this same event, and scrolling the login form behind a
    // semi-transparent modal made it look like the login screen was
    // reacting to taps inside the modal.
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      if (!showForgotModal) scrollToRevealForm();
    });
    return () => sub.remove();
  }, [showForgotModal]);

  // Ticks every second while locked out so the countdown text stays live,
  // and clears the lockout automatically once it expires.
  useEffect(() => {
    if (!lockoutUntil) return;
    const interval = setInterval(() => {
      if (Date.now() >= lockoutUntil) {
        setLockoutUntil(null);
      } else {
        setLockoutTick((t) => t + 1);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutUntil]);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulseScale, { toValue: 1.04, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseOpacity, { toValue: 0.15, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(pulseScale, { toValue: 0.92, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseOpacity, { toValue: 0.6, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      ])
    ).start();

    const entrance = (anim: Animated.Value) =>
      Animated.timing(anim, {
        toValue: 1,
        duration: 520,
        easing: Easing.out(Easing.back(1.2)),
        useNativeDriver: true,
      });

    Animated.stagger(130, [
      entrance(logoAnim),
      entrance(headingAnim),
      entrance(emailAnim),
      entrance(passwordAnim),
      entrance(buttonAnim),
    ]).start();
  }, []);

  const slideIn = (anim: Animated.Value) => ({
    opacity: anim,
    transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
  });

  const handleLogin = async () => {
    setError("");
    const identifier = username.trim();
    if (!identifier || !password.trim()) {
      setError("Please enter your username and password.");
      return;
    }

    const existingLockout = await checkLockout(identifier);
    if (existingLockout) {
      setLockoutUntil(existingLockout);
      return;
    }

    setLoading(true);
    try {
      let email = identifier;
      const userDoc = await getUserByUsername(identifier, "admin");
      if (userDoc) {
        email = userDoc.email;
      } else if (!email.includes("@")) {
        email = `${email}@rentwise.app`;
      }
      const result = await loginUser(email, password);
      const { getUserRole } = await import("../shared/services/userServices");
      const role = await getUserRole(result.uid);
      if (role !== "admin") {
        const { logoutUser } = await import("../shared/services/auth");
        await logoutUser();
        setError("Access denied. Admin account required.");
        return;
      }
      await resetLockout(identifier);
      await setRememberMe(rememberMe);
      router.replace("/welcome");
    } catch {
      const { lockoutUntil: newLockout, remainingAttempts, lockoutLevel } =
        await recordFailedAttempt(identifier);
      if (newLockout) {
        setLockoutUntil(newLockout);
        if (lockoutLevel >= 3) {
          Alert.alert(
            "Forgot your password?",
            "It seems that you really forgot the password, please click the forgot password to request for a password reset to the owner.",
          );
        }
      } else {
        setError(
          `Invalid username or password. ${remainingAttempts} attempt${remainingAttempts === 1 ? "" : "s"} remaining.`,
        );
      }
    } finally {
      setLoading(false);
    }
  };

  function closeForgotModal() {
    setShowForgotModal(false);
    setFpEmail("");
    setFpEmailFocused(false);
    setFpError(null);
    setFpSuccess(false);
  }

  async function handleForgotSubmit() {
    const trimmed = fpEmail.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!trimmed || !emailRegex.test(trimmed)) {
      setFpError("Please enter a valid email address.");
      return;
    }
    setFpError(null);
    setFpLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, "users"),
          where("email", "==", trimmed),
          where("role", "==", "admin"),
        ),
      );
      if (snap.empty) {
        setFpError("No admin account found with this email.");
        return;
      }
      const matched = snap.docs[0];
      const data = matched.data();

      // Admin password resets always go to the owner to handle manually —
      // no self-service path, by design (reduces owner's workload only
      // where it's safe to; an admin account resetting itself isn't).
      await addDoc(collection(db, "passwordResetRequests"), {
        email: trimmed,
        tenantId: matched.id,
        tenantName: `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim(),
        requestedRole: "admin",
        status: "pending",
        createdAt: serverTimestamp(),
      });
      setFpSuccess(true);
      setTimeout(() => closeForgotModal(), 2500);
    } catch (err) {
      console.log("ForgotPassword error:", err);
      setFpError("Something went wrong. Please try again.");
    } finally {
      setFpLoading(false);
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
        <View style={{ flex: 1, minHeight: SCREEN_HEIGHT }}>

          {/* Top gradient hero */}
          <LinearGradient
            colors={[colors.emerald, colors.ink]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.topSection, { paddingTop: insets.top + 24 }]}
          >
            <Animated.View style={[styles.logoGroup, slideIn(logoAnim)]}>
              <Animated.View
                style={[
                  styles.pulseRing,
                  { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
                ]}
              />
              <LinearGradient
                colors={[colors.emerald, colors.ink]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.logoCircle}
              >
                <Image
                  source={require("../assets/rentwise-icon.png")}
                  style={styles.logoImage}
                  resizeMode="contain"
                />
              </LinearGradient>
            </Animated.View>
            <Animated.Text style={[styles.appName, slideIn(logoAnim)]}>
              Admin portal
            </Animated.Text>
          </LinearGradient>

          {/* White card */}
          <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, 24) }]}>

            {/* Heading group */}
            <Animated.View style={slideIn(headingAnim)}>
              <Text style={styles.heading}>Welcome back</Text>
              <Text style={styles.subheading}>Sign in to manage your platform</Text>
            </Animated.View>

            {/* Email field */}
            <Animated.View style={[{ marginTop: spacing.xxl }, slideIn(emailAnim)]}>
              <Text style={styles.fieldLabel}>Email</Text>
              <View style={styles.inputWrapper}>
                <Mail size={17} color={colors.emeraldBright} style={styles.leftIcon} />
                <TextInput
                  ref={emailInputRef}
                  style={[styles.textInput, emailFocused && styles.textInputFocused]}
                  value={username}
                  onChangeText={(t) => { setUsername(t); setError(""); }}
                  placeholder="username@rentwise.app"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  editable={!loading && !lockoutUntil}
                  onFocus={() => { setEmailFocused(true); scrollToRevealForm(); }}
                  onBlur={() => {
                    setEmailFocused(false);
                    checkLockout(username.trim()).then((u) => { if (u) setLockoutUntil(u); });
                  }}
                />
              </View>
            </Animated.View>

            {/* Password field */}
            <Animated.View style={[{ marginTop: spacing.lg }, slideIn(passwordAnim)]}>
              <Text style={styles.fieldLabel}>Password</Text>
              <View style={styles.inputWrapper}>
                <Lock size={17} color={colors.emeraldBright} style={styles.leftIcon} />
                <TextInput
                  ref={passwordInputRef}
                  style={[styles.textInput, passwordFocused && styles.textInputFocused]}
                  value={password}
                  onChangeText={(t) => { setPassword(t); setError(""); }}
                  secureTextEntry={!showPassword}
                  placeholder="Enter your password"
                  placeholderTextColor={colors.textMuted}
                  editable={!loading && !lockoutUntil}
                  onFocus={() => { setPasswordFocused(true); scrollToRevealForm(); }}
                  onBlur={() => setPasswordFocused(false)}
                />
                <TouchableOpacity
                  style={styles.rightIcon}
                  onPress={() => setShowPassword((v) => !v)}
                  activeOpacity={0.7}
                >
                  {showPassword ? <Eye size={17} color={colors.textMuted} /> : <EyeOff size={17} color={colors.textMuted} />}
                </TouchableOpacity>
              </View>
            </Animated.View>

            {/* Remember me + Forgot password row */}
            <View style={styles.optionsRow}>
              <Pressable
                style={styles.rememberMeRow}
                onPress={() => setRememberMeChecked((v) => !v)}
                hitSlop={8}
              >
                <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                  {rememberMe && <Check size={13} color={colors.white} />}
                </View>
                <Text style={styles.rememberMeText}>Remember me</Text>
              </Pressable>

              <Pressable onPress={() => setShowForgotModal(true)}>
                <Text style={styles.forgotLinkText}>Forgot password?</Text>
              </Pressable>
            </View>

            {/* Lockout / error banner */}
            {lockoutUntil ? (
              <View style={styles.errorBanner}>
                <AlertCircle size={16} color={colors.error} style={{ marginRight: 8 }} />
                <Text style={styles.errorText}>
                  Too many failed attempts. Try again in {formatLockoutRemaining(lockoutUntil)}.
                </Text>
              </View>
            ) : !!error && (
              <View style={styles.errorBanner}>
                <AlertCircle size={16} color={colors.error} style={{ marginRight: 8 }} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Sign in button */}
            <Animated.View ref={buttonRef} style={[{ marginTop: spacing.xxl + 4 }, slideIn(buttonAnim)]}>
              <Pressable
                style={({ pressed }) => [
                  styles.signInBtn,
                  (loading || !!lockoutUntil) && styles.signInBtnDisabled,
                  pressed && !loading && !lockoutUntil && { backgroundColor: colors.ink, transform: [{ scale: 0.98 }] },
                ]}
                onPress={handleLogin}
                disabled={loading || !!lockoutUntil}
              >
                {loading ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <Text style={styles.signInText}>Sign in</Text>
                )}
              </Pressable>
            </Animated.View>

          </View>
        </View>
      </ScrollView>

      {/* FORGOT PASSWORD MODAL */}
      <Modal
        visible={showForgotModal}
        transparent
        animationType="fade"
        onRequestClose={closeForgotModal}
      >
        <KeyboardAvoidingView
          style={{ flex: 1, backgroundColor: colors.overlay }}
          behavior="padding"
        >
          <View style={fp.overlay}>
            <View style={fp.card}>
              <Pressable style={fp.closeBtn} onPress={closeForgotModal}>
                <X size={16} color={colors.textSecondary} />
              </Pressable>

              <View style={fp.iconCircle}>
                <Mail size={22} color={colors.emerald} />
              </View>
              <Text style={fp.title}>Forgot password</Text>
              <Text style={fp.subtitle}>
                Enter your admin email and we'll send your request to the owner.
              </Text>

              <View style={{ marginTop: spacing.xxl - 2, alignSelf: "stretch" }}>
                <Text style={fp.label}>Email</Text>
                <View style={fp.inputWrapper}>
                  <Mail size={16} color={colors.emeraldBright} style={fp.inputIcon} />
                  <TextInput
                    style={[fp.input, fpEmailFocused && fp.inputFocused]}
                    value={fpEmail}
                    onChangeText={(t) => { setFpEmail(t); setFpError(null); }}
                    placeholder="username@rentwise.app"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    onFocus={() => setFpEmailFocused(true)}
                    onBlur={() => setFpEmailFocused(false)}
                  />
                </View>
                {fpError ? <Text style={fp.errorText}>{fpError}</Text> : null}
              </View>

              {fpSuccess ? (
                <View style={fp.successBox}>
                  <Info size={15} color={colors.emerald} style={fp.successIcon} />
                  <Text style={fp.successText}>
                    Request sent. The owner will contact you shortly.
                  </Text>
                </View>
              ) : (
                <Pressable
                  style={({ pressed }) => [
                    fp.submitBtn,
                    pressed && { backgroundColor: colors.ink, transform: [{ scale: 0.97 }] },
                  ]}
                  onPress={handleForgotSubmit}
                  disabled={fpLoading}
                >
                  {fpLoading
                    ? <ActivityIndicator color={colors.white} />
                    : <Text style={fp.submitText}>Submit request</Text>
                  }
                </Pressable>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  topSection: {
    height: SCREEN_HEIGHT * 0.38,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 32,
  },

  logoGroup: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },

  pulseRing: {
    position: "absolute",
    width: 84,
    height: 84,
    borderRadius: 999,
    backgroundColor: colors.emeraldBright,
  },

  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },

  logoImage: {
    width: 64,
    height: 64,
  },

  appName: {
    color: colors.white,
    fontSize: fontSize.xxl + 2,
    fontFamily: fontFamily.bold,
  },

  card: {
    flex: 1,
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl + 4,
    borderTopRightRadius: radius.xl + 4,
    marginTop: -(radius.xl + 4),
    paddingHorizontal: spacing.xxl + 4,
    paddingTop: spacing.xxl + 4,
  },

  heading: {
    fontSize: fontSize.xl + 2,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  subheading: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    marginTop: 2,
  },

  fieldLabel: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
    marginBottom: 6,
  },

  inputWrapper: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
  },

  leftIcon: {
    position: "absolute",
    left: 13,
    zIndex: 1,
  },

  rightIcon: {
    position: "absolute",
    right: 13,
    zIndex: 1,
    padding: 2,
  },

  textInput: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.emeraldSoft,
    backgroundColor: colors.mist,
    paddingVertical: 13,
    paddingLeft: 40,
    paddingRight: 40,
    color: colors.ink,
    fontFamily: fontFamily.medium,
    fontSize: fontSize.base,
  },

  textInputFocused: {
    borderColor: colors.emeraldBright,
    backgroundColor: colors.white,
  },

  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.md,
    backgroundColor: colors.errorSoft,
    borderRadius: radius.sm - 2,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg - 2,
  },

  errorText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    color: colors.error,
    flex: 1,
  },

  signInBtn: {
    width: "100%",
    borderRadius: radius.md + 2,
    backgroundColor: colors.emerald,
    paddingVertical: 15,
    alignItems: "center",
    ...shadow.button,
  },

  signInBtnDisabled: {
    opacity: 0.5,
  },

  signInText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    textAlign: "center",
  },

  forgotLinkText: {
    fontSize: fontSize.sm,
    color: colors.emeraldBright,
    fontFamily: fontFamily.semibold,
  },

  optionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.lg - 2,
  },
  rememberMeRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.emeraldSoft,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },
  checkboxChecked: {
    backgroundColor: colors.emerald,
    borderColor: colors.emerald,
  },
  rememberMeText: {
    fontSize: fontSize.sm,
    color: colors.ink,
    fontFamily: fontFamily.medium,
  },
});

const fp = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 220,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    width: "88%",
    maxWidth: 340,
    paddingTop: spacing.xxl + 4,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.xxl,
    position: "relative",
    alignItems: "center",
    ...shadow.raised,
  },
  closeBtn: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.mist,
    alignItems: "center",
    justifyContent: "center",
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.emeraldSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md + 2,
  },
  title: {
    fontSize: fontSize.lg + 1,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    textAlign: "center",
  },
  subtitle: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 19,
    paddingHorizontal: 4,
  },
  label: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
    marginBottom: 6,
    alignSelf: "flex-start",
  },
  inputWrapper: {
    width: "100%",
    position: "relative",
    justifyContent: "center",
  },
  inputIcon: {
    position: "absolute",
    left: 13,
    zIndex: 1,
  },
  input: {
    width: "100%",
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.emeraldSoft,
    backgroundColor: colors.mist,
    paddingVertical: 12,
    paddingLeft: 38,
    paddingRight: spacing.lg,
    color: colors.ink,
    fontFamily: fontFamily.medium,
    fontSize: fontSize.base - 1,
  },
  inputFocused: {
    borderColor: colors.emeraldBright,
    backgroundColor: colors.white,
  },
  errorText: {
    color: colors.error,
    fontSize: fontSize.xs + 1,
    fontFamily: fontFamily.medium,
    marginTop: 6,
    alignSelf: "flex-start",
  },
  submitBtn: {
    marginTop: spacing.xl,
    width: "100%",
    borderRadius: radius.md + 2,
    backgroundColor: colors.emerald,
    paddingVertical: 13,
    alignItems: "center",
    ...shadow.button,
  },
  submitText: {
    color: colors.white,
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    textAlign: "center",
  },
  successBox: {
    marginTop: spacing.md + 2,
    backgroundColor: colors.emeraldSoft,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "flex-start",
    width: "100%",
  },
  successIcon: {
    marginRight: spacing.sm,
    marginTop: 1,
  },
  successText: {
    fontSize: fontSize.xs + 1,
    fontFamily: fontFamily.medium,
    color: colors.emerald,
    lineHeight: 18,
    flex: 1,
  },
});
