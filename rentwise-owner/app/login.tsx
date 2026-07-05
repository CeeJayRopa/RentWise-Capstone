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
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useState, useRef, useEffect } from "react";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { loginUser } from "../shared/services/auth";
import { getUserByUsername } from "../shared/services/userServices";
import {
  checkLockout,
  recordFailedAttempt,
  resetLockout,
  formatLockoutRemaining,
} from "../shared/services/loginLockout";

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
      // Resolve email: try username lookup first, then treat input as direct email
      let email = identifier;
      const userDoc = await getUserByUsername(identifier, "owner");
      if (userDoc) {
        email = userDoc.email;
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
        <View style={{ flex: 1, minHeight: SCREEN_HEIGHT }}>

          {/* Top navy section */}
          <View style={[styles.topSection, { paddingTop: insets.top + 24 }]}>
            <Animated.View style={[styles.logoGroup, slideIn(logoAnim)]}>
              <Animated.View
                style={[
                  styles.pulseRing,
                  { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
                ]}
              />
              <View style={styles.logoCircle}>
                <Ionicons name="business-outline" size={28} color="#0C2D6B" />
              </View>
            </Animated.View>
            <Animated.Text style={[styles.appName, slideIn(logoAnim)]}>
              RentWise
            </Animated.Text>
            <Animated.Text style={[styles.portalText, slideIn(logoAnim)]}>
              Owner portal
            </Animated.Text>
          </View>

          {/* White card */}
          <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, 24) }]}>

            {/* Heading group */}
            <Animated.View style={slideIn(headingAnim)}>
              <Text style={styles.heading}>Welcome back</Text>
              <Text style={styles.subheading}>Sign in to manage your market</Text>
            </Animated.View>

            {/* Email field */}
            <Animated.View style={[{ marginTop: 24 }, slideIn(emailAnim)]}>
              <Text style={styles.fieldLabel}>Email</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="mail-outline" size={17} color="#2E6FD9" style={styles.leftIcon} />
                <TextInput
                  ref={emailInputRef}
                  style={[styles.textInput, emailFocused && styles.textInputFocused]}
                  value={username}
                  onChangeText={(t) => { setUsername(t); setError(""); }}
                  placeholder="username@rentwise.app"
                  placeholderTextColor="#B4B2A9"
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
            <Animated.View style={[{ marginTop: 16 }, slideIn(passwordAnim)]}>
              <View style={styles.labelRow}>
                <Text style={styles.fieldLabel}>Password</Text>
                <Pressable onPress={() => router.push("/owner-forgot-password")}>
                  <Text style={styles.forgotText}>Forgot password?</Text>
                </Pressable>
              </View>
              <View style={styles.inputWrapper}>
                <Ionicons name="lock-closed-outline" size={17} color="#2E6FD9" style={styles.leftIcon} />
                <TextInput
                  ref={passwordInputRef}
                  style={[styles.textInput, passwordFocused && styles.textInputFocused]}
                  value={password}
                  onChangeText={(t) => { setPassword(t); setError(""); }}
                  secureTextEntry={!showPassword}
                  placeholder="Enter your password"
                  placeholderTextColor="#B4B2A9"
                  editable={!loading && !lockoutUntil}
                  onFocus={() => { setPasswordFocused(true); scrollToRevealForm(); }}
                  onBlur={() => setPasswordFocused(false)}
                />
                <TouchableOpacity
                  style={styles.rightIcon}
                  onPress={() => setShowPassword((v) => !v)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={showPassword ? "eye-outline" : "eye-off-outline"}
                    size={17}
                    color="#B4B2A9"
                  />
                </TouchableOpacity>
              </View>
            </Animated.View>

            {/* Lockout / error banner */}
            {lockoutUntil ? (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle-outline" size={16} color="#A32D2D" style={{ marginRight: 8 }} />
                <Text style={styles.errorText}>
                  Too many failed attempts. Try again in {formatLockoutRemaining(lockoutUntil)}.
                </Text>
              </View>
            ) : !!error && (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle-outline" size={16} color="#A32D2D" style={{ marginRight: 8 }} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Sign in button */}
            <Animated.View ref={buttonRef} style={[{ marginTop: 28 }, slideIn(buttonAnim)]}>
              <Pressable
                style={({ pressed }) => [
                  styles.signInBtn,
                  (loading || !!lockoutUntil) && styles.signInBtnDisabled,
                  pressed && !loading && !lockoutUntil && { backgroundColor: "#091f4a", transform: [{ scale: 0.98 }] },
                ]}
                onPress={handleLogin}
                disabled={loading || !!lockoutUntil}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
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
    height: SCREEN_HEIGHT * 0.38,
    backgroundColor: "#0C2D6B",
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
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
    backgroundColor: "#7AAEF0",
  },

  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#E6F1FB",
    alignItems: "center",
    justifyContent: "center",
  },

  appName: {
    color: "#FFFFFF",
    fontSize: 26,
    fontWeight: "500",
  },

  portalText: {
    color: "#B5D4F4",
    fontSize: 13,
    marginTop: 4,
  },

  card: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -16,
    paddingHorizontal: 28,
    paddingTop: 28,
  },

  heading: {
    fontSize: 22,
    fontWeight: "500",
    color: "#0C2D6B",
  },

  subheading: {
    fontSize: 14,
    color: "#888780",
    marginTop: 2,
  },

  fieldLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: "#1A4DA0",
    marginBottom: 6,
  },

  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },

  forgotText: {
    fontSize: 12,
    color: "#2E6FD9",
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
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#B5D4F4",
    backgroundColor: "#F0F4FA",
    paddingVertical: 13,
    paddingLeft: 40,
    paddingRight: 40,
    color: "#0C2D6B",
    fontSize: 15,
  },

  textInputFocused: {
    borderColor: "#2E6FD9",
  },

  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    backgroundColor: "#FCEBEB",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },

  errorText: {
    fontSize: 13,
    color: "#A32D2D",
    flex: 1,
  },

  signInBtn: {
    width: "100%",
    borderRadius: 14,
    backgroundColor: "#0C2D6B",
    paddingVertical: 15,
    alignItems: "center",
  },

  signInBtnDisabled: {
    opacity: 0.5,
  },

  signInText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "500",
    textAlign: "center",
  },
});
