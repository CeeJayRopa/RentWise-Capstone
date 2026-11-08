import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  Alert,
  Animated,
  Easing,
  Modal,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { House, HelpCircle, Eye, EyeOff, CheckCircle2, Pencil, LockKeyhole, KeyRound } from "lucide-react-native";

import { auth } from "../../shared/services/auth";
import { db } from "../../shared/services/firestore";
import { firebaseApp } from "../../shared/firebaseConfig";
import HelpTour, { HelpStep } from "../components/HelpTour";
import HelpSupportModal from "../components/HelpSupportModal";
import OwnerBellIcon from "../components/OwnerBellIcon";
import { hasSeenPageTour, markPageTourSeen } from "../../shared/services/onboardingTour";
import { Avatar, Card } from "../../shared/components/ui";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";
import { readLocalCache, saveLocalCache } from "../../shared/services/localCache";
import { requireOnlineAction } from "../../shared/services/networkStatus";
import { RENTWISE_ADMIN_USERNAME } from "../../../shared/utils/username";

const cloudFunctions = getFunctions(firebaseApp);

type AdminDoc = {
  uid: string;
  firstName: string;
  middleName?: string;
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
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [contactNo, setContactNo] = useState("");
  const [original, setOriginal] = useState({ firstName: "", middleName: "", lastName: "", username: "", contactNo: "" });
  const originalRef = useRef(original);
  const [firstNameError, setFirstNameError] = useState("");
  const [lastNameError, setLastNameError] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [contactNoError, setContactNoError] = useState("");

  // Fully separate from `isEditing` (the profile-fields toggle) -- this
  // section unlocks independently via its own "Change Password" button.
  const [pwEditing, setPwEditing] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [pwError, setPwError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [changingPw, setChangingPw] = useState(false);
  const [showPwConfirm, setShowPwConfirm] = useState(false);

  const [focusedField, setFocusedField] = useState<string | null>(null);

  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(20)).current;
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const [tourVisible, setTourVisible] = useState(false);
  const [helpSupportVisible, setHelpSupportVisible] = useState(false);
  const homeRef = useRef<View>(null);
  const bellRef = useRef<View>(null);
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
          scrollRef.current?.scrollTo({ y: Math.max(0, y - 170), animated: true });
          setTimeout(resolve, 400);
        },
        () => resolve(),
      );
    });

  // Tracks whichever section's field was focused most recently, so the
  // keyboardDidShow re-scroll (below) knows what to bring back into view.
  const focusedSectionRef = useRef<React.RefObject<View | null> | null>(null);

  // Called from a field's onFocus -- scrolls that field's section up so it
  // isn't hidden behind the keyboard while typing.
  function scrollFieldIntoView(sectionRef: React.RefObject<View | null>) {
    focusedSectionRef.current = sectionRef;
    scrollSectionIntoView(sectionRef);
  }

  useEffect(() => {
    // onFocus fires before the keyboard has finished animating in, so a
    // fixed delay can land short if the OS is still resizing the window --
    // scroll again once the keyboard is confirmed fully shown.
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      if (focusedSectionRef.current) scrollSectionIntoView(focusedSectionRef.current);
    });
    return () => sub.remove();
  }, []);

  const tourSteps: HelpStep[] = [
    { key: "home", ref: homeRef, title: "Home", description: "Takes you back to the dashboard.", edgeInset: "top", round: true },
    { key: "bell", ref: bellRef, title: "Notifications", description: "Shows admin updates waiting for your review, like payments and building changes.", edgeInset: "top", round: true },
    { key: "profile", ref: profileFieldsRef, title: "Admin profile", description: "The market admin's first, middle, and last name, login username, and contact number.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(profileFieldsRef) },
    { key: "save", ref: saveBtnRef, title: "Save", description: "Saves any changes to the admin's profile details.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(saveBtnRef) },
    { key: "password", ref: pwFieldsRef, title: "Change password", description: "Set a new login password for the admin account. Must be 8-12 characters with an uppercase letter, a number, and a special character.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(pwFieldsRef) },
    { key: "updatepw", ref: updatePwBtnRef, title: "Update Password", description: "Applies the new password and signs the admin out of active sessions so they must log in again.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(updatePwBtnRef) },
  ];

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) { router.replace("/login"); return; }
      setChecking(false);
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
        const mn = data.middleName ?? "";
        const ln = data.lastName ?? "";
        const un = RENTWISE_ADMIN_USERNAME;
        const cn = data.contactNo ?? "";
        setFirstName(fn);
        setMiddleName(mn);
        setLastName(ln);
        setUsername(un);
        setContactNo(cn);
        const loadedProfile = { firstName: fn, middleName: mn, lastName: ln, username: un, contactNo: cn };
        originalRef.current = loadedProfile;
        setOriginal(loadedProfile);
        await saveLocalCache("owner:managed-admin", data);
      }
    } catch (err) {
      console.error(err);
      const data = await readLocalCache<AdminDoc>("owner:managed-admin");
      if (data) {
        setAdmin(data);
        const loadedProfile = {
          firstName: data.firstName ?? "",
          middleName: data.middleName ?? "",
          lastName: data.lastName ?? "",
          username: RENTWISE_ADMIN_USERNAME,
          contactNo: data.contactNo ?? "",
        };
        setFirstName(loadedProfile.firstName);
        setMiddleName(loadedProfile.middleName);
        setLastName(loadedProfile.lastName);
        setUsername(loadedProfile.username);
        setContactNo(loadedProfile.contactNo);
        originalRef.current = loadedProfile;
        setOriginal(loadedProfile);
      }
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
    else if (!/^9\d{9}$/.test(cn)) { setContactNoError("Enter a valid 10-digit number starting with 9."); valid = false; }
    else setContactNoError("");

    return valid;
  };

  function handleCancelEditProfile() {
    const savedProfile = originalRef.current;
    setFirstName(savedProfile.firstName);
    setMiddleName(savedProfile.middleName);
    setLastName(savedProfile.lastName);
    setUsername(savedProfile.username);
    setContactNo(savedProfile.contactNo);
    setFirstNameError("");
    setLastNameError("");
    setUsernameError("");
    setContactNoError("");
    setIsEditing(false);
  }

  function handleCancelPasswordEdit() {
    setNewPassword("");
    setConfirmPassword("");
    setPwError("");
    setConfirmError("");
    setPwEditing(false);
  }

  // Only one of the two sections can be in edit mode at a time -- opening
  // one closes the other (discarding whatever was unsaved there), same as
  // if Cancel had been pressed on it.
  function handleStartEditProfile() {
    handleCancelPasswordEdit();
    setUsername(RENTWISE_ADMIN_USERNAME);
    setIsEditing(true);
  }

  function handleStartEditPassword() {
    handleCancelEditProfile();
    setPwEditing(true);
  }

  // This screen lives on a tab, so it stays mounted (not unmounted) when
  // the owner navigates elsewhere -- without this, coming back would find
  // Edit Profile / Change Password still open exactly as they were left.
  // Resetting both sections when the screen loses focus keeps it "closed"
  // every time it's returned to, same as landing on it fresh.
  useFocusEffect(
    useCallback(() => {
      if (!checking) fetchAdmin();

      return () => {
        handleCancelEditProfile();
        handleCancelPasswordEdit();
      };
    }, [checking]),
  );

  const handleSave = async () => {
    if (!admin) return;
    if (!auth.currentUser?.uid) return;
    if (!(await requireOnlineAction("Updating the admin profile"))) return;
    const fn = firstName.trim();
    const mn = middleName.trim();
    const ln = lastName.trim();
    const un = RENTWISE_ADMIN_USERNAME;
    const cn = contactNo.trim();
    if (!validateProfileFields(fn, ln, un, cn)) return;
    setSaving(true);
    try {
      const updateFn = httpsCallable(cloudFunctions, "ownerUpdateAdminProfile");
      await updateFn({ uid: admin.uid, firstName: fn, middleName: mn, lastName: ln, username: un, contactNo: cn });
      setUsername(un);
      const savedProfile = { firstName: fn, middleName: mn, lastName: ln, username: un, contactNo: cn };
      originalRef.current = savedProfile;
      setOriginal(savedProfile);
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
    if (!(await requireOnlineAction("Changing the admin password"))) return;
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

    if (!auth.currentUser?.uid) return;
    setChangingPw(true);
    try {
      const resetFn = httpsCallable(cloudFunctions, "ownerResetAdminPassword");
      await resetFn({ uid: admin.uid, newPassword });
      setNewPassword("");
      setConfirmPassword("");
      setPwEditing(false);
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
    middleName !== original.middleName ||
    lastName !== original.lastName ||
    username !== original.username ||
    contactNo !== original.contactNo;

  const hasEmptyField =
    !firstName.trim() || !lastName.trim() || !username.trim() || !contactNo.trim();

  const passwordMeetsRequirements = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]).{8,12}$/.test(newPassword);
  const canUpdatePassword = passwordMeetsRequirements && confirmPassword.length > 0 && newPassword === confirmPassword;

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
          <View style={styles.headerRight}>
            <View ref={bellRef} collapsable={false}>
              <OwnerBellIcon />
            </View>
            <TouchableOpacity style={styles.headerBtn} onPress={() => setHelpSupportVisible(true)} activeOpacity={0.7}>
              <HelpCircle size={22} color={colors.emeraldSoft} />
            </TouchableOpacity>
          </View>
        </View>
      </LinearGradient>

      {!admin ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>No admin account found.</Text>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ADMIN IDENTITY */}
          <Card style={styles.identityCard}>
            <View style={styles.identityInner}>
              <Avatar name={`${firstName} ${lastName}`} size={48} />
              <View style={styles.identityCopy}>
                <View style={styles.roleBadge}>
                  <View style={styles.roleDot} />
                  <Text style={styles.identityRole}>Market Admin</Text>
                </View>
                <Text style={styles.identityName} numberOfLines={1} ellipsizeMode="tail">
                  {[firstName, lastName].filter(Boolean).join(" ")}
                </Text>
              </View>
            </View>
          </Card>

          <View style={styles.sectionHeadingRow}>
            <Text style={styles.informationTitle}>Administrator Information</Text>
            {!isEditing && (
              <Pressable style={styles.editProfileBtn} onPress={handleStartEditProfile}>
                <Pencil size={13} color={colors.emerald} />
                <Text style={styles.editProfileText}>Edit Profile</Text>
              </Pressable>
            )}
          </View>

          {/* ADMIN INFORMATION */}
          <View ref={profileFieldsRef} collapsable={false} style={{ width: "100%" }}>
          <Card style={styles.fieldsCard}>
            <View style={styles.nameFieldsRow}>
            <View style={styles.nameFieldColumn}>
            <Text style={styles.fieldLabel}>First name</Text>
            <TextInput
              style={[
                styles.compactInput,
                isEditing && styles.compactInputEditing,
                focusedField === "firstName" && isEditing && styles.inputFocused,
                !isEditing && styles.compactInputReadOnly,
                !!firstNameError && styles.inputErrorBorder,
              ]}
              value={firstName}
              onChangeText={(t) => {
                setFirstName(t);
                setUsername(RENTWISE_ADMIN_USERNAME);
                if (firstNameError) setFirstNameError("");
              }}
              placeholder="First name"
              placeholderTextColor={colors.textMuted}
              onFocus={() => { setFocusedField("firstName"); scrollFieldIntoView(profileFieldsRef); }}
              onBlur={() => setFocusedField(null)}
              editable={isEditing}
            />
            {!!firstNameError && <Text style={styles.fieldError}>{firstNameError}</Text>}
            </View>
            <View style={styles.nameFieldColumn}>
            <Text style={styles.fieldLabel}>Last name</Text>
            <TextInput
              style={[
                styles.compactInput,
                isEditing && styles.compactInputEditing,
                focusedField === "lastName" && isEditing && styles.inputFocused,
                !isEditing && styles.compactInputReadOnly,
                !!lastNameError && styles.inputErrorBorder,
              ]}
              value={lastName}
              onChangeText={(t) => { setLastName(t); if (lastNameError) setLastNameError(""); }}
              placeholder="Last name"
              placeholderTextColor={colors.textMuted}
              onFocus={() => { setFocusedField("lastName"); scrollFieldIntoView(profileFieldsRef); }}
              onBlur={() => setFocusedField(null)}
              editable={isEditing}
            />
            {!!lastNameError && <Text style={styles.fieldError}>{lastNameError}</Text>}
            </View>
            </View>

            <View style={styles.infoDivider} />
            <Text style={styles.fieldLabel}>Middle name</Text>
            <TextInput
              style={[
                styles.compactInput,
                isEditing && styles.compactInputEditing,
                focusedField === "middleName" && isEditing && styles.inputFocused,
                !isEditing && styles.compactInputReadOnly,
                !middleName && styles.optionalText,
              ]}
              value={middleName}
              onChangeText={setMiddleName}
              placeholder="Not provided"
              placeholderTextColor={colors.textMuted}
              onFocus={() => { setFocusedField("middleName"); scrollFieldIntoView(profileFieldsRef); }}
              onBlur={() => setFocusedField(null)}
              editable={isEditing}
            />

            <View style={styles.infoDivider} />
            <Text style={styles.fieldLabel}>Username</Text>
            <View style={styles.compactRowField}>
              <TextInput
                style={styles.compactRowInput}
                value={username}
                placeholder="username"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                onFocus={() => { setFocusedField("username"); scrollFieldIntoView(profileFieldsRef); }}
                onBlur={() => setFocusedField(null)}
                editable={false}
              />
            </View>
            {!!usernameError && <Text style={styles.fieldError}>{usernameError}</Text>}

            <View style={styles.infoDivider} />
            <Text style={styles.fieldLabel}>Contact number</Text>
            <View style={styles.contactLine}>
              <Text style={styles.phonePrefixText}>+63</Text>
              <View
                style={[
                  styles.compactPhoneInputWrap,
                  focusedField === "contactNo" && isEditing && styles.rowFieldFocused,
                  !!contactNoError && styles.inputErrorBorder,
                ]}
              >
                <TextInput
                  style={[styles.rowInput, styles.contactInput, !isEditing && styles.rowInputReadOnly]}
                  value={contactNo}
                  onChangeText={(t) => { setContactNo(t.replace(/\D/g, "").slice(0, 10)); if (contactNoError) setContactNoError(""); }}
                  placeholder="9XXXXXXXXX"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="phone-pad"
                  maxLength={10}
                  onFocus={() => { setFocusedField("contactNo"); scrollFieldIntoView(profileFieldsRef); }}
                  onBlur={() => setFocusedField(null)}
                  editable={isEditing}
                />
              </View>
            </View>
            {!!contactNoError && <Text style={styles.fieldError}>{contactNoError}</Text>}
          </Card>
          </View>

          {/* Edit / Cancel + Save Button */}
          <View ref={saveBtnRef} collapsable={false} style={{ width: "100%" }}>
            {isEditing ? (
              <View style={styles.pwActionsRow}>
                <Pressable
                  style={({ pressed }) => [
                    styles.pwCancelBtn,
                    pressed && { backgroundColor: colors.error, borderColor: colors.error },
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
                    (saving || hasEmptyField || !profileChanged) && styles.btnDisabled,
                    pressed && !(saving || hasEmptyField || !profileChanged) && styles.saveBtnPressed,
                  ]}
                  onPress={handleSave}
                  disabled={saving || hasEmptyField || !profileChanged}
                >
                  {({ pressed }) =>
                    saving
                      ? <ActivityIndicator color={colors.white} size="small" />
                      : <Text style={[styles.saveBtnText, styles.pwUpdateBtnText, pressed && styles.saveBtnTextPressed]}>Save changes</Text>
                  }
                </Pressable>
              </View>
            ) : null}
          </View>

          {/* PASSWORD CARD */}
          <Card style={styles.sectionCard}>
            <View style={styles.securityHeading}>
              <View style={styles.securityIcon}><LockKeyhole size={17} color={colors.emerald} /></View>
              <View>
                <Text style={styles.sectionTitle}>Account Security</Text>
                <Text style={styles.securitySubtitle}>Change Password</Text>
              </View>
            </View>

            <View ref={pwFieldsRef} collapsable={false} style={{ width: "100%" }}>
            <Text style={[styles.fieldLabel, styles.passwordLabel]}>New password</Text>
            <View style={[styles.pwField, !!pwError && styles.inputErrorBorder]}>
              <TextInput
                style={styles.rowInput}
                value={newPassword}
                onChangeText={(t) => { setNewPassword(t); setPwError(""); if (confirmPassword && confirmPassword === t) setConfirmError(""); }}
                secureTextEntry={!showNewPass}
                placeholder="New password"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                maxLength={12}
                onFocus={() => scrollFieldIntoView(pwFieldsRef)}
                editable={pwEditing}
              />
              <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowNewPass((v) => !v)} activeOpacity={0.7}>
                {showNewPass ? <EyeOff size={19} color={colors.textSecondary} /> : <Eye size={19} color={colors.textSecondary} />}
              </TouchableOpacity>
            </View>
            {!!pwError && <Text style={styles.fieldError}>{pwError}</Text>}

            <Text style={[styles.fieldLabel, styles.passwordLabel]}>Confirm password</Text>
            <View style={[styles.pwField, !!confirmError && styles.inputErrorBorder]}>
              <TextInput
                style={styles.rowInput}
                value={confirmPassword}
                onChangeText={(t) => { setConfirmPassword(t); setConfirmError(t && t !== newPassword ? "Passwords do not match." : ""); }}
                secureTextEntry={!showConfirmPass}
                placeholder="Confirm new password"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                maxLength={12}
                onFocus={() => scrollFieldIntoView(pwFieldsRef)}
                editable={pwEditing}
              />
              <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowConfirmPass((v) => !v)} activeOpacity={0.7}>
                {showConfirmPass ? <EyeOff size={19} color={colors.textSecondary} /> : <Eye size={19} color={colors.textSecondary} />}
              </TouchableOpacity>
            </View>
            {!!confirmError && <Text style={styles.fieldError}>{confirmError}</Text>}
            <View style={styles.passwordHintRow}>
              <View style={styles.hintIcon}><Text style={styles.hintIconText}>i</Text></View>
              <Text style={styles.hint}>Min. 8 characters with a capital letter, a number, and a special character.</Text>
            </View>
            </View>

            {/* Change Password / Cancel + Update Password */}
            <View ref={updatePwBtnRef} collapsable={false} style={{ width: "100%" }}>
              {pwEditing ? (
                <View style={styles.pwActionsRow}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.pwCancelBtn,
                      pressed && { backgroundColor: colors.error, borderColor: colors.error },
                    ]}
                    onPress={handleCancelPasswordEdit}
                    disabled={changingPw}
                  >
                    {({ pressed }) => (
                      <Text style={[styles.pwCancelBtnText, pressed && styles.pwCancelBtnTextPressed]}>Cancel</Text>
                    )}
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.updatePwBtn,
                      styles.pwUpdateBtn,
                      (changingPw || !canUpdatePassword) &&
                        styles.btnDisabled,
                      pressed &&
                        !(changingPw || !canUpdatePassword) &&
                        styles.saveBtnPressed,
                    ]}
                    onPress={() => setShowPwConfirm(true)}
                    disabled={changingPw || !canUpdatePassword}
                  >
                    {({ pressed }) =>
                      changingPw
                        ? <ActivityIndicator color={colors.white} size="small" />
                        : (
                          <Text style={[styles.saveBtnText, styles.pwUpdateBtnText, pressed && styles.saveBtnTextPressed]}>
                            Update Password
                          </Text>
                        )
                    }
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  style={({ pressed }) => [styles.updatePwBtn, pressed && styles.saveBtnPressed]}
                  onPress={handleStartEditPassword}
                >
                  {({ pressed }) => (
                    <View style={styles.buttonContent}>
                      <KeyRound size={14} color={pressed ? colors.ink : colors.white} />
                      <Text style={[styles.saveBtnText, pressed && styles.saveBtnTextPressed]}>Change Password</Text>
                    </View>
                  )}
                </Pressable>
              )}
            </View>
          </Card>
        </ScrollView>
        </KeyboardAvoidingView>
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
      <HelpSupportModal visible={helpSupportVisible} steps={tourSteps} onClose={() => setHelpSupportVisible(false)} onReplayTour={() => setTourVisible(true)} />

      {/* UPDATE PASSWORD CONFIRMATION MODAL */}
      <Modal
        visible={showPwConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!changingPw) setShowPwConfirm(false); }}
      >
        <View style={styles.alertOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => { if (!changingPw) setShowPwConfirm(false); }}
          />
          <View style={styles.alertCard}>
            <View style={styles.alertBody}>
              <Text style={styles.alertTitleNeutral}>Update password?</Text>
              <Text style={styles.alertMessage}>
                Are you sure you want to change this admin's password? Their active sessions will end and they must log in again using the new password.
              </Text>
            </View>
            <View style={styles.alertDivider} />
            <View style={styles.alertBtnRow}>
              <Pressable
                style={({ pressed }) => [styles.alertBtn, pressed && styles.alertBtnCancelPressed]}
                onPress={() => setShowPwConfirm(false)}
                disabled={changingPw}
              >
                {({ pressed }) => (
                  <Text style={[styles.alertBtnCancelText, pressed && styles.alertBtnCancelTextPressed]}>Cancel</Text>
                )}
              </Pressable>
              <View style={styles.alertBtnDivider} />
              <Pressable
                style={({ pressed }) => [styles.alertBtn, pressed && styles.alertBtnConfirmPressed]}
                onPress={() => {
                  setShowPwConfirm(false);
                  handleChangePassword();
                }}
                disabled={changingPw}
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
  headerRight: { flexDirection: "row", alignItems: "center", gap: spacing.md + 2 },
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
    paddingHorizontal: 10,
    paddingTop: 10,
  },

  // ── Identity card ─────────────────────────────────────────────────────────────

  identityCard: {
    width: "100%",
    marginBottom: 14,
  },

  identityInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },

  identityCopy: { flex: 1, alignItems: "flex-start" },

  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.emeraldSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginBottom: 4,
  },

  roleDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.emerald },

  identityName: {
    fontSize: 20,
    fontFamily: fontFamily.extrabold,
    color: colors.ink,
    lineHeight: 22,
  },

  identityRole: {
    fontSize: 9,
    fontFamily: fontFamily.bold,
    color: colors.emerald,
    textTransform: "uppercase",
  },

  sectionHeadingRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 7,
    paddingHorizontal: 2,
  },

  informationTitle: { fontSize: 14, fontFamily: fontFamily.semibold, color: colors.ink },

  editProfileBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.white,
    ...shadow.card,
  },

  editProfileText: { fontSize: 11, fontFamily: fontFamily.semibold, color: colors.emerald },

  // ── Fields card / sections ───────────────────────────────────────────────────

  fieldsCard: {
    width: "100%",
  },

  nameFieldsRow: { flexDirection: "row", gap: 14 },
  nameFieldColumn: { flex: 1 },
  infoDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 10 },

  compactInput: {
    width: "100%",
    minHeight: 28,
    paddingHorizontal: 0,
    paddingVertical: 3,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
    borderWidth: 0,
    textAlignVertical: "center",
  },

  compactInputReadOnly: { backgroundColor: "transparent" },
  compactInputEditing: {
    minHeight: 38,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.white,
  },
  optionalText: { color: colors.textMuted, fontFamily: fontFamily.regular, fontStyle: "italic" },
  compactRowField: { minHeight: 25, justifyContent: "center" },
  compactRowInput: { padding: 0, fontSize: 12, fontFamily: fontFamily.semibold, color: colors.ink },
  contactLine: { flexDirection: "row", alignItems: "center", minHeight: 25 },
  compactPhoneInputWrap: { flex: 1 },
  contactInput: { paddingVertical: 0, paddingHorizontal: 5, fontSize: 13 },

  sectionCard: {
    width: "100%",
    marginTop: 14,
    backgroundColor: "#F5F6F4",
  },

  sectionTitle: {
    fontSize: 18,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
  },

  securityHeading: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 18 },
  securityIcon: { width: 40, height: 40, borderRadius: 8, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
  securitySubtitle: { fontSize: 12, color: colors.ink, fontFamily: fontFamily.regular, marginTop: 1 },

  fieldLabel: {
    alignSelf: "flex-start",
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 2,
  },

  input: {
    width: "100%",
    backgroundColor: colors.white,
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
    backgroundColor: colors.white,
    overflow: "hidden",
    marginBottom: spacing.lg,
  },

  rowFieldFocused: {
    borderColor: colors.emeraldBright,
    backgroundColor: colors.white,
  },

  rowFieldReadOnly: {
    backgroundColor: colors.mist,
    borderColor: colors.border,
    borderRadius: radius.xl,
  },

  profileFieldReadOnly: {
    backgroundColor: colors.mist,
    borderColor: colors.border,
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
    backgroundColor: colors.border,
  },

  phonePrefixText: {
    fontSize: 13,
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
    backgroundColor: colors.white,
    overflow: "hidden",
  },

  // ── Password fields ───────────────────────────────────────────────────────────

  pwField: {
    width: "100%",
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 0,
    borderColor: colors.white,
    backgroundColor: colors.white,
    marginBottom: 16,
  },

  eyeBtn: { paddingHorizontal: 16, paddingVertical: spacing.md },

  passwordLabel: {
    color: colors.ink,
    fontSize: 12,
    letterSpacing: 0.2,
    marginBottom: 6,
  },

  fieldError: {
    alignSelf: "flex-start",
    fontSize: fontSize.xs,
    color: colors.error,
    fontFamily: fontFamily.medium,
    marginBottom: spacing.sm,
    marginTop: -spacing.sm + 2,
  },

  hint: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    color: colors.ink,
    fontFamily: fontFamily.regular,
  },

  passwordHintRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    paddingHorizontal: 6,
    marginBottom: 17,
  },

  hintIcon: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.emerald,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },

  hintIconText: { fontSize: 9, lineHeight: 10, color: colors.emerald, fontFamily: fontFamily.bold },

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

  saveBtnPressed: {
    backgroundColor: colors.white,
  },

  saveBtnText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    textAlign: "center",
  },

  saveBtnTextPressed: {
    color: colors.ink,
  },

  updatePwBtn: {
    width: "100%",
    borderRadius: 12,
    backgroundColor: colors.ink,
    minHeight: 56,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 0,
    ...shadow.button,
  },

  // ── Change Password: Cancel / Update row ─────────
  pwActionsRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.md,
  },

  pwCancelBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: 10,
    backgroundColor: colors.white,
    ...shadow.card,
  },

  pwCancelBtnText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.bold,
    color: colors.textSecondary,
  },

  pwCancelBtnTextPressed: {
    color: colors.white,
  },

  pwUpdateBtn: {
    flex: 1,
    marginTop: 0,
    paddingVertical: 10,
  },

  pwUpdateBtnText: {
    fontSize: fontSize.sm,
  },

  buttonContent: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },

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

  // ── Update password confirmation modal ───────────────────────────────────
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
    width: 280,
    overflow: "hidden",
    ...shadow.raised,
  },

  alertBody: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    alignItems: "center",
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
