import { useEffect, useRef, useState } from "react";
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
  FlatList,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import {
  onAuthStateChanged,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, HelpCircle, Eye, EyeOff, ChevronDown, CheckCircle2, LogOut } from "lucide-react-native";

import { auth, logoutUser } from "../shared/services/auth";
import { setRememberMe } from "../shared/services/rememberMe";
import { firebaseApp } from "../shared/firebaseConfig";
import { getUserById, updateUserProfile, isUsernameTaken } from "../shared/services/userServices";
import HelpTour, { HelpStep } from "./components/HelpTour";
import { hasSeenPageTour, markPageTourSeen } from "../shared/services/onboardingTour";
import { Avatar, Card } from "../shared/components/ui";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../shared/theme";

const cloudFunctions = getFunctions(firebaseApp);

const SECURITY_QUESTIONS = [
  "When did Ka Domeng start?",
  "What is your mother's maiden name?",
  "What was the name of your elementary school?",
  "What city were you born in?",
  "What was the make of your first vehicle?",
  "What is your favorite childhood nickname?",
  "What was the name of the admin of the market?",
  "What is the name of your best friend growing up?",
];

export default function OwnerProfile() {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [contactNo, setContactNo] = useState("");
  const [original, setOriginal] = useState({ firstName: "", lastName: "", username: "", contactNo: "" });
  const [firstNameError, setFirstNameError] = useState("");
  const [lastNameError, setLastNameError] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [contactNoError, setContactNoError] = useState("");

  const [pwEditing, setPwEditing] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [showOldPass, setShowOldPass] = useState(false);
  const [oldPwError, setOldPwError] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [pwError, setPwError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [changingPw, setChangingPw] = useState(false);
  const [showPwConfirm, setShowPwConfirm] = useState(false);

  const [secEditing, setSecEditing] = useState(false);
  const [secQuestions, setSecQuestions] = useState<[string, string, string]>(["", "", ""]);
  const [secAnswers, setSecAnswers] = useState<[string, string, string]>(["", "", ""]);
  const [secCurrentPassword, setSecCurrentPassword] = useState("");
  const [showSecCurrentPass, setShowSecCurrentPass] = useState(false);
  const [pickerSlot, setPickerSlot] = useState<0 | 1 | 2 | null>(null);
  const [savingSecQ, setSavingSecQ] = useState(false);

  const [focusedField, setFocusedField] = useState<string | null>(null);

  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(20)).current;
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const [tourVisible, setTourVisible] = useState(false);
  const fieldsRef = useRef<View>(null);
  const editBtnRef = useRef<View>(null);
  const pwSectionRef = useRef<View>(null);
  const secQSectionRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  // Tracks whichever section's field was focused most recently, so the
  // keyboardDidShow re-scroll (below) knows what to bring back into view.
  const focusedSectionRef = useRef<React.RefObject<View | null> | null>(null);

  // Scrolls a given section into view and gives the ScrollView time to
  // settle before HelpTour measures it — otherwise a section below the
  // fold (e.g. the security questions) would measure to its stale,
  // off-screen position instead of where it actually ends up on screen.
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

  // Called from a field's onFocus -- scrolls that field's section up so it
  // isn't hidden behind the keyboard while the owner is typing.
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
    { key: "fields", ref: fieldsRef, title: "Your details", description: "Your last name, first name, login username, and contact number.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(fieldsRef) },
    { key: "edit", ref: editBtnRef, title: "Edit Profile", description: "Unlocks your name, username, and contact number so you can update them.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(editBtnRef) },
    { key: "password", ref: pwSectionRef, title: "Change password", description: "Verify your current password, then set a new one — 8-12 characters with an uppercase letter, a number, and a special character.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(pwSectionRef) },
    { key: "secquestions", ref: secQSectionRef, title: "Security questions", description: "Set 3 recovery questions so you can get back into your account if you ever forget your password.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(secQSectionRef) },
  ];

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) { router.replace("/login"); return; }
      setChecking(false);
      loadProfile(user.uid);
    });
    return unsub;
  }, []);

  // Auto-opens the guided tour the first time the owner ever lands on this
  // page — never again after that, since it flips a persisted per-device
  // flag. Can still be replayed anytime via the Help button.
  useEffect(() => {
    if (loading) return;
    (async () => {
      const seen = await hasSeenPageTour("owner-profile");
      if (!seen) {
        setTourVisible(true);
        await markPageTourSeen("owner-profile");
      }
    })();
  }, [loading]);

  const loadProfile = async (uid: string) => {
    try {
      const data = await getUserById(uid);
      if (data) {
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
    const user = auth.currentUser;
    if (!user) return;

    const fn = firstName.trim();
    const ln = lastName.trim();
    const un = username.trim();
    const cn = contactNo.trim();

    if (!validateProfileFields(fn, ln, un, cn)) return;

    setSaving(true);
    try {
      if (un !== original.username) {
        const taken = await isUsernameTaken(un, "owner", user.uid);
        if (taken) {
          setUsernameError("This username is already in use.");
          return;
        }
      }
      await updateUserProfile(user.uid, { firstName: fn, lastName: ln, username: un, contactNo: cn });
      setOriginal({ firstName: fn, lastName: ln, username: un, contactNo: cn });
      setIsEditing(false);
      showToast("Profile saved!");
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "Failed to update profile.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEditProfile = () => {
    setFirstName(original.firstName);
    setLastName(original.lastName);
    setUsername(original.username);
    setContactNo(original.contactNo);
    setFirstNameError(""); setLastNameError(""); setUsernameError(""); setContactNoError("");
    setIsEditing(false);
  };

  function handleCancelPasswordEdit() {
    setOldPassword(""); setNewPassword(""); setConfirmPassword("");
    setOldPwError(""); setPwError(""); setConfirmError("");
    setPwEditing(false);
  }

  function handleCancelSecQuestionsEdit() {
    setSecQuestions(["", "", ""]);
    setSecAnswers(["", "", ""]);
    setSecCurrentPassword("");
    setPickerSlot(null);
    setSecEditing(false);
  }

  // Only one section can be in edit mode at a time -- opening one closes
  // (and discards) the other two, same as if Cancel had been pressed on them.
  function handleStartEditProfile() {
    handleCancelPasswordEdit();
    handleCancelSecQuestionsEdit();
    setIsEditing(true);
  }

  function handleStartEditPassword() {
    handleCancelEditProfile();
    handleCancelSecQuestionsEdit();
    setPwEditing(true);
  }

  function handleStartEditSecQuestions() {
    handleCancelEditProfile();
    handleCancelPasswordEdit();
    setSecEditing(true);
  }

  const hasChanges =
    firstName !== original.firstName ||
    lastName !== original.lastName ||
    username !== original.username ||
    contactNo !== original.contactNo;

  const hasEmptyField =
    !firstName.trim() || !lastName.trim() || !username.trim() || !contactNo.trim();

  const handleChangePassword = async () => {
    const pwRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]).{8,12}$/;
    let valid = true;

    if (!oldPassword) {
      setOldPwError("Please enter your current password.");
      valid = false;
    } else {
      setOldPwError("");
    }

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

    const user = auth.currentUser;
    if (!user || !user.email) return;
    setChangingPw(true);
    try {
      // Re-authenticating with the OLD password both proves it's correct
      // (wrong-password rejects here, before anything changes) and covers
      // the "requires-recent-login" case updatePassword can otherwise hit
      // on a stale session.
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, oldPassword));
      await updatePassword(user, newPassword);
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPwEditing(false);
      showToast("Password updated!");
    } catch (err: any) {
      if (err?.code === "auth/wrong-password" || err?.code === "auth/invalid-credential") {
        setOldPwError("Current password is incorrect.");
      } else if (err?.code === "auth/requires-recent-login") {
        Alert.alert("Session Expired", "Please log out and log in again before changing your password.");
      } else {
        Alert.alert("Error", "Failed to change password.");
      }
    } finally {
      setChangingPw(false);
    }
  };

  const secSlotsFilled =
    secQuestions.every((q) => !!q) && secAnswers.every((a) => a.trim().length > 0);
  const secQuestionsDuplicated = new Set(secQuestions).size !== secQuestions.filter(Boolean).length;

  const handleSaveSecurityQuestions = async () => {
    if (!secSlotsFilled) {
      Alert.alert("Incomplete", "Please pick all 3 questions and answer each one.");
      return;
    }
    if (secQuestionsDuplicated) {
      Alert.alert("Duplicate Questions", "Please choose 3 different questions.");
      return;
    }
    if (!secCurrentPassword) {
      Alert.alert("Current Password Required", "Enter your current password to confirm.");
      return;
    }

    const user = auth.currentUser;
    if (!user || !user.email) return;
    setSavingSecQ(true);
    try {
      // This re-authentication is the real verification that secCurrentPassword
      // is correct — the Cloud Function itself never receives or stores it.
      await reauthenticateWithCredential(
        user,
        EmailAuthProvider.credential(user.email, secCurrentPassword),
      );
      const saveFn = httpsCallable(cloudFunctions, "ownerSaveSecurityQuestions");
      await saveFn({
        securityQuestions: secQuestions.map((q, i) => ({ question: q, answer: secAnswers[i] })),
      });
      setSecCurrentPassword("");
      setSecEditing(false);
      showToast("Security questions saved!");
    } catch (err: any) {
      if (err?.code === "auth/invalid-credential" || err?.code === "auth/wrong-password") {
        Alert.alert("Incorrect Password", "Your current password is incorrect.");
      } else {
        console.error(err);
        Alert.alert("Error", "Failed to save security questions.");
      }
    } finally {
      setSavingSecQ(false);
    }
  };

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logoutUser();
      await setRememberMe(false);
      router.replace("/login");
    } finally {
      setLoggingOut(false);
      setShowLogoutConfirm(false);
    }
  };

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
          <TouchableOpacity style={styles.headerBtn} onPress={() => router.replace("/dashboard")} activeOpacity={0.7}>
            <ArrowLeft size={22} color={colors.emeraldSoft} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>My Account</Text>
          <TouchableOpacity style={styles.headerBtn} onPress={() => setTourVisible(true)} activeOpacity={0.7}>
            <HelpCircle size={22} color={colors.emeraldSoft} />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* IDENTITY CARD */}
        <Card style={styles.identityCard}>
          <View style={styles.identityInner}>
            <Avatar name={`${firstName} ${lastName}`} size={90} />
            <Text style={styles.identityName}>{firstName} {lastName}</Text>
            <Text style={styles.identityRole}>Property Owner</Text>
          </View>
        </Card>

        {/* FIELDS CARD */}
        <View ref={fieldsRef} collapsable={false} style={{ width: "100%" }}>
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
            onFocus={() => { setFocusedField("lastName"); scrollFieldIntoView(fieldsRef); }}
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
            onFocus={() => { setFocusedField("firstName"); scrollFieldIntoView(fieldsRef); }}
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
              onFocus={() => { setFocusedField("username"); scrollFieldIntoView(fieldsRef); }}
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
                onFocus={() => { setFocusedField("contactNo"); scrollFieldIntoView(fieldsRef); }}
                onBlur={() => setFocusedField(null)}
                editable={isEditing}
              />
            </View>
          </View>
          {!!contactNoError && <Text style={styles.fieldError}>{contactNoError}</Text>}
        </Card>
        </View>

        {/* Edit / Cancel + Save Button */}
        <View ref={editBtnRef} collapsable={false} style={{ width: "100%" }}>
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
                  (saving || hasEmptyField || !hasChanges) && styles.btnDisabled,
                  pressed && !(saving || hasEmptyField || !hasChanges) && styles.saveBtnPressed,
                ]}
                onPress={handleSave}
                disabled={saving || hasEmptyField || !hasChanges}
              >
                {({ pressed }) =>
                  saving
                    ? <ActivityIndicator color={colors.white} size="small" />
                    : <Text style={[styles.saveBtnText, styles.pwUpdateBtnText, pressed && styles.saveBtnTextPressed]}>Save changes</Text>
                }
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.saveBtn, pressed && styles.saveBtnPressed]}
              onPress={handleStartEditProfile}
            >
              {({ pressed }) => (
                <Text style={[styles.saveBtnText, pressed && styles.saveBtnTextPressed]}>Edit Profile</Text>
              )}
            </Pressable>
          )}
        </View>

        {/* PASSWORD CARD */}
        <View ref={pwSectionRef} collapsable={false} style={{ width: "100%" }}>
        <Card style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Change Password</Text>

          <Text style={styles.fieldLabel}>Current password</Text>
          <View style={[styles.pwField, !pwEditing && styles.rowFieldReadOnly, !!oldPwError && styles.inputErrorBorder]}>
            <TextInput
              style={styles.rowInput}
              value={oldPassword}
              onChangeText={(t) => { setOldPassword(t); setOldPwError(""); }}
              secureTextEntry={!showOldPass}
              placeholder="Current password"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              onFocus={() => scrollFieldIntoView(pwSectionRef)}
              editable={pwEditing}
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowOldPass((v) => !v)} activeOpacity={0.7}>
              {showOldPass ? <Eye size={18} color={colors.emerald} /> : <EyeOff size={18} color={colors.emerald} />}
            </TouchableOpacity>
          </View>
          {!!oldPwError && <Text style={styles.fieldError}>{oldPwError}</Text>}

          <Text style={styles.fieldLabel}>New password</Text>
          <View style={[styles.pwField, !pwEditing && styles.rowFieldReadOnly, !!pwError && styles.inputErrorBorder]}>
            <TextInput
              style={styles.rowInput}
              value={newPassword}
              onChangeText={(t) => { setNewPassword(t); setPwError(""); if (confirmPassword && confirmPassword === t) setConfirmError(""); }}
              secureTextEntry={!showNewPass}
              placeholder="New password"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              maxLength={12}
              onFocus={() => scrollFieldIntoView(pwSectionRef)}
              editable={pwEditing}
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowNewPass((v) => !v)} activeOpacity={0.7}>
              {showNewPass ? <Eye size={18} color={colors.emerald} /> : <EyeOff size={18} color={colors.emerald} />}
            </TouchableOpacity>
          </View>
          {!!pwError && <Text style={styles.fieldError}>{pwError}</Text>}
          <Text style={styles.hint}>Min. 8 characters with a capital letter, a number, and a special character.</Text>

          <Text style={styles.fieldLabel}>Confirm password</Text>
          <View style={[styles.pwField, !pwEditing && styles.rowFieldReadOnly, !!confirmError && styles.inputErrorBorder]}>
            <TextInput
              style={styles.rowInput}
              value={confirmPassword}
              onChangeText={(t) => { setConfirmPassword(t); setConfirmError(t && t !== newPassword ? "Passwords do not match." : ""); }}
              secureTextEntry={!showConfirmPass}
              placeholder="Confirm new password"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              maxLength={12}
              onFocus={() => scrollFieldIntoView(pwSectionRef)}
              editable={pwEditing}
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowConfirmPass((v) => !v)} activeOpacity={0.7}>
              {showConfirmPass ? <Eye size={18} color={colors.emerald} /> : <EyeOff size={18} color={colors.emerald} />}
            </TouchableOpacity>
          </View>
          {!!confirmError && <Text style={styles.fieldError}>{confirmError}</Text>}

          {pwEditing ? (
            <View style={[styles.pwActionsRow, { marginTop: spacing.sm }]}>
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
                  (changingPw || !oldPassword || newPassword.length < 8 || confirmPassword.length < 8) && styles.btnDisabled,
                  pressed && !(changingPw || !oldPassword || newPassword.length < 8 || confirmPassword.length < 8) && styles.saveBtnPressed,
                ]}
                onPress={() => setShowPwConfirm(true)}
                disabled={changingPw || !oldPassword || newPassword.length < 8 || confirmPassword.length < 8}
              >
                {({ pressed }) =>
                  changingPw
                    ? <ActivityIndicator color={colors.white} size="small" />
                    : <Text style={[styles.saveBtnText, styles.pwUpdateBtnText, pressed && styles.saveBtnTextPressed]}>Update Password</Text>
                }
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.updatePwBtn, pressed && styles.saveBtnPressed]}
              onPress={handleStartEditPassword}
            >
              {({ pressed }) => (
                <Text style={[styles.saveBtnText, pressed && styles.saveBtnTextPressed]}>Change Password</Text>
              )}
            </Pressable>
          )}
        </Card>
        </View>

        {/* SECURITY QUESTIONS CARD */}
        <View ref={secQSectionRef} collapsable={false} style={{ width: "100%" }}>
        <Card style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Security Questions</Text>
          <Text style={styles.hint}>
            Set 3 questions so you can recover your password later if you forget it.
          </Text>

          {[0, 1, 2].map((slot) => (
            <View key={slot} style={{ width: "100%", marginTop: spacing.sm }}>
              <Text style={styles.fieldLabel}>Question {slot + 1}</Text>
              <TouchableOpacity
                style={[styles.rowField, !secEditing && styles.rowFieldReadOnly, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 1 }]}
                onPress={() => secEditing && setPickerSlot(slot as 0 | 1 | 2)}
                disabled={!secEditing}
                activeOpacity={0.7}
              >
                <Text style={[{ flex: 1, fontSize: fontSize.base, fontFamily: fontFamily.medium, color: secQuestions[slot] ? colors.ink : colors.textMuted }]}>
                  {secQuestions[slot] || "Select a question"}
                </Text>
                <ChevronDown size={16} color={colors.emerald} />
              </TouchableOpacity>

              <TextInput
                style={[styles.input, !secEditing && styles.inputReadOnly, { marginTop: spacing.sm, marginBottom: 0 }]}
                value={secAnswers[slot]}
                onChangeText={(t) => setSecAnswers((prev) => {
                  const next = [...prev] as [string, string, string];
                  next[slot] = t;
                  return next;
                })}
                placeholder="Your answer"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                onFocus={() => scrollFieldIntoView(secQSectionRef)}
                editable={secEditing}
              />
            </View>
          ))}

          {secEditing && (
            <>
              <Text style={[styles.fieldLabel, { marginTop: spacing.lg }]}>Current Password</Text>
              <View style={styles.pwField}>
                <TextInput
                  style={styles.rowInput}
                  value={secCurrentPassword}
                  onChangeText={setSecCurrentPassword}
                  secureTextEntry={!showSecCurrentPass}
                  placeholder="Confirm it's you"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  onFocus={() => scrollFieldIntoView(secQSectionRef)}
                />
                <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowSecCurrentPass((v) => !v)} activeOpacity={0.7}>
                  {showSecCurrentPass ? <Eye size={18} color={colors.emerald} /> : <EyeOff size={18} color={colors.emerald} />}
                </TouchableOpacity>
              </View>
            </>
          )}

          {secEditing ? (
            <View style={[styles.pwActionsRow, { marginTop: spacing.sm }]}>
              <Pressable
                style={({ pressed }) => [
                  styles.pwCancelBtn,
                  pressed && { backgroundColor: colors.error, borderColor: colors.error },
                ]}
                onPress={handleCancelSecQuestionsEdit}
                disabled={savingSecQ}
              >
                {({ pressed }) => (
                  <Text style={[styles.pwCancelBtnText, pressed && styles.pwCancelBtnTextPressed]}>Cancel</Text>
                )}
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.updatePwBtn,
                  styles.pwUpdateBtn,
                  (savingSecQ || !secSlotsFilled || !secCurrentPassword) && styles.btnDisabled,
                  pressed && !(savingSecQ || !secSlotsFilled || !secCurrentPassword) && styles.saveBtnPressed,
                ]}
                onPress={handleSaveSecurityQuestions}
                disabled={savingSecQ || !secSlotsFilled || !secCurrentPassword}
              >
                {({ pressed }) => savingSecQ
                  ? <ActivityIndicator color={colors.white} size="small" />
                  : <Text style={[styles.saveBtnText, styles.pwUpdateBtnText, pressed && styles.saveBtnTextPressed]}>Save Security Questions</Text>
                }
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.updatePwBtn, pressed && styles.saveBtnPressed]}
              onPress={handleStartEditSecQuestions}
            >
              {({ pressed }) => (
                <Text style={[styles.saveBtnText, pressed && styles.saveBtnTextPressed]}>Set Security Questions</Text>
              )}
            </Pressable>
          )}
        </Card>
        </View>

        {/* Logout */}
        <Pressable
          style={({ pressed }) => [styles.logoutBtn, pressed && styles.logoutBtnPressed]}
          onPress={() => setShowLogoutConfirm(true)}
        >
          {({ pressed }) => (
            <>
              <LogOut size={18} color={pressed ? colors.white : colors.error} style={{ marginRight: spacing.sm + 2 }} />
              <Text style={[styles.logoutBtnText, pressed && styles.logoutBtnTextPressed]}>Logout Account</Text>
            </>
          )}
        </Pressable>
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Security question picker */}
      <Modal visible={pickerSlot !== null} transparent animationType="fade" onRequestClose={() => setPickerSlot(null)}>
        <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setPickerSlot(null)}>
          <View style={styles.pickerCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.pickerTitle}>Choose a question</Text>
            <FlatList
              data={SECURITY_QUESTIONS.filter(
                (q) => !secQuestions.includes(q) || q === secQuestions[pickerSlot ?? 0],
              )}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.pickerItem}
                  onPress={() => {
                    if (pickerSlot === null) return;
                    setSecQuestions((prev) => {
                      const next = [...prev] as [string, string, string];
                      next[pickerSlot] = item;
                      return next;
                    });
                    setPickerSlot(null);
                  }}
                >
                  <Text style={styles.pickerItemText}>{item}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

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
                style={({ pressed }) => [styles.alertBtn, pressed && styles.alertBtnCancelPressed]}
                onPress={() => setShowLogoutConfirm(false)}
                disabled={loggingOut}
              >
                {({ pressed }) => (
                  <Text style={[styles.alertBtnCancelText, pressed && styles.alertBtnCancelTextPressed]}>Cancel</Text>
                )}
              </Pressable>
              <View style={styles.alertBtnDivider} />
              <Pressable
                style={({ pressed }) => [styles.alertBtn, pressed && styles.alertBtnConfirmPressed]}
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
                Are you sure you want to change your password? You'll need to use the new password the next time you log in.
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
                onPress={() => { setShowPwConfirm(false); handleChangePassword(); }}
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
    marginBottom: spacing.lg,
  },

  sectionCard: {
    width: "100%",
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
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
    backgroundColor: colors.white,
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
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.md,
    ...shadow.button,
  },

  // ── Edit Profile: Cancel / Save row ─────────
  pwActionsRow: {
    flexDirection: "row",
    gap: spacing.md,
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

  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.errorSoft,
    paddingVertical: 16,
    marginTop: spacing.lg,
  },
  logoutBtnPressed: {
    backgroundColor: colors.error,
  },
  logoutBtnText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    color: colors.error,
  },
  logoutBtnTextPressed: {
    color: colors.white,
  },

  // ── Security question picker ─────────────────────────────────────────────────

  pickerOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xxl,
  },
  pickerCard: {
    width: "100%",
    maxHeight: "70%",
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow.raised,
  },
  pickerTitle: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginBottom: spacing.sm + 2,
  },
  pickerItem: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.mist,
  },
  pickerItemText: {
    fontSize: fontSize.sm,
    color: colors.ink,
    fontFamily: fontFamily.regular,
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
