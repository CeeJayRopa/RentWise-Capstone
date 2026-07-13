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
    { key: "home", ref: homeRef, title: "Home", description: "Takes you back to the dashboard.", offsetY: 41, round: true },
    { key: "help", ref: helpRef, title: "Help", description: "Come back here anytime for a guided tour of this page.", offsetY: 41, round: true },
    { key: "fields", ref: fieldsRef, title: "Your details", description: "Your last name, first name, and contact number.", offsetY: 41, onBeforeMeasure: () => scrollSectionIntoView(fieldsRef) },
    { key: "edit", ref: editBtnRef, title: "Edit Profile", description: "Unlocks your name and contact number so you can update them.", offsetY: 41, onBeforeMeasure: () => scrollSectionIntoView(editBtnRef) },
    { key: "logout", ref: logoutBtnRef, title: "Logout", description: "Signs you out of your admin account.", offsetY: 41, onBeforeMeasure: () => scrollSectionIntoView(logoutBtnRef) },
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

  const handleLogout = async () => {
    await logoutUser();
    await setRememberMe(false);
    router.replace("/");
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
      <ScrollView
        ref={scrollRef}
        style={styles.body}
        contentContainerStyle={[
          styles.bodyContent,
          { paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* IDENTITY CARD */}
        <Card style={styles.identityCard}>
          <View style={styles.identityInner}>
            <Avatar name={`${firstName} ${lastName}`} size={90} />
            <Text style={styles.identityName}>
              {firstName} {lastName}
            </Text>
            <Text style={styles.identityRole}>Super Admin</Text>
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
            onFocus={() => setFocusedField("lastName")}
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
            onFocus={() => setFocusedField("firstName")}
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
              onFocus={() => setFocusedField("contactNo")}
              onBlur={() => setFocusedField(null)}
              editable={isEditing && !saving}
            />
          </View>
        </Card>
        </View>

        {/* EDIT / SAVE BUTTON */}
        <View ref={editBtnRef} collapsable={false}>
        <Pressable
          style={({ pressed }) => [
            styles.saveBtn,
            isEditing && (!hasChanges || hasEmptyField || saving) && styles.saveBtnDisabled,
            pressed && (!isEditing || (hasChanges && !hasEmptyField && !saving)) && styles.saveBtnPressed,
          ]}
          onPress={isEditing ? handleSave : () => setIsEditing(true)}
          disabled={isEditing && (!hasChanges || hasEmptyField || saving)}
        >
          {saving ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <Text style={styles.saveBtnText}>{isEditing ? "Save changes" : "Edit Profile"}</Text>
          )}
        </Pressable>
        </View>

        {/* LOGOUT */}
        <View ref={logoutBtnRef} collapsable={false}>
        <Pressable
          style={({ pressed }) => [styles.logoutBtn, pressed && styles.logoutBtnPressed]}
          onPress={handleLogout}
        >
          <LogOut size={18} color={colors.error} style={{ marginRight: spacing.sm + 2 }} />
          <Text style={styles.logoutBtnText}>Logout Account</Text>
        </Pressable>
        </View>
      </ScrollView>

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
});
