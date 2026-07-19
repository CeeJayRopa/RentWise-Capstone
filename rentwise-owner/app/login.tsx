import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Animated,
  Easing,
  Pressable,
  useWindowDimensions,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useState, useRef, useEffect } from "react";
import { router } from "expo-router";
import { Mail, Lock, Eye, EyeOff, AlertCircle, Check } from "lucide-react-native";

import { loginUser } from "../shared/services/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { firebaseApp } from "../shared/firebaseConfig";
import {
  checkLockout,
  recordFailedAttempt,
  resetLockout,
  formatLockoutRemaining,
} from "../shared/services/loginLockout";
import { setRememberMe } from "../shared/services/rememberMe";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../shared/theme";

const cloudFunctions = getFunctions(firebaseApp);

export default function Login() {
  const insets = useSafeAreaInsets();
  // Live window height, not a one-time Dimensions.get() snapshot -- see
  // HelpTour.tsx for why a module-level constant can be stale on some
  // devices (e.g. split-screen, foldables, resizable windows).
  const { height: screenHeight } = useWindowDimensions();
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
  const scrollViewHeightRef = useRef(screenHeight);

  // Always scrolls to the SAME fixed target — the sign-in button — no matter
  // which of the two fields was tapped. Measuring each field individually
  // used to land in a different spot depending on whether the keyboard was
  // already open (email vs. password), which looked inconsistent.
  //
  // The target is computed against the ScrollView's OWN current height
  // (which KeyboardAvoidingView actually shrinks once the keyboard is up),
  // not a guessed pixel constant — a fixed offset would either undershoot
  // on tall keyboards or overshoot far enough to scroll the entire green
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
    const sub = Keyboard.addListener("keyboardDidShow", scrollToRevealForm);
    return () => sub.remove();
  }, []);

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
      // Resolve email: try username lookup first, then treat input as direct
      // email. Server-side (Cloud Function) instead of a direct client-side
      // `users` read -- that read required `users` to stay publicly
      // queryable, which leaked every user's name/email/phone to anyone.
      let email = identifier;
      const resolveEmail = httpsCallable(cloudFunctions, "resolveLoginEmail");
      const resolved: any = await resolveEmail({ identifier, role: "owner" });
      if (resolved.data?.email) {
        email = resolved.data.email;
      }
      // loginUser will throw if credentials are wrong
      const result = await loginUser(email, password);
      // Verify the signed-in account is actually an owner
      const { getUserRole } = await import("../shared/services/userServices");
      const role = await getUserRole(result.uid);
      if (role !== "owner") {
        const { logoutUser } = await import("../shared/services/auth");
        await logoutUser();
        setError("Access denied. Owner account required.");
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
            "It seems that you really forgot the password, please click the forgot password and answer your 3 security questions to recover it.",
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
        <View style={{ flex: 1, minHeight: screenHeight }}>

          {/* Top gradient hero */}
          <LinearGradient
            colors={[colors.emerald, colors.ink]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.topSection, { paddingTop: insets.top + spacing.xxxl }]}
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
              Owner portal
            </Animated.Text>
          </LinearGradient>

          {/* White card */}
          <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, 24) }]}>

            {/* Heading group */}
            <Animated.View style={slideIn(headingAnim)}>
              <Text style={styles.heading}>Welcome back</Text>
              <Text style={styles.subheading}>Sign in to manage your market</Text>
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
              <View style={styles.labelRow}>
                <Text style={styles.fieldLabel}>Password</Text>
                <Pressable onPress={() => router.push("/owner-forgot-password")}>
                  <Text style={styles.forgotText}>Forgot password?</Text>
                </Pressable>
              </View>
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

              {/* Remember me */}
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
            </Animated.View>

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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  topSection: {
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

  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },

  forgotText: {
    fontSize: fontSize.xs + 1,
    color: colors.emeraldBright,
    fontFamily: fontFamily.semibold,
  },

  rememberMeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.md,
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
});
