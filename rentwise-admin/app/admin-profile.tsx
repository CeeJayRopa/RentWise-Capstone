import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  Alert,
  ScrollView,
  Modal,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { House, HelpCircle, CheckCircle2, LogOut } from "lucide-react-native";

import { auth, logoutUser } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import { setRememberMe } from "../shared/services/rememberMe";
import HelpTour, { HelpStep } from "./components/HelpTour";
import { hasSeenPageTour, markPageTourSeen } from "../shared/services/onboardingTour";
import { Avatar, Card } from "../shared/components/ui";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../shared/theme";

export default function AdminProfile() {
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [contactNo, setContactNo] = useState("");

  // Confirmation gate before Save changes actually runs.
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);

  const [focusedField, setFocusedField] = useState<string | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(20)).current;
  const originalRef = useRef({ firstName: "", lastName: "", contactNo: "" });
  const [tourVisible, setTourVisible] = useState(false);

  const homeRef = useRef<View>(null);
  const helpRef = useRef<View>(null);
  const fieldsRef = useRef<View>(null);
  const editBtnRef = useRef<View>(null);
  const logoutBtnRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const scrollViewHeightRef = useRef(0);

  // Always scrolls to the SAME fixed target -- the Edit/Save button below
  // the fields -- same approach as the login screen, so the field being
  // typed into (plus the button beneath it) stays clear of the keyboard.
  // The target is computed against the ScrollView's OWN current height
  // (shrunk by KeyboardAvoidingView once the keyboard is up), not a
  // guessed pixel constant.
  function scrollToRevealForm() {
    setTimeout(() => {
      const target = editBtnRef.current;
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
    // fixed delay can land short if the OS is still resizing the window --
    // scroll again once the keyboard is confirmed fully shown.
    const showSub = Keyboard.addListener("keyboardDidShow", () => {
      scrollToRevealForm();
    });
    // Once the keyboard is dismissed (done typing / tapped away), scroll
    // back up to where the page started instead of leaving it stuck down
    // near the button.
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Scrolls a given section into view and gives the ScrollView time to
  // settle before HelpTour measures it — otherwise a section below the
  // fold (e.g. the logout button on a short screen) would measure to its
  // stale, off-screen position instead of where it actually ends up.
  const scrollSectionIntoView = (targetRef: React.RefObject<View | null>) =>
    new Promise<void>((resolve) => {
      const scrollNode = scrollRef.current?.getNativeScrollRef?.();
      if (!scrollNode || !targetRef.current) { resolve(); return; }
      targetRef.current.measureLayout(
        scrollNode as any,
        (_x: number, y: number) => {
          scrollRef.current?.scrollTo({ y: Math.max(0, y - 100), animated: true });
          setTimeout(resolve, 400);
        },
        () => resolve(),
      );
    });

  const tourSteps: HelpStep[] = [
    { key: "home", ref: homeRef, title: "Home", description: "Takes you back to the dashboard.", edgeInset: "top", round: true },
    { key: "fields", ref: fieldsRef, title: "Your details", description: "Your last name, first name, and contact number.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(fieldsRef), heightTrimPercent: 0.05 },
    { key: "edit", ref: editBtnRef, title: "Edit Profile", description: "Unlocks your name and contact number so you can update them.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(editBtnRef), heightTrimPercent: 0.12, nudgeYPercent: 0.01 },
    { key: "logout", ref: logoutBtnRef, title: "Logout", description: "Signs you out of your admin account.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(logoutBtnRef), heightTrimPercent: 0.02, nudgeYPercent: 0.01 },
  ];

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      router.replace("/");
      return;
    }
    loadProfile(user.uid);
  }, []);

  // Auto-opens the guided tour the first time the admin ever lands on this
  // page — never again after that, since it flips a persisted per-device
  // flag. Can still be replayed anytime via the Help button.
  useEffect(() => {
    if (loading) return;
    (async () => {
      const seen = await hasSeenPageTour("admin-profile");
      if (!seen) {
        setTourVisible(true);
        await markPageTourSeen("admin-profile");
      }
    })();
  }, [loading]);

  useEffect(() => {
    if (!saved) return;
    fadeAnim.setValue(0);
    toastTranslateY.setValue(20);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 450, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(toastTranslateY, { toValue: 0, duration: 450, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]),
      Animated.delay(1000),
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 0, duration: 450, easing: Easing.in(Easing.back(1.5)), useNativeDriver: true }),
        Animated.timing(toastTranslateY, { toValue: -10, duration: 450, easing: Easing.in(Easing.back(1.5)), useNativeDriver: true }),
      ]),
    ]).start(() => setSaved(false));
  }, [saved]);

  const loadProfile = async (uid: string) => {
    try {
      const snap = await getDoc(doc(db, "users", uid));
      if (snap.exists()) {
        const data = snap.data();
        const fn = data.firstName ?? "";
        const ln = data.lastName ?? "";
        const cn = data.contactNo ?? "";
        setFirstName(fn);
        setLastName(ln);
        setContactNo(cn);
        originalRef.current = { firstName: fn, lastName: ln, contactNo: cn };
      }
    } catch (err) {
      console.error("ADMIN PROFILE LOAD ERROR:", err);
    } finally {
      setLoading(false);
    }
  };

  const hasChanges =
    firstName.trim() !== originalRef.current.firstName ||
    lastName.trim() !== originalRef.current.lastName ||
    contactNo.trim() !== originalRef.current.contactNo;

  const hasEmptyField =
    !firstName.trim() || !lastName.trim() || !contactNo.trim();

  const handleSave = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const fn = firstName.trim();
    const ln = lastName.trim();
    const cn = contactNo.trim();

    if (!fn || !ln || !cn) {
      Alert.alert("Missing Information", "All fields are required.");
      return;
    }

    setSaving(true);
    try {
      await updateDoc(doc(db, "users", user.uid), {
        firstName: fn,
        lastName: ln,
        contactNo: cn,
      });
      originalRef.current = { firstName: fn, lastName: ln, contactNo: cn };
      setIsEditing(false);
      setSaved(true);
    } catch (err) {
      console.error("ADMIN PROFILE SAVE ERROR:", err);
      Alert.alert("Error", "Failed to update profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  function handleCancelEditProfile() {
    setFirstName(originalRef.current.firstName);
    setLastName(originalRef.current.lastName);
    setContactNo(originalRef.current.contactNo);
    setIsEditing(false);
  }

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logoutUser();
      await setRememberMe(false);
      router.replace("/");
    } finally {
      setLoggingOut(false);
      setShowLogoutConfirm(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator color={colors.emerald} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* HEADER */}
      <LinearGradient
        colors={[colors.emerald, colors.ink]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
          <View ref={homeRef} collapsable={false}>
            <TouchableOpacity onPress={() => router.push("/dashboard")} activeOpacity={0.7} style={styles.headerIconBtn}>
              <House size={24} color={colors.emeraldSoft} />
            </TouchableOpacity>
          </View>
          <Text style={styles.headerTitle}>RentWise</Text>
          <View ref={helpRef} collapsable={false}>
            <TouchableOpacity onPress={() => setTourVisible(true)} activeOpacity={0.7} style={styles.headerIconBtn}>
              <HelpCircle size={24} color={colors.emeraldSoft} />
            </TouchableOpacity>
          </View>
        </View>
      </LinearGradient>

      {/* BODY */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
      <ScrollView
        ref={scrollRef}
        style={styles.body}
        contentContainerStyle={[
          styles.bodyContent,
          { paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onLayout={(e) => { scrollViewHeightRef.current = e.nativeEvent.layout.height; }}
      >
        {/* IDENTITY CARD */}
        <Card style={styles.identityCard}>
          <View style={styles.identityInner}>
            <Avatar name={`${firstName} ${lastName}`} size={90} />
            <Text style={styles.identityName}>
              {firstName} {lastName}
            </Text>
            <Text style={styles.identityRole}>Market Administrator</Text>
          </View>
        </Card>

        {/* FIELDS CARD */}
        <View ref={fieldsRef} collapsable={false}>
        <Card style={styles.fieldsCard}>
          {/* LAST NAME */}
          <Text style={styles.fieldLabel}>Last name</Text>
          <TextInput
            style={[
              styles.input,
              focusedField === "lastName" && styles.inputFocused,
              !isEditing && styles.inputReadOnly,
            ]}
            value={lastName}
            onChangeText={setLastName}
            placeholder="Enter last name"
            placeholderTextColor={colors.textMuted}
            onFocus={() => { setFocusedField("lastName"); scrollToRevealForm(); }}
            onBlur={() => setFocusedField(null)}
            editable={isEditing && !saving}
          />

          {/* FIRST NAME */}
          <Text style={styles.fieldLabel}>First name</Text>
          <TextInput
            style={[
              styles.input,
              focusedField === "firstName" && styles.inputFocused,
              !isEditing && styles.inputReadOnly,
            ]}
            value={firstName}
            onChangeText={setFirstName}
            placeholder="Enter first name"
            placeholderTextColor={colors.textMuted}
            onFocus={() => { setFocusedField("firstName"); scrollToRevealForm(); }}
            onBlur={() => setFocusedField(null)}
            editable={isEditing && !saving}
          />

          {/* CONTACT NO. */}
          <Text style={styles.fieldLabel}>Contact no.</Text>
          <View
            style={[
              styles.phoneRow,
              styles.phoneRowLast,
              focusedField === "contactNo" && styles.phoneRowFocused,
              !isEditing && styles.phoneRowReadOnly,
            ]}
          >
            <View style={styles.phonePrefix}>
              <Text style={styles.phonePrefixText}>+63</Text>
            </View>
            <TextInput
              style={[styles.phoneInput, !isEditing && styles.inputReadOnly]}
              value={contactNo}
              onChangeText={(t) => setContactNo(t.replace(/\D/g, "").slice(0, 10))}
              keyboardType="phone-pad"
              placeholder="9XXXXXXXXX"
              placeholderTextColor={colors.textMuted}
              onFocus={() => { setFocusedField("contactNo"); scrollToRevealForm(); }}
              onBlur={() => setFocusedField(null)}
              editable={isEditing && !saving}
            />
          </View>
        </Card>
        </View>

        {/* EDIT / SAVE BUTTON */}
        <View ref={editBtnRef} collapsable={false}>
          {isEditing ? (
            <View style={styles.pwActionsRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.pwCancelBtn,
                  pressed && { backgroundColor: colors.error, borderColor: colors.error, transform: [{ scale: 0.97 }] },
                ]}
                onPress={handleCancelEditProfile}
                disabled={saving}
              >
                {({ pressed }) => (
                  <Text style={[styles.pwCancelBtnText, pressed && styles.pwCancelBtnTextPressed]}>Cancel</Text>
                )}
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.saveBtn,
                  styles.pwUpdateBtn,
                  (!hasChanges || hasEmptyField || saving) && styles.saveBtnDisabled,
                  pressed &&
                    hasChanges &&
                    !hasEmptyField &&
                    !saving && { backgroundColor: colors.white, transform: [{ scale: 0.97 }] },
                ]}
                onPress={() => setShowSaveConfirm(true)}
                disabled={!hasChanges || hasEmptyField || saving}
              >
                {({ pressed }) =>
                  saving ? (
                    <ActivityIndicator color={colors.white} size="small" />
                  ) : (
                    <Text
                      style={[
                        styles.saveBtnText,
                        styles.pwUpdateBtnText,
                        pressed && hasChanges && !hasEmptyField && styles.pwUpdateBtnTextPressed,
                      ]}
                    >
                      Save changes
                    </Text>
                  )
                }
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.saveBtn, pressed && styles.saveBtnPressed]}
              onPress={() => setIsEditing(true)}
            >
              <Text style={styles.saveBtnText}>Edit Profile</Text>
            </Pressable>
          )}
        </View>

        {/* LOGOUT */}
        <View ref={logoutBtnRef} collapsable={false}>
        <Pressable
          style={({ pressed }) => [
            styles.logoutBtn,
            pressed && { backgroundColor: colors.error, borderColor: colors.error, transform: [{ scale: 0.97 }] },
          ]}
          onPress={() => setShowLogoutConfirm(true)}
        >
          {({ pressed }) => (
            <>
              <LogOut size={18} color={pressed ? colors.white : colors.error} style={{ marginRight: spacing.sm + 2 }} />
              <Text style={[styles.logoutBtnText, pressed && styles.logoutBtnTextPressed]}>Logout Account</Text>
            </>
          )}
        </Pressable>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      {/* SUCCESS TOAST */}
      {saved && (
        <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
          <Animated.View style={[styles.toast, { transform: [{ translateY: toastTranslateY }] }]}>
            <CheckCircle2 size={22} color={colors.emeraldBright} />
            <Text style={styles.toastText}>Profile Updated</Text>
          </Animated.View>
        </Animated.View>
      )}

      <HelpTour
        visible={tourVisible}
        steps={tourSteps}
        onClose={() => {
          setTourVisible(false);
          // The tour auto-scrolls down to reach later steps — scroll back
          // to the top once it's done so the admin isn't left mid-page.
          scrollRef.current?.scrollTo({ y: 0, animated: true });
        }}
      />

      {/* LOGOUT CONFIRMATION MODAL */}
      <Modal
        visible={showLogoutConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!loggingOut) setShowLogoutConfirm(false); }}
      >
        <View style={styles.alertOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => { if (!loggingOut) setShowLogoutConfirm(false); }}
          />
          <View style={styles.alertCard}>
            <View style={styles.alertBody}>
              <Text style={styles.alertTitle}>Logout</Text>
              <Text style={styles.alertMessage}>Are you sure you want to logout?</Text>
            </View>
            <View style={styles.alertDivider} />
            <View style={styles.alertBtnRow}>
              <Pressable
                style={({ pressed }) => [styles.alertBtn, pressed && !loggingOut && styles.alertBtnCancelPressed]}
                onPress={() => setShowLogoutConfirm(false)}
                disabled={loggingOut}
              >
                {({ pressed }) => (
                  <Text style={[styles.alertBtnCancelText, pressed && !loggingOut && styles.alertBtnCancelTextPressed]}>Cancel</Text>
                )}
              </Pressable>
              <View style={styles.alertBtnDivider} />
              <Pressable
                style={({ pressed }) => [styles.alertBtn, pressed && !loggingOut && styles.alertBtnConfirmPressed]}
                onPress={handleLogout}
                disabled={loggingOut}
              >
                {({ pressed }) =>
                  loggingOut ? (
                    <ActivityIndicator color={colors.emerald} size="small" />
                  ) : (
                    <Text style={[styles.alertBtnConfirmText, pressed && styles.alertBtnConfirmTextPressed]}>Confirm</Text>
                  )
                }
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* SAVE CHANGES CONFIRMATION MODAL */}
      <Modal
        visible={showSaveConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSaveConfirm(false)}
      >
        <View style={styles.alertOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowSaveConfirm(false)} />
          <View style={styles.alertCard}>
            <View style={styles.alertBody}>
              <Text style={styles.alertTitleNeutral}>Save changes?</Text>
              <Text style={styles.alertMessage}>Are you sure you want to update your profile information?</Text>
            </View>
            <View style={styles.alertDivider} />
            <View style={styles.alertBtnRow}>
              <Pressable
                style={({ pressed }) => [styles.alertBtn, pressed && styles.alertBtnCancelPressed]}
                onPress={() => setShowSaveConfirm(false)}
              >
                {({ pressed }) => (
                  <Text style={[styles.alertBtnCancelText, pressed && styles.alertBtnCancelTextPressed]}>Cancel</Text>
                )}
              </Pressable>
              <View style={styles.alertBtnDivider} />
              <Pressable
                style={({ pressed }) => [styles.alertBtn, pressed && styles.alertBtnConfirmPressed]}
                onPress={() => {
                  setShowSaveConfirm(false);
                  handleSave();
                }}
              >
                {({ pressed }) => (
                  <Text style={[styles.alertBtnConfirmText, pressed && styles.alertBtnConfirmTextPressed]}>Continue</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.parchment,
  },

  fullCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.parchment,
  },

  // ── Header ────────────────────────────────────────────────────────────────────

  headerGradient: {
    borderBottomLeftRadius: radius.xl + 4,
    borderBottomRightRadius: radius.xl + 4,
    overflow: "hidden",
  },
  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },

  header: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md + 2,
    flexDirection: "row",
    alignItems: "center",
  },

  headerTitle: {
    color: colors.white,
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
    flex: 1,
    textAlign: "center",
  },

  // ── Body ─────────────────────────────────────────────────────────────────────

  body: {
    flex: 1,
  },

  bodyContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
  },

  // ── Identity card ─────────────────────────────────────────────────────────────

  identityCard: {
    marginBottom: spacing.lg,
  },

  identityInner: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.sm,
  },

  identityName: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.extrabold,
    color: colors.ink,
    marginTop: spacing.lg,
  },

  identityRole: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // ── Fields card ───────────────────────────────────────────────────────────────

  fieldsCard: {
    marginBottom: spacing.lg,
  },

  fieldLabel: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: spacing.sm - 2,
  },

  input: {
    backgroundColor: colors.mist,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 1,
    fontSize: fontSize.base,
    fontFamily: fontFamily.medium,
    color: colors.ink,
    marginBottom: spacing.lg,
  },

  inputFocused: {
    borderColor: colors.emeraldBright,
    backgroundColor: colors.white,
  },

  inputReadOnly: {
    backgroundColor: colors.mist,
    borderColor: colors.border,
    color: colors.textSecondary,
  },

  // ── Phone row ─────────────────────────────────────────────────────────────────

  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.mist,
    overflow: "hidden",
    marginBottom: spacing.lg,
  },

  phoneRowLast: {
    marginBottom: 0,
  },

  phoneRowFocused: {
    borderColor: colors.emeraldBright,
    backgroundColor: colors.white,
  },

  phoneRowReadOnly: {
    backgroundColor: colors.mist,
    borderColor: colors.border,
  },

  phonePrefix: {
    backgroundColor: colors.emeraldSoft,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md + 1,
    borderRightWidth: 1,
    borderRightColor: colors.emeraldSoft,
    justifyContent: "center",
  },

  phonePrefixText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },

  phoneInput: {
    flex: 1,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md + 1,
    fontSize: fontSize.base,
    fontFamily: fontFamily.medium,
    color: colors.ink,
  },

  // ── Save button ───────────────────────────────────────────────────────────────

  saveBtn: {
    width: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
    transform: [{ scale: 1 }],
    ...shadow.button,
  },

  saveBtnPressed: {
    backgroundColor: colors.emerald,
    transform: [{ scale: 0.97 }],
  },

  saveBtnDisabled: {
    opacity: 0.45,
  },

  saveBtnText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    textAlign: "center",
  },

  // ── Save/Cancel row (shown while editing) ────────────────────────────
  pwActionsRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.sm,
  },

  pwCancelBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: 16,
    backgroundColor: colors.white,
    ...shadow.card,
  },

  pwCancelBtnText: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    color: colors.textSecondary,
  },

  pwCancelBtnTextPressed: {
    color: colors.white,
  },

  pwUpdateBtn: {
    flex: 1,
    marginTop: 0,
  },

  pwUpdateBtnText: {
    fontSize: fontSize.md,
  },

  pwUpdateBtnTextPressed: {
    color: colors.emerald,
  },

  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.errorSoft,
    paddingVertical: 16,
    marginTop: spacing.md,
  },
  logoutBtnPressed: {
    opacity: 0.7,
  },
  logoutBtnText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    color: colors.error,
  },

  logoutBtnTextPressed: {
    color: colors.white,
  },

  // ── Toast ─────────────────────────────────────────────────────────────────────

  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    alignItems: "center",
  },

  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.white,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    ...shadow.raised,
  },

  toastText: {
    color: colors.ink,
    fontSize: fontSize.md,
    fontFamily: fontFamily.semibold,
  },

  // ── Logout confirmation alert ────────────────────────────────────────────

  alertOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xxl,
  },

  alertCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    width: 270,
    overflow: "hidden",
    ...shadow.raised,
  },

  alertBody: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    alignItems: "center",
  },

  alertTitle: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    color: colors.error,
    textAlign: "center",
  },

  alertTitleNeutral: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    textAlign: "center",
  },

  alertMessage: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    color: colors.ink,
    textAlign: "center",
    marginTop: spacing.sm,
    lineHeight: 19,
  },

  alertDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },

  alertBtnRow: {
    flexDirection: "row",
  },

  alertBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },

  alertBtnDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },

  alertBtnCancelPressed: {
    backgroundColor: colors.error,
  },

  alertBtnCancelText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.regular,
    color: colors.textMuted,
  },

  alertBtnCancelTextPressed: {
    color: colors.white,
  },

  alertBtnConfirmPressed: {
    backgroundColor: colors.emerald,
  },

  alertBtnConfirmText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },

  alertBtnConfirmTextPressed: {
    color: colors.white,
  },
});
