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
import { doc, onSnapshot } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { House, HelpCircle, CheckCircle2, LogOut, BadgeCheck, Contact, Pencil } from "lucide-react-native";

import { auth, logoutUser } from "../shared/services/auth";
import { clearLocalCache } from "../shared/services/localCache";
import { db } from "../shared/services/firestore";
import { firebaseApp } from "../shared/firebaseConfig";
import { setRememberMe } from "../shared/services/rememberMe";
import HelpTour, { HelpStep } from "./components/HelpTour";
import HelpSupportModal from "./components/HelpSupportModal";
import { hasSeenPageTour, markPageTourSeen } from "../shared/services/onboardingTour";
import { Card } from "../shared/components/ui";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../shared/theme";

const RENTWISE_ADMIN_USERNAME = "RWADMIN";

export default function AdminProfile() {
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const isEditingRef = useRef(false);

  const setEditingMode = (value: boolean) => {
    isEditingRef.current = value;
    setIsEditing(value);
  };

  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [contactNo, setContactNo] = useState("");

  // Confirmation gate before Save changes actually runs.
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);

  const [focusedField, setFocusedField] = useState<string | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(20)).current;
  const originalRef = useRef({ firstName: "", middleName: "", lastName: "", contactNo: "" });
  const [tourVisible, setTourVisible] = useState(false);
  const [helpSupportVisible, setHelpSupportVisible] = useState(false);

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
    { key: "fields", ref: fieldsRef, title: "Your details", description: "Your last name, first name, middle name, and contact number.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(fieldsRef), heightTrimPercent: 0.05 },
    { key: "edit", ref: editBtnRef, title: "Edit Profile", description: "Unlocks your name and contact number so you can update them.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(editBtnRef), heightTrimPercent: 0.12, nudgeYPercent: 0.01 },
    { key: "logout", ref: logoutBtnRef, title: "Logout", description: "Signs you out of your admin account.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(logoutBtnRef), heightTrimPercent: 0.02, nudgeYPercent: 0.01 },
  ];

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      router.replace("/");
      return;
    }

    setLoading(true);
    return onSnapshot(
      doc(db, "users", user.uid),
      (snap) => {
        if (snap.exists() && !isEditingRef.current) {
          const data = snap.data();
          const fn = data.firstName ?? "";
          const mn = data.middleName ?? "";
          const ln = data.lastName ?? "";
          const cn = data.contactNo ?? "";
          setFirstName(fn);
          setMiddleName(mn);
          setLastName(ln);
          setContactNo(cn);
          originalRef.current = { firstName: fn, middleName: mn, lastName: ln, contactNo: cn };
        }
        setLoading(false);
      },
      (err) => {
        console.error("ADMIN PROFILE LISTENER ERROR:", err);
        setLoading(false);
      },
    );
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

  const hasChanges =
    firstName.trim() !== originalRef.current.firstName ||
    middleName.trim() !== originalRef.current.middleName ||
    lastName.trim() !== originalRef.current.lastName ||
    contactNo.trim() !== originalRef.current.contactNo;

  const hasEmptyField =
    !firstName.trim() || !lastName.trim() || !contactNo.trim();

  const handleSave = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const fn = firstName.trim();
    const mn = middleName.trim();
    const ln = lastName.trim();
    const cn = contactNo.trim();

    if (!fn || !ln || !cn) {
      Alert.alert("Missing Information", "All fields are required.");
      return;
    }
    if (!/^9\d{9}$/.test(cn)) {
      Alert.alert("Invalid Contact Number", "Enter a valid 10-digit number starting with 9.");
      return;
    }

    setSaving(true);
    try {
      const updateProfile = httpsCallable(getFunctions(firebaseApp), "adminUpdateOwnProfile");
      await updateProfile({
        firstName: fn,
        middleName: mn,
        lastName: ln,
        contactNo: cn,
      });
      originalRef.current = { firstName: fn, middleName: mn, lastName: ln, contactNo: cn };
      setEditingMode(false);
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
    setMiddleName(originalRef.current.middleName);
    setLastName(originalRef.current.lastName);
    setContactNo(originalRef.current.contactNo);
    setEditingMode(false);
  }

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await clearLocalCache().catch(() => {});
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
            <TouchableOpacity onPress={() => setHelpSupportVisible(true)} activeOpacity={0.7} style={styles.headerIconBtn}>
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
            <View style={styles.adminAvatar}>
              <Text style={styles.adminAvatarText}>{`${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()}</Text>
            </View>
            <View style={styles.identityCopy}>
              <Text style={styles.identityName} numberOfLines={1}>
                {[firstName, middleName, lastName].filter(Boolean).join(" ")}
              </Text>
              <View style={styles.identityRoleRow}>
                <BadgeCheck size={15} color={colors.emerald} />
                <Text style={styles.identityRole}>Market Administrator</Text>
              </View>
            </View>
          </View>
        </Card>

        {/* FIELDS CARD */}
        <View ref={fieldsRef} collapsable={false} style={styles.fieldsSection}>
        <View style={styles.personalHeading}>
          <View style={styles.personalAccent} />
          <Text style={styles.personalHeadingText}>Personal Information</Text>
        </View>
        <View style={styles.fieldsCard}>
          <View style={styles.nameRow}>
          <View style={styles.nameColumn}>
          <Text style={styles.profileFieldLabel}>Last Name</Text>
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
          </View>

          <View style={styles.nameColumn}>
          <Text style={styles.profileFieldLabel}>First Name</Text>
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
          </View>
          </View>

          <Text style={styles.profileFieldLabel}>Middle Name</Text>
          <TextInput
            style={[styles.input, focusedField === "middleName" && styles.inputFocused, !isEditing && styles.inputReadOnly]}
            value={middleName}
            onChangeText={setMiddleName}
            placeholder="Middle name (optional)"
            placeholderTextColor={colors.textMuted}
            onFocus={() => { setFocusedField("middleName"); scrollToRevealForm(); }}
            onBlur={() => setFocusedField(null)}
            editable={isEditing && !saving}
          />

          <Text style={styles.profileFieldLabel}>Username</Text>
          <View style={[styles.rowField, styles.rowFieldReadOnly]}>
            <Contact size={18} color={colors.emerald} style={styles.profileFieldIcon} />
            <TextInput
              style={[styles.rowInput, styles.rowInputReadOnly]}
              value={RENTWISE_ADMIN_USERNAME}
              editable={false}
            />
          </View>

          <Text style={styles.profileFieldLabel}>Registered Mobile Number</Text>
          <View style={styles.phoneRow}>
            <View style={[styles.phonePrefix, !isEditing && styles.phonePrefixReadOnly]}>
              <Text style={styles.phonePrefixText}>+63</Text>
            </View>
            <View style={[
              styles.phoneInputWrap,
              focusedField === "contactNo" && isEditing && styles.rowFieldFocused,
              !isEditing && styles.rowFieldReadOnly,
            ]}>
            <TextInput
              style={[styles.rowInput, !isEditing && styles.rowInputReadOnly]}
              value={contactNo}
              onChangeText={(t) => setContactNo(t.replace(/\D/g, "").slice(0, 10))}
              keyboardType="phone-pad"
              placeholder="9XXXXXXXXX"
              placeholderTextColor={colors.textMuted}
              onFocus={() => { setFocusedField("contactNo"); scrollToRevealForm(); }}
              onBlur={() => setFocusedField(null)}
              editable={isEditing && !saving}
            />
            {!isEditing && <CheckCircle2 size={19} color={colors.emerald} style={styles.phoneVerifiedIcon} />}
            </View>
          </View>
        </View>
        </View>

        {/* EDIT / SAVE BUTTON */}
        <View ref={editBtnRef} collapsable={false} style={styles.actionSection}>
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
              onPress={() => setEditingMode(true)}
            >
              {({ pressed }) => (
                <View style={styles.editButtonContent}>
                  <Pencil size={15} color={pressed ? colors.ink : colors.white} />
                  <Text style={[styles.saveBtnText, pressed && styles.saveBtnTextPressed]}>Edit Profile Details</Text>
                </View>
              )}
            </Pressable>
          )}
        </View>

        {/* LOGOUT */}
        <View ref={logoutBtnRef} collapsable={false} style={styles.actionSection}>
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

      <HelpSupportModal visible={helpSupportVisible} steps={tourSteps} onClose={() => setHelpSupportVisible(false)} onReplayTour={() => setTourVisible(true)} />
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
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 18,
  },

  // ── Identity card ─────────────────────────────────────────────────────────────

  identityCard: {
    width: "100%",
    marginBottom: 18,
  },

  identityInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },

  identityCopy: { flex: 1 },
  adminAvatar: { width: 50, height: 50, borderRadius: 12, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" },
  adminAvatarText: { fontSize: 19, fontFamily: fontFamily.bold, color: colors.emeraldBright },

  identityName: {
    fontSize: 22,
    fontFamily: fontFamily.extrabold,
    color: colors.ink,
  },

  identityRoleRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 },

  identityRole: {
    fontSize: 12,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },

  // ── Fields card ───────────────────────────────────────────────────────────────

  fieldsCard: {
    width: "100%",
    marginBottom: 14,
  },

  fieldsSection: { width: "100%" },
  personalHeading: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16 },
  personalAccent: { width: 6, height: 16, borderRadius: 3, backgroundColor: colors.emerald },
  personalHeadingText: { fontSize: 13, fontFamily: fontFamily.semibold, color: colors.ink, textTransform: "uppercase", letterSpacing: 0.5 },
  nameRow: { flexDirection: "row", gap: 10 },
  nameColumn: { flex: 1 },
  profileFieldLabel: { fontSize: 11, fontFamily: fontFamily.medium, color: colors.ink, marginBottom: 7, marginLeft: 2 },
  profileFieldIcon: { marginLeft: 14 },

  fieldLabel: {
    fontSize: 12,
    fontFamily: fontFamily.semibold,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginLeft: 1,
    marginBottom: spacing.sm,
  },

  input: {
    width: "100%",
    backgroundColor: "transparent",
    borderRadius: 12,
    borderWidth: 0,
    paddingHorizontal: 16,
    minHeight: 54,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: fontFamily.medium,
    color: colors.ink,
    marginBottom: 16,
    ...shadow.card,
  },

  inputFocused: {
    borderColor: colors.emeraldBright,
    backgroundColor: "transparent",
  },

  inputReadOnly: {
    backgroundColor: "transparent",
    borderRadius: 12,
    color: colors.ink,
  },

  rowField: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    minHeight: 54,
    borderRadius: 12,
    backgroundColor: "transparent",
    overflow: "hidden",
    marginBottom: 16,
    ...shadow.card,
  },
  rowFieldFocused: { borderColor: colors.emeraldBright, backgroundColor: "transparent" },
  rowFieldReadOnly: { backgroundColor: "transparent", borderRadius: 12 },
  rowInput: { flex: 1, paddingHorizontal: spacing.md + 2, paddingVertical: spacing.md + 1, fontSize: fontSize.base, fontFamily: fontFamily.medium, color: colors.ink },
  rowInputReadOnly: { color: colors.ink, fontFamily: fontFamily.bold },

  // ── Phone row ─────────────────────────────────────────────────────────────────

  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 0,
    marginBottom: 16,
    minHeight: 54,
    padding: 5,
    backgroundColor: "transparent",
    borderRadius: 12,
    ...shadow.card,
  },

  phoneRowLast: {
    marginBottom: 0,
  },

  phoneRowFocused: {
    borderColor: colors.emeraldBright,
    backgroundColor: "transparent",
  },

  phoneRowReadOnly: {
    backgroundColor: "transparent",
    borderColor: colors.border,
  },

  phonePrefix: {
    minHeight: 44,
    backgroundColor: "transparent",
    borderRadius: 8,
    paddingHorizontal: 13,
    paddingVertical: 10,
    justifyContent: "center",
    alignItems: "center",
  },

  phonePrefixReadOnly: { backgroundColor: "transparent" },

  phonePrefixText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },

  phoneInputWrap: {
    flex: 1,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
  },
  phoneVerifiedIcon: { marginRight: 12 },

  // ── Save button ───────────────────────────────────────────────────────────────

  saveBtn: {
    width: "100%",
    borderRadius: 10,
    backgroundColor: colors.ink,
    minHeight: 46,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
    transform: [{ scale: 1 }],
    ...shadow.button,
  },
  actionSection: { width: "100%" },

  saveBtnPressed: {
    backgroundColor: colors.white,
    transform: [{ scale: 0.97 }],
  },

  saveBtnDisabled: {
    opacity: 0.45,
  },

  saveBtnText: {
    color: colors.white,
    fontSize: 14,
    fontFamily: fontFamily.bold,
    textAlign: "center",
  },
  saveBtnTextPressed: { color: colors.ink },
  editButtonContent: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },

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
