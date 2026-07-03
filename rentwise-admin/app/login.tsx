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
  Platform,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useState, useRef, useEffect } from "react";
import { router } from "expo-router";
import { ShieldCheck, Mail, Lock, Eye, EyeOff, AlertCircle, X, Info } from "lucide-react-native";
import { collection, query, where, getDocs, addDoc, serverTimestamp } from "firebase/firestore";

import { loginUser } from "../shared/services/auth";
import { getUserByUsername } from "../shared/services/userServices";
import { db } from "../shared/services/firestore";

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
    if (!username.trim() || !password.trim()) {
      setError("Please enter your username and password.");
      return;
    }
    setLoading(true);
    try {
      let email = username.trim();
      const userDoc = await getUserByUsername(username.trim());
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
      router.replace("/welcome");
    } catch {
      setError("Invalid username or password.");
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
      style={{ flex: 1, backgroundColor: "#0C2D6B" }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
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
                <ShieldCheck size={28} color="#0C2D6B" />
              </View>
            </Animated.View>
            <Animated.Text style={[styles.appName, slideIn(logoAnim)]}>
              RentWise
            </Animated.Text>
            <Animated.Text style={[styles.portalText, slideIn(logoAnim)]}>
              Admin portal
            </Animated.Text>
          </View>

          {/* White card */}
          <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, 24) }]}>

            {/* Heading group */}
            <Animated.View style={slideIn(headingAnim)}>
              <Text style={styles.heading}>Welcome back</Text>
              <Text style={styles.subheading}>Sign in to manage your platform</Text>
            </Animated.View>

            {/* Email field */}
            <Animated.View style={[{ marginTop: 24 }, slideIn(emailAnim)]}>
              <Text style={styles.fieldLabel}>Email</Text>
              <View style={styles.inputWrapper}>
                <Mail size={17} color="#2E6FD9" style={styles.leftIcon} />
                <TextInput
                  style={[styles.textInput, emailFocused && styles.textInputFocused]}
                  value={username}
                  onChangeText={(t) => { setUsername(t); setError(""); }}
                  placeholder="username@rentwise.app"
                  placeholderTextColor="#B4B2A9"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  editable={!loading}
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                />
              </View>
            </Animated.View>

            {/* Password field */}
            <Animated.View style={[{ marginTop: 16 }, slideIn(passwordAnim)]}>
              <Text style={styles.fieldLabel}>Password</Text>
              <View style={styles.inputWrapper}>
                <Lock size={17} color="#2E6FD9" style={styles.leftIcon} />
                <TextInput
                  style={[styles.textInput, passwordFocused && styles.textInputFocused]}
                  value={password}
                  onChangeText={(t) => { setPassword(t); setError(""); }}
                  secureTextEntry={!showPassword}
                  placeholder="Enter your password"
                  placeholderTextColor="#B4B2A9"
                  editable={!loading}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                />
                <TouchableOpacity
                  style={styles.rightIcon}
                  onPress={() => setShowPassword((v) => !v)}
                  activeOpacity={0.7}
                >
                  {showPassword ? <Eye size={17} color="#B4B2A9" /> : <EyeOff size={17} color="#B4B2A9" />}
                </TouchableOpacity>
              </View>
            </Animated.View>

            {/* Forgot password link */}
            <Pressable
              style={styles.forgotLink}
              onPress={() => setShowForgotModal(true)}
            >
              <Text style={styles.forgotLinkText}>Forgot password?</Text>
            </Pressable>

            {/* Error banner */}
            {!!error && (
              <View style={styles.errorBanner}>
                <AlertCircle size={16} color="#A32D2D" style={{ marginRight: 8 }} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Sign in button */}
            <Animated.View style={[{ marginTop: 28 }, slideIn(buttonAnim)]}>
              <Pressable
                style={({ pressed }) => [
                  styles.signInBtn,
                  loading && styles.signInBtnDisabled,
                  pressed && !loading && { backgroundColor: "#091f4a", transform: [{ scale: 0.98 }] },
                ]}
                onPress={handleLogin}
                disabled={loading}
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

      {/* FORGOT PASSWORD MODAL */}
      <Modal
        visible={showForgotModal}
        transparent
        animationType="fade"
        onRequestClose={closeForgotModal}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={fp.overlay}>
            <View style={fp.card}>
              <Pressable style={fp.closeBtn} onPress={closeForgotModal}>
                <X size={16} color="#5F5E5A" />
              </Pressable>

              <View style={fp.iconCircle}>
                <Mail size={24} color="#0C2D6B" />
              </View>
              <Text style={fp.title}>Forgot password</Text>
              <Text style={fp.subtitle}>
                Enter your admin email and we'll send your request to the owner.
              </Text>

              <View style={{ marginTop: 22, alignSelf: "stretch" }}>
                <Text style={fp.label}>Email</Text>
                <View style={fp.inputWrapper}>
                  <Mail size={16} color="#2E6FD9" style={fp.inputIcon} />
                  <TextInput
                    style={[fp.input, fpEmailFocused && fp.inputFocused]}
                    value={fpEmail}
                    onChangeText={(t) => { setFpEmail(t); setFpError(null); }}
                    placeholder="username@rentwise.app"
                    placeholderTextColor="#B4B2A9"
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
                  <Info size={15} color="#0C2D6B" style={fp.successIcon} />
                  <Text style={fp.successText}>
                    Request sent. The owner will contact you shortly.
                  </Text>
                </View>
              ) : (
                <Pressable
                  style={({ pressed }) => [
                    fp.submitBtn,
                    pressed && { backgroundColor: "#091f4a", transform: [{ scale: 0.97 }] },
                  ]}
                  onPress={handleForgotSubmit}
                  disabled={fpLoading}
                >
                  {fpLoading
                    ? <ActivityIndicator color="#fff" />
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
    borderRadius: 24,
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

  forgotLink: {
    alignSelf: "flex-end",
    marginTop: 10,
  },

  forgotLinkText: {
    fontSize: 13,
    color: "#2E6FD9",
    fontWeight: "500",
  },
});

const fp = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(12,45,107,0.55)",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 120,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 20,
    width: "88%",
    maxWidth: 340,
    paddingTop: 28,
    paddingBottom: 24,
    paddingHorizontal: 24,
    position: "relative",
    alignItems: "center",
  },
  closeBtn: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#F0F4FA",
    alignItems: "center",
    justifyContent: "center",
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#E6F1FB",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  title: {
    fontSize: 19,
    fontWeight: "500",
    color: "#0C2D6B",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 13,
    color: "#888780",
    textAlign: "center",
    marginTop: 6,
    lineHeight: 19,
    paddingHorizontal: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: "500",
    color: "#1A4DA0",
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
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#B5D4F4",
    backgroundColor: "#F0F4FA",
    paddingVertical: 12,
    paddingLeft: 38,
    paddingRight: 16,
    color: "#0C2D6B",
    fontSize: 14,
  },
  inputFocused: {
    borderColor: "#2E6FD9",
  },
  errorText: {
    color: "#A32D2D",
    fontSize: 12,
    marginTop: 6,
    alignSelf: "flex-start",
  },
  submitBtn: {
    marginTop: 20,
    width: "100%",
    borderRadius: 14,
    backgroundColor: "#0C2D6B",
    paddingVertical: 13,
    alignItems: "center",
  },
  submitText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "500",
    textAlign: "center",
  },
  successBox: {
    marginTop: 14,
    backgroundColor: "#E6F1FB",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    width: "100%",
  },
  successIcon: {
    marginRight: 8,
    marginTop: 1,
  },
  successText: {
    fontSize: 12,
    color: "#0C2D6B",
    lineHeight: 18,
    flex: 1,
  },
});
