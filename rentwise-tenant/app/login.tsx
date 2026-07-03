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
  Modal,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useState, useRef, useEffect } from "react";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { loginUser } from "../services/authService";
import { collection, query, where, getDocs, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../shared/firebaseConfig";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

export default function Login() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

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
          Animated.timing(pulseScale, {
            toValue: 1.04,
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseOpacity, {
            toValue: 0.15,
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(pulseScale, {
            toValue: 0.92,
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseOpacity, {
            toValue: 0.6,
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
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
    transform: [
      {
        translateY: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [18, 0],
        }),
      },
    ],
  });

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
        query(collection(db, "users"), where("email", "==", trimmed))
      );
      if (snap.empty) {
        setFpError("No account found with this email.");
        return;
      }
      const matched = snap.docs[0];
      const data = matched.data();
      await addDoc(collection(db, "passwordResetRequests"), {
        email: trimmed,
        tenantId: matched.id,
        tenantName: `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim(),
        spaceId: data.spaceId ?? data.stallId ?? "",
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

  async function handleLogin() {
    try {
      await loginUser(email, password);
      router.replace({ pathname: "/welcome" });
    } catch (error) {
      setErrorMsg("Incorrect email or password");
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: "#0F6E56" }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flex: 1, minHeight: SCREEN_HEIGHT }}>
          {/* Top green section */}
          <View style={[styles.topSection, { paddingTop: insets.top + 24 }]}>
            <Animated.View style={[styles.logoGroup, slideIn(logoAnim)]}>
              <Animated.View
                style={[
                  styles.pulseRing,
                  { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
                ]}
              />
              <View style={styles.logoCircle}>
                <Ionicons name="storefront-outline" size={28} color="#0F6E56" />
              </View>
            </Animated.View>
            <Animated.Text style={[styles.appName, slideIn(logoAnim)]}>
              RentWise
            </Animated.Text>
            <Animated.Text style={[styles.portalText, slideIn(logoAnim)]}>
              Tenant portal
            </Animated.Text>
          </View>

          {/* Bottom white card */}
          <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            {/* Heading group */}
            <Animated.View style={slideIn(headingAnim)}>
              <Text style={styles.heading}>Welcome Tenant</Text>
              <Text style={styles.subheading}>Sign in your account</Text>
            </Animated.View>

            {/* Email field */}
            <Animated.View style={[{ marginTop: 24 }, slideIn(emailAnim)]}>
              <Text style={styles.fieldLabel}>Email</Text>
              <View style={styles.inputWrapper}>
                <Ionicons
                  name="mail-outline"
                  size={17}
                  color="#1D9E75"
                  style={styles.leftIcon}
                />
                <TextInput
                  style={[styles.textInput, emailFocused && styles.textInputFocused]}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="username@rentwise.app"
                  placeholderTextColor="#B4B2A9"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                />
              </View>
            </Animated.View>

            {/* Password field */}
            <Animated.View style={[{ marginTop: 16 }, slideIn(passwordAnim)]}>
              <View style={styles.labelRow}>
                <Text style={styles.fieldLabel}>Password</Text>
              </View>
              <View style={styles.inputWrapper}>
                <Ionicons
                  name="lock-closed-outline"
                  size={17}
                  color="#1D9E75"
                  style={styles.leftIcon}
                />
                <TextInput
                  style={[styles.textInput, passwordFocused && styles.textInputFocused]}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  placeholder="Enter your Password"
                  placeholderTextColor="#B4B2A9"
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                />
                <Pressable
                  style={styles.rightIcon}
                  onPress={() => setShowPassword((v) => !v)}
                >
                  <Ionicons
                    name={showPassword ? "eye-outline" : "eye-off-outline"}
                    size={17}
                    color="#B4B2A9"
                  />
                </Pressable>
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
            {errorMsg ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            ) : null}

            {/* Sign in button */}
            <Animated.View style={[{ marginTop: 28 }, slideIn(buttonAnim)]}>
              <Pressable
                style={({ pressed }) => [
                  styles.signInBtn,
                  pressed && { backgroundColor: "#085041", transform: [{ scale: 0.98 }] },
                ]}
                onPress={handleLogin}
              >
                <Text style={styles.signInText}>Sign in</Text>
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
              {/* Close button */}
              <Pressable style={fp.closeBtn} onPress={closeForgotModal}>
                <Ionicons name="close" size={16} color="#5F5E5A" />
              </Pressable>

              {/* Header */}
              <View style={fp.iconCircle}>
                <Ionicons name="mail-outline" size={24} color="#0F6E56" />
              </View>
              <Text style={fp.title}>Forgot password</Text>
              <Text style={fp.subtitle}>
                Enter your registered email and we'll send your request to the admin.
              </Text>

              {/* Email field */}
              <View style={{ marginTop: 22, alignSelf: "stretch" }}>
                <Text style={fp.label}>Email</Text>
                <View style={fp.inputWrapper}>
                  <Ionicons
                    name="mail-outline"
                    size={16}
                    color="#1D9E75"
                    style={fp.inputIcon}
                  />
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

              {/* Submit / success */}
              {fpSuccess ? (
                <View style={fp.successBox}>
                  <Ionicons name="information-circle-outline" size={15} color="#0F6E56" style={fp.successIcon} />
                  <Text style={fp.successText}>
                    Request sent. The admin will contact you shortly.
                  </Text>
                </View>
              ) : (
                <Pressable
                  style={({ pressed }) => [
                    fp.submitBtn,
                    pressed && { backgroundColor: "#085041", transform: [{ scale: 0.97 }] },
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
    backgroundColor: "#0F6E56",
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
    backgroundColor: "#1D9E75",
  },
  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#E1F5EE",
    alignItems: "center",
    justifyContent: "center",
  },
  appName: {
    color: "#FFFFFF",
    fontSize: 26,
    fontWeight: "500",
  },
  portalText: {
    color: "#9FE1CB",
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
    color: "#085041",
  },
  subheading: {
    fontSize: 14,
    color: "#888780",
    marginTop: 2,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: "#0F6E56",
    marginBottom: 6,
  },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
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
    borderColor: "#9FE1CB",
    backgroundColor: "#f7fdf9",
    paddingVertical: 13,
    paddingLeft: 40,
    paddingRight: 40,
    color: "#085041",
    fontSize: 15,
  },
  textInputFocused: {
    borderColor: "#1D9E75",
  },
  errorBanner: {
    marginTop: 12,
    backgroundColor: "#FCEBEB",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  errorText: {
    fontSize: 13,
    color: "#A32D2D",
  },
  signInBtn: {
    width: "100%",
    borderRadius: 14,
    backgroundColor: "#0F6E56",
    paddingVertical: 15,
    alignItems: "center",
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
    color: "#1D9E75",
    fontWeight: "500",
  },
});

const fp = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(8,80,65,0.55)",
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
    backgroundColor: "#F1EFE8",
    alignItems: "center",
    justifyContent: "center",
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#E1F5EE",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  title: {
    fontSize: 19,
    fontWeight: "500",
    color: "#085041",
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
    color: "#0F6E56",
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
    borderColor: "#9FE1CB",
    backgroundColor: "#f7fdf9",
    paddingVertical: 12,
    paddingLeft: 38,
    paddingRight: 16,
    color: "#085041",
    fontSize: 14,
  },
  inputFocused: {
    borderColor: "#1D9E75",
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
    backgroundColor: "#0F6E56",
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
    backgroundColor: "#E1F5EE",
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
    color: "#0F6E56",
    lineHeight: 18,
    flex: 1,
  },
});
