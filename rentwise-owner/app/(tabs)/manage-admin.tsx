import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  Alert,
  Animated,
  Easing,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { House, HelpCircle, Eye, EyeOff, CheckCircle2 } from "lucide-react-native";

import { auth } from "../../shared/services/auth";
import { db } from "../../shared/services/firestore";
import { firebaseApp } from "../../shared/firebaseConfig";
import HelpTour, { HelpStep } from "../components/HelpTour";
import { hasSeenPageTour, markPageTourSeen } from "../../shared/services/onboardingTour";
import { Avatar, Card } from "../../shared/components/ui";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";

const cloudFunctions = getFunctions(firebaseApp);

const FIELD_MINT = "#C7E3C2";
const FIELD_MINT_DARK = "#A9CBA1";

type AdminDoc = {
  uid: string;
  firstName: string;
  lastName: string;
  username: string;
  contactNo: string;
  email: string;
};

export default function ManageAdmin() {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [admin, setAdmin] = useState<AdminDoc | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [contactNo, setContactNo] = useState("");
  const [original, setOriginal] = useState({ firstName: "", lastName: "", username: "", contactNo: "" });
  const [firstNameError, setFirstNameError] = useState("");
  const [lastNameError, setLastNameError] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [contactNoError, setContactNoError] = useState("");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [pwError, setPwError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [changingPw, setChangingPw] = useState(false);

  const [focusedField, setFocusedField] = useState<string | null>(null);

  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(20)).current;
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const [tourVisible, setTourVisible] = useState(false);
  const homeRef = useRef<View>(null);
  const profileFieldsRef = useRef<View>(null);
  const saveBtnRef = useRef<View>(null);
  const pwFieldsRef = useRef<View>(null);
  const updatePwBtnRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Scrolls a given section into view and gives the ScrollView time to
  // settle before HelpTour measures it — otherwise a section below the
  // fold (e.g. the password fields) would measure to its stale, off-screen
  // position instead of where it actually ends up on screen.
  const scrollSectionIntoView = (targetRef: React.RefObject<View | null>) =>
    new Promise<void>((resolve) => {
      // measureLayout needs a ref to the native scroll host itself — the
      // ScrollView's own ref is a composite wrapper, not a native
      // component, so findNodeHandle()'s numeric handle no longer works
      // here (RN 0.85 logs "ref.measureLayout must be called with a ref
      // to a native component"). getNativeScrollRef() is what's meant to
      // be passed instead.
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
    { key: "profile", ref: profileFieldsRef, title: "Admin profile", description: "The market admin's name, login username, and contact number. This is the account that manages tenants day-to-day.", offsetY: 41, onBeforeMeasure: () => scrollSectionIntoView(profileFieldsRef) },
    { key: "save", ref: saveBtnRef, title: "Save", description: "Saves any changes to the admin's profile details.", offsetY: 41, onBeforeMeasure: () => scrollSectionIntoView(saveBtnRef) },
    { key: "password", ref: pwFieldsRef, title: "Change password", description: "Set a new login password for the admin account. Must be 8-12 characters with an uppercase letter, a number, and a special character.", offsetY: 41, onBeforeMeasure: () => scrollSectionIntoView(pwFieldsRef) },
    { key: "updatepw", ref: updatePwBtnRef, title: "Update Password", description: "Applies the new password. The admin will need to use it the next time they log in.", offsetY: 41, onBeforeMeasure: () => scrollSectionIntoView(updatePwBtnRef) },
  ];

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) { router.replace("/login"); return; }
      setChecking(false);
      fetchAdmin();
    });
    return unsub;
  }, []);

  // Auto-opens the guided tour the first time the owner ever lands on this
  // page — never again after that, since it flips a persisted per-device
  // flag. Can still be replayed anytime via the Help button.
  useEffect(() => {
    if (checking) return;
    (async () => {
      const seen = await hasSeenPageTour("owner-manage-admin");
      if (!seen) {
        setTourVisible(true);
        await markPageTourSeen("owner-manage-admin");
      }
    })();
  }, [checking]);

  const fetchAdmin = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "users"), where("role", "==", "admin")));
      if (!snap.empty) {
        const d = snap.docs[0];
        const data = { uid: d.id, ...d.data() } as AdminDoc;
        setAdmin(data);
        const fn = data.firstName ?? "";
        const ln = data.lastName ?? "";
        const un = data.username ?? "";
        const cn = data.contactNo ?? "";
        setFirstName(fn);
        setLastName(ln);
        setUsername(un);
        setContactNo(cn);
        setOriginal({ firstName: fn, lastName: ln, username: un, contactNo: cn });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setToastVisible(true);
    toastAnim.setValue(0);
    toastTranslateY.setValue(20);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(toastAnim, { toValue: 1, duration: 450, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(toastTranslateY, { toValue: 0, duration: 450, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]),
      Animated.delay(1000),
      Animated.parallel([
        Animated.timing(toastAnim, { toValue: 0, duration: 450, easing: Easing.in(Easing.back(1.5)), useNativeDriver: true }),
        Animated.timing(toastTranslateY, { toValue: -10, duration: 450, easing: Easing.in(Easing.back(1.5)), useNativeDriver: true }),
      ]),
    ]).start(() => setToastVisible(false));
  };

  const validateProfileFields = (fn: string, ln: string, un: string, cn: string): boolean => {
    let valid = true;

    if (!fn) { setFirstNameError("First name is required."); valid = false; }
    else setFirstNameError("");

    if (!ln) { setLastNameError("Last name is required."); valid = false; }
    else setLastNameError("");

    if (!un) { setUsernameError("Username is required."); valid = false; }
    else setUsernameError("");

    if (!cn) { setContactNoError("Contact number is required."); valid = false; }
    else if (cn.length !== 11) { setContactNoError("Enter a valid 11-digit contact number."); valid = false; }
    else setContactNoError("");

    return valid;
  };

  const handleSave = async () => {
    if (!admin) return;
    const callerUid = auth.currentUser?.uid;
    if (!callerUid) return;
    const fn = firstName.trim();
    const ln = lastName.trim();
    const un = username.trim();
    const cn = contactNo.trim();
    if (!validateProfileFields(fn, ln, un, cn)) return;
    setSaving(true);
    try {
      const updateFn = httpsCallable(cloudFunctions, "ownerUpdateAdminProfile");
      await updateFn({ uid: admin.uid, callerUid, firstName: fn, lastName: ln, username: un, contactNo: cn });
      setOriginal({ firstName: fn, lastName: ln, username: un, contactNo: cn });
      setIsEditing(false);
      showToast("Profile saved!");
    } catch (err: any) {
      console.error(err);
      if (err?.code === "functions/already-exists") {
        setUsernameError("This username is already in use.");
      } else {
        Alert.alert("Error", "Failed to update admin profile.");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!admin) return;

    const pwRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]).{8,12}$/;
    let valid = true;

    if (!pwRegex.test(newPassword)) {
      setPwError("8–12 characters with at least 1 uppercase letter, number & special character.");
      valid = false;
    } else {
      setPwError("");
    }

    if (!confirmPassword) {
      setConfirmError("Please confirm your password.");
      valid = false;
    } else if (newPassword !== confirmPassword) {
      setConfirmError("Passwords do not match.");
      valid = false;
    } else {
      setConfirmError("");
    }

    if (!valid) return;

    const callerUid = auth.currentUser?.uid;
    if (!callerUid) return;
    setChangingPw(true);
    try {
      const resetFn = httpsCallable(cloudFunctions, "ownerResetAdminPassword");
      await resetFn({ uid: admin.uid, newPassword, callerUid });
      setNewPassword("");
      setConfirmPassword("");
      showToast("Password updated!");
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "Failed to change password.");
    } finally {
      setChangingPw(false);
    }
  };

  const profileChanged =
    firstName !== original.firstName ||
    lastName !== original.lastName ||
    username !== original.username ||
    contactNo !== original.contactNo;

  const hasEmptyField =
    !firstName.trim() || !lastName.trim() || !username.trim() || !contactNo.trim();

  if (checking || loading) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator color={colors.emerald} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Header */}
      <LinearGradient
        colors={[colors.emerald, colors.ink]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={[styles.header, { paddingTop: insets.top + 8, paddingBottom: spacing.lg + 2 }]}>
          <View ref={homeRef} collapsable={false}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => router.replace("/dashboard")} activeOpacity={0.7}>
              <House size={22} color={colors.emeraldSoft} />
            </TouchableOpacity>
          </View>
          <Text style={styles.headerTitle}>Manage Admin</Text>
          <TouchableOpacity style={styles.headerBtn} onPress={() => setTourVisible(true)} activeOpacity={0.7}>
            <HelpCircle size={22} color={colors.emeraldSoft} />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {!admin ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>No admin account found.</Text>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* IDENTITY CARD */}
          <Card style={styles.identityCard}>
            <View style={styles.identityInner}>
              <Avatar name={`${firstName} ${lastName}`} size={90} />
              <Text style={styles.identityName}>{firstName} {lastName}</Text>
              <Text style={styles.identityRole}>Market Admin</Text>
            </View>
          </Card>

          {/* FIELDS CARD */}
          <View ref={profileFieldsRef} collapsable={false} style={{ width: "100%" }}>
          <Card style={styles.fieldsCard}>
            <Text style={styles.fieldLabel}>Last name</Text>
            <TextInput
              style={[
                styles.input,
                focusedField === "lastName" && isEditing && styles.inputFocused,
                !isEditing && styles.inputReadOnly,
                !!lastNameError && styles.inputErrorBorder,
              ]}
              value={lastName}
              onChangeText={(t) => { setLastName(t); if (lastNameError) setLastNameError(""); }}
              placeholder="Last name"
              placeholderTextColor={colors.textMuted}
              onFocus={() => setFocusedField("lastName")}
              onBlur={() => setFocusedField(null)}
              editable={isEditing}
            />
            {!!lastNameError && <Text style={styles.fieldError}>{lastNameError}</Text>}

            <Text style={styles.fieldLabel}>First name</Text>
            <TextInput
              style={[
                styles.input,
                focusedField === "firstName" && isEditing && styles.inputFocused,
                !isEditing && styles.inputReadOnly,
                !!firstNameError && styles.inputErrorBorder,
              ]}
              value={firstName}
              onChangeText={(t) => { setFirstName(t); if (firstNameError) setFirstNameError(""); }}
              placeholder="First name"
              placeholderTextColor={colors.textMuted}
              onFocus={() => setFocusedField("firstName")}
              onBlur={() => setFocusedField(null)}
              editable={isEditing}
            />
            {!!firstNameError && <Text style={styles.fieldError}>{firstNameError}</Text>}

            <Text style={styles.fieldLabel}>Username</Text>
            <View
              style={[
                styles.rowField,
                focusedField === "username" && isEditing && styles.rowFieldFocused,
                !isEditing && styles.rowFieldReadOnly,
                !!usernameError && styles.inputErrorBorder,
              ]}
            >
              <TextInput
                style={[styles.rowInput, !isEditing && styles.rowInputReadOnly]}
                value={username}
                onChangeText={(t) => { setUsername(t); if (usernameError) setUsernameError(""); }}
                placeholder="username"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                onFocus={() => setFocusedField("username")}
                onBlur={() => setFocusedField(null)}
                editable={isEditing}
              />
              <Text style={styles.suffix}>@rentwise.app</Text>
            </View>
            {!!usernameError && <Text style={styles.fieldError}>{usernameError}</Text>}

            <Text style={styles.fieldLabel}>Contact no.</Text>
            <View style={styles.phoneRow}>
              <View style={[styles.phonePrefix, !isEditing && styles.phonePrefixReadOnly]}>
                <Text style={styles.phonePrefixText}>+63</Text>
              </View>
              <View
                style={[
                  styles.phoneInputWrap,
                  focusedField === "contactNo" && isEditing && styles.rowFieldFocused,
                  !isEditing && styles.rowFieldReadOnly,
                  !!contactNoError && styles.inputErrorBorder,
                ]}
              >
                <TextInput
                  style={[styles.rowInput, !isEditing && styles.rowInputReadOnly]}
                  value={contactNo}
                  onChangeText={(t) => { setContactNo(t.replace(/\D/g, "").slice(0, 11)); if (contactNoError) setContactNoError(""); }}
                  placeholder="09XXXXXXXXX"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="phone-pad"
                  maxLength={11}
                  onFocus={() => setFocusedField("contactNo")}
                  onBlur={() => setFocusedField(null)}
                  editable={isEditing}
                />
              </View>
            </View>
            {!!contactNoError && <Text style={styles.fieldError}>{contactNoError}</Text>}
          </Card>
          </View>

          {/* Edit / Save Button */}
          <View ref={saveBtnRef} collapsable={false} style={{ width: "100%" }}>
            <TouchableOpacity
              style={[styles.saveBtn, isEditing && (saving || hasEmptyField || !profileChanged) && styles.btnDisabled]}
              onPress={isEditing ? handleSave : () => setIsEditing(true)}
              disabled={isEditing && (saving || hasEmptyField || !profileChanged)}
              activeOpacity={0.8}
            >
              {saving
                ? <ActivityIndicator color={colors.white} size="small" />
                : <Text style={styles.saveBtnText}>{isEditing ? "Save changes" : "Edit Profile"}</Text>
              }
            </TouchableOpacity>
          </View>

          {/* PASSWORD CARD */}
          <Card style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Change Password</Text>

            <View ref={pwFieldsRef} collapsable={false} style={{ width: "100%" }}>
            <Text style={styles.fieldLabel}>New password</Text>
            <View style={[styles.pwField, !isEditing && styles.rowFieldReadOnly, !!pwError && styles.inputErrorBorder]}>
              <TextInput
                style={styles.rowInput}
                value={newPassword}
                onChangeText={(t) => { setNewPassword(t); setPwError(""); if (confirmPassword && confirmPassword === t) setConfirmError(""); }}
                secureTextEntry={!showNewPass}
                placeholder="New password"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                maxLength={12}
                editable={isEditing}
              />
              <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowNewPass((v) => !v)} activeOpacity={0.7}>
                {showNewPass ? <Eye size={18} color={colors.emerald} /> : <EyeOff size={18} color={colors.emerald} />}
              </TouchableOpacity>
            </View>
            {!!pwError && <Text style={styles.fieldError}>{pwError}</Text>}
            <Text style={styles.hint}>Min. 8 characters with a capital letter, a number, and a special character.</Text>

            <Text style={styles.fieldLabel}>Confirm password</Text>
            <View style={[styles.pwField, !isEditing && styles.rowFieldReadOnly, !!confirmError && styles.inputErrorBorder]}>
              <TextInput
                style={styles.rowInput}
                value={confirmPassword}
                onChangeText={(t) => { setConfirmPassword(t); setConfirmError(t && t !== newPassword ? "Passwords do not match." : ""); }}
                secureTextEntry={!showConfirmPass}
                placeholder="Confirm new password"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                maxLength={12}
                editable={isEditing}
              />
              <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowConfirmPass((v) => !v)} activeOpacity={0.7}>
                {showConfirmPass ? <Eye size={18} color={colors.emerald} /> : <EyeOff size={18} color={colors.emerald} />}
              </TouchableOpacity>
            </View>
            {!!confirmError && <Text style={styles.fieldError}>{confirmError}</Text>}
            </View>

            {/* Update Password Button */}
            {isEditing && (
            <View ref={updatePwBtnRef} collapsable={false} style={{ width: "100%" }}>
              <TouchableOpacity
                style={[styles.updatePwBtn, (changingPw || newPassword.length < 8 || confirmPassword.length < 8) && styles.btnDisabled]}
                onPress={handleChangePassword}
                disabled={changingPw || newPassword.length < 8 || confirmPassword.length < 8}
                activeOpacity={0.8}
              >
                {changingPw
                  ? <ActivityIndicator color={colors.white} size="small" />
                  : <Text style={styles.saveBtnText}>Update Password</Text>
                }
              </TouchableOpacity>
            </View>
            )}
          </Card>
        </ScrollView>
      )}

      {/* Toast */}
      {toastVisible && (
        <Animated.View style={[styles.overlay, { opacity: toastAnim }]}>
          <Animated.View style={[styles.toast, { transform: [{ translateY: toastTranslateY }] }]}>
            <CheckCircle2 size={22} color={colors.emeraldBright} />
            <Text style={styles.toastText}>{toastMsg}</Text>
          </Animated.View>
        </Animated.View>
      )}
      <HelpTour
        visible={tourVisible}
        steps={tourSteps}
        onClose={() => {
          setTourVisible(false);
          // The tour auto-scrolls down to reach later steps — scroll back
          // to the top once it's done so the owner isn't left mid-page.
          scrollRef.current?.scrollTo({ y: 0, animated: true });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.parchment },
  fullCenter: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.parchment },

  headerGradient: {
    borderBottomLeftRadius: radius.xl + 4,
    borderBottomRightRadius: radius.xl + 4,
    overflow: "hidden",
  },

  header: {
    paddingBottom: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
    color: colors.white,
  },

  emptyBox: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { fontSize: fontSize.base, color: colors.textSecondary, fontFamily: fontFamily.regular },

  scroll: { flex: 1 },
  content: {
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
  },

  // ── Identity card ─────────────────────────────────────────────────────────────

  identityCard: {
    width: "100%",
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
    color: colors.emerald,
    marginTop: 2,
  },

  // ── Fields card / sections ───────────────────────────────────────────────────

  fieldsCard: {
    width: "100%",
  },

  sectionCard: {
    width: "100%",
    marginTop: spacing.lg,
  },

  sectionTitle: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginBottom: spacing.lg,
  },

  fieldLabel: {
    alignSelf: "flex-start",
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: spacing.sm - 2,
  },

  input: {
    width: "100%",
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
    backgroundColor: FIELD_MINT,
    borderColor: FIELD_MINT,
    borderRadius: radius.xl,
    color: colors.ink,
  },

  inputErrorBorder: {
    borderColor: colors.error,
  },

  // ── Row fields (username, phone) ─────────────────────────────────────────────

  rowField: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.mist,
    overflow: "hidden",
    marginBottom: spacing.lg,
  },

  rowFieldFocused: {
    borderColor: colors.emeraldBright,
    backgroundColor: colors.white,
  },

  rowFieldReadOnly: {
    backgroundColor: FIELD_MINT,
    borderColor: FIELD_MINT,
    borderRadius: radius.xl,
  },

  rowInput: {
    flex: 1,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md + 1,
    fontSize: fontSize.base,
    fontFamily: fontFamily.medium,
    color: colors.ink,
  },

  rowInputReadOnly: {
    color: colors.ink,
    fontFamily: fontFamily.bold,
  },

  suffix: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    paddingRight: spacing.lg,
    fontFamily: fontFamily.medium,
  },

  // ── Phone row ─────────────────────────────────────────────────────────────────

  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    marginBottom: spacing.lg,
  },

  phonePrefix: {
    backgroundColor: colors.emeraldSoft,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 1,
    justifyContent: "center",
    alignItems: "center",
  },

  phonePrefixReadOnly: {
    backgroundColor: FIELD_MINT_DARK,
  },

  phonePrefixText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  phoneInputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.mist,
    overflow: "hidden",
  },

  // ── Password fields ───────────────────────────────────────────────────────────

  pwField: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.mist,
    marginBottom: spacing.xs,
  },

  eyeBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },

  fieldError: {
    alignSelf: "flex-start",
    fontSize: fontSize.xs,
    color: colors.error,
    fontFamily: fontFamily.medium,
    marginBottom: spacing.sm,
    marginTop: -spacing.sm + 2,
  },

  hint: {
    alignSelf: "flex-start",
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontFamily: fontFamily.regular,
    marginBottom: spacing.lg,
  },

  // ── Buttons ───────────────────────────────────────────────────────────────────

  saveBtn: {
    width: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.lg,
    ...shadow.button,
  },

  btnDisabled: { opacity: 0.45 },

  saveBtnText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    textAlign: "center",
  },

  updatePwBtn: {
    width: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.md,
    ...shadow.button,
  },

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
