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
import { ArrowLeft, HelpCircle, Eye, EyeOff, ChevronDown, CheckCircle2, LogOut, BadgeCheck, Contact, Pencil, LockKeyhole, KeyRound } from "lucide-react-native";

import { auth, logoutUser } from "../shared/services/auth";
import { clearLocalCache } from "../shared/services/localCache";
import { setRememberMe } from "../shared/services/rememberMe";
import { firebaseApp } from "../shared/firebaseConfig";
import { getUserById } from "../shared/services/userServices";
import HelpTour, { HelpStep } from "./components/HelpTour";
import HelpSupportModal from "./components/HelpSupportModal";
import { hasSeenPageTour, markPageTourSeen } from "../shared/services/onboardingTour";
import { Card } from "../shared/components/ui";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../shared/theme";
import { RENTWISE_OWNER_USERNAME } from "../../shared/utils/username";

const cloudFunctions = getFunctions(firebaseApp);

const SECURITY_QUESTIONS = [
  "What year did you start managing the market?",
  "What was the original name of the market?",
  "What was the first stall number you managed?",
  "What product category did your first tenant sell?",
  "What was the name of your first market administrator?",
  "What month did the market begin operating?",
  "Which market section was opened first?",
  "What landmark is closest to the market?",
];

export default function OwnerProfile() {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [contactNo, setContactNo] = useState("");
  const [original, setOriginal] = useState({ firstName: "", middleName: "", lastName: "", username: "", contactNo: "" });
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
  const [secQuestions, setSecQuestions] = useState<string[]>(["", "", "", "", ""]);
  const [secAnswers, setSecAnswers] = useState<string[]>(["", "", "", "", ""]);
  const [showSecAnswers, setShowSecAnswers] = useState<boolean[]>([false, false, false, false, false]);
  const [savedSecQuestions, setSavedSecQuestions] = useState<string[]>([]);
  const [secQuestionCount, setSecQuestionCount] = useState<number | null>(null);
  const [secCurrentPassword, setSecCurrentPassword] = useState("");
  const [showSecCurrentPass, setShowSecCurrentPass] = useState(false);
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [savingSecQ, setSavingSecQ] = useState(false);

  const [focusedField, setFocusedField] = useState<string | null>(null);

  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(20)).current;
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const [tourVisible, setTourVisible] = useState(false);
  const [helpSupportVisible, setHelpSupportVisible] = useState(false);
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
    { key: "secquestions", ref: secQSectionRef, title: "Security questions", description: "Set 5 recovery questions so you can get back into your account if you ever forget your password.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(secQSectionRef) },
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
        const mn = data.middleName ?? "";
        const ln = data.lastName ?? "";
        const un = RENTWISE_OWNER_USERNAME;
        const cn = data.contactNo ?? "";
        setFirstName(fn);
        setMiddleName(mn);
        setLastName(ln);
        setUsername(un);
        setContactNo(cn);
        setOriginal({ firstName: fn, middleName: mn, lastName: ln, username: un, contactNo: cn });
      }
      try {
        const getRecoveryStatus = httpsCallable(cloudFunctions, "getOwnerRecoveryQuestionStatus");
        const status = (await getRecoveryStatus()).data as {questionCount?: number; questions?: string[]};
        const savedQuestions = Array.isArray(status.questions) ? status.questions.slice(0, 5) : [];
        setSavedSecQuestions(savedQuestions);
        setSecQuestionCount(Number(status.questionCount ?? savedQuestions.length));
      } catch (recoveryError) {
        console.error("Failed to load recovery-question status", recoveryError);
        setSecQuestionCount(null);
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
    else if (!/^9\d{9}$/.test(cn)) { setContactNoError("Enter a valid 10-digit number starting with 9."); valid = false; }
    else setContactNoError("");

    return valid;
  };

  const handleSave = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const fn = firstName.trim();
    const mn = middleName.trim();
    const ln = lastName.trim();
    const un = RENTWISE_OWNER_USERNAME;
    const cn = contactNo.trim();

    if (!validateProfileFields(fn, ln, un, cn)) return;

    setSaving(true);
    try {
      const updateProfile = httpsCallable(cloudFunctions, "ownerUpdateOwnProfile");
      await updateProfile({ firstName: fn, middleName: mn, lastName: ln, contactNo: cn });
      setUsername(un);
      setOriginal({ firstName: fn, middleName: mn, lastName: ln, username: un, contactNo: cn });
      setIsEditing(false);
      showToast("Profile saved!");
    } catch (err: any) {
      console.error(err);
      Alert.alert(
        "Error",
        err?.code === "functions/unauthenticated"
          ? "Please sign out and sign in again before changing your recovery number."
          : "Failed to update profile.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEditProfile = () => {
    setFirstName(original.firstName);
    setMiddleName(original.middleName);
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
    setSecQuestions(["", "", "", "", ""]);
    setSecAnswers(["", "", "", "", ""]);
    setShowSecAnswers([false, false, false, false, false]);
    setSecCurrentPassword("");
    setPickerSlot(null);
    setSecEditing(false);
  }

  // Only one section can be in edit mode at a time -- opening one closes
  // (and discards) the other two, same as if Cancel had been pressed on them.
  function handleStartEditProfile() {
    handleCancelPasswordEdit();
    handleCancelSecQuestionsEdit();
    setUsername(RENTWISE_OWNER_USERNAME);
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
    setSecQuestions([...savedSecQuestions, "", "", "", "", ""].slice(0, 5));
    setSecAnswers(["", "", "", "", ""]);
    setShowSecAnswers([false, false, false, false, false]);
    setSecEditing(true);
  }

  const hasChanges =
    firstName !== original.firstName ||
    middleName !== original.middleName ||
    lastName !== original.lastName ||
    username !== original.username ||
    contactNo !== original.contactNo;

  const hasEmptyField =
    !firstName.trim() || !lastName.trim() || !username.trim() || !contactNo.trim();

  const passwordHasCapital = /[A-Z]/.test(newPassword);
  const passwordHasNumber = /\d/.test(newPassword);
  const passwordHasSpecial = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]/.test(newPassword);
  const passwordStrong = newPassword.length >= 8 && passwordHasCapital && passwordHasNumber && passwordHasSpecial;
  const passwordsMatch = confirmPassword.length > 0 && confirmPassword === newPassword;

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
      const finalizePassword = httpsCallable(cloudFunctions, "ownerFinalizePasswordChange");
      await finalizePassword();
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
      Alert.alert("Incomplete", "Please pick all 5 questions and answer each one.");
      return;
    }
    if (secQuestionsDuplicated) {
      Alert.alert("Duplicate Questions", "Please choose 5 different questions.");
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
      // Ensure the callable receives the newly reauthenticated ID token and
      // its refreshed auth_time instead of a cached pre-verification token.
      await user.getIdToken(true);
      const saveFn = httpsCallable(cloudFunctions, "ownerSaveSecurityQuestions");
      await saveFn({
        securityQuestions: secQuestions.map((q, i) => ({ question: q, answer: secAnswers[i] })),
      });
      setSavedSecQuestions([...secQuestions]);
      setSecQuestionCount(5);
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
      await clearLocalCache().catch(() => {});
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
          <TouchableOpacity style={styles.headerBtn} onPress={() => setHelpSupportVisible(true)} activeOpacity={0.7}>
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
            <View style={styles.ownerAvatar}>
              <Text style={styles.ownerAvatarText}>{`${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()}</Text>
            </View>
            <View style={styles.identityCopy}>
              <Text style={styles.identityName} numberOfLines={1}>{[firstName, middleName, lastName].filter(Boolean).join(" ")}</Text>
              <View style={styles.identityRoleRow}>
                <BadgeCheck size={15} color={colors.emerald} />
                <Text style={styles.identityRole}>Market Owner</Text>
              </View>
            </View>
          </View>
        </Card>

        {/* FIELDS CARD */}
        <View ref={fieldsRef} collapsable={false} style={{ width: "100%" }}>
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
          </View>

          <View style={styles.nameColumn}>
          <Text style={styles.profileFieldLabel}>First Name</Text>
          <TextInput
            style={[
              styles.input,
              focusedField === "firstName" && isEditing && styles.inputFocused,
              !isEditing && styles.inputReadOnly,
              !!firstNameError && styles.inputErrorBorder,
            ]}
            value={firstName}
            onChangeText={(t) => {
              setFirstName(t);
              setUsername(RENTWISE_OWNER_USERNAME);
              if (firstNameError) setFirstNameError("");
            }}
            placeholder="First name"
            placeholderTextColor={colors.textMuted}
            onFocus={() => { setFocusedField("firstName"); scrollFieldIntoView(fieldsRef); }}
            onBlur={() => setFocusedField(null)}
            editable={isEditing}
          />
          {!!firstNameError && <Text style={styles.fieldError}>{firstNameError}</Text>}
          </View>
          </View>

          <Text style={styles.profileFieldLabel}>Middle Name</Text>
          <TextInput
            style={[
              styles.input,
              focusedField === "middleName" && isEditing && styles.inputFocused,
              !isEditing && styles.inputReadOnly,
            ]}
            value={middleName}
            onChangeText={setMiddleName}
            placeholder="Middle name (optional)"
            placeholderTextColor={colors.textMuted}
            onFocus={() => { setFocusedField("middleName"); scrollFieldIntoView(fieldsRef); }}
            onBlur={() => setFocusedField(null)}
            editable={isEditing}
          />

          <Text style={styles.profileFieldLabel}>Username</Text>
          <View
            style={[
              styles.rowField,
              focusedField === "username" && isEditing && styles.rowFieldFocused,
              !isEditing && styles.rowFieldReadOnly,
              !!usernameError && styles.inputErrorBorder,
            ]}
          >
            <Contact size={18} color={colors.emerald} style={styles.profileFieldIcon} />
            <TextInput
              style={[styles.rowInput, styles.rowInputReadOnly]}
              value={username}
              placeholder="username"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              onFocus={() => { setFocusedField("username"); scrollFieldIntoView(fieldsRef); }}
              onBlur={() => setFocusedField(null)}
              editable={false}
            />
          </View>
          {!!usernameError && <Text style={styles.fieldError}>{usernameError}</Text>}

          <Text style={styles.profileFieldLabel}>Registered Mobile Number</Text>
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
                onChangeText={(t) => { setContactNo(t.replace(/\D/g, "").slice(0, 10)); if (contactNoError) setContactNoError(""); }}
                placeholder="9XXXXXXXXX"
                placeholderTextColor={colors.textMuted}
                keyboardType="phone-pad"
                maxLength={10}
                onFocus={() => { setFocusedField("contactNo"); scrollFieldIntoView(fieldsRef); }}
                onBlur={() => setFocusedField(null)}
                editable={isEditing}
              />
              {!isEditing && <CheckCircle2 size={19} color={colors.emerald} style={styles.phoneVerifiedIcon} />}
            </View>
          </View>
          {!!contactNoError && <Text style={styles.fieldError}>{contactNoError}</Text>}
        </View>
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
                <View style={styles.editButtonContent}>
                  <Pencil size={17} color={pressed ? colors.ink : colors.white} />
                  <Text style={[styles.saveBtnText, pressed && styles.saveBtnTextPressed]}>Edit Profile Details</Text>
                </View>
              )}
            </Pressable>
          )}
        </View>

        {/* PASSWORD CARD */}
        <View ref={pwSectionRef} collapsable={false} style={{ width: "100%" }}>
        <Card style={styles.sectionCard}>
          <View style={styles.passwordSectionHeading}>
            <KeyRound size={17} color={colors.emerald} />
            <Text style={[styles.sectionTitle, styles.passwordSectionTitle]}>Change Password</Text>
          </View>

          <View style={styles.passwordLabelRow}>
            <Text style={styles.passwordFieldLabel}>Current Password</Text>
          </View>
          <View style={[styles.pwField, !!oldPwError && styles.inputErrorBorder]}>
            <LockKeyhole size={16} color={colors.textMuted} style={styles.passwordInputIcon} />
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
              {showOldPass ? <EyeOff size={17} color={colors.textSecondary} /> : <Eye size={17} color={colors.textSecondary} />}
            </TouchableOpacity>
          </View>
          {!!oldPwError && <Text style={styles.fieldError}>{oldPwError}</Text>}

          <Text style={styles.passwordFieldLabel}>New Password</Text>
          <View style={[styles.pwField, !!pwError && styles.inputErrorBorder]}>
            <LockKeyhole size={16} color={colors.textMuted} style={styles.passwordInputIcon} />
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
              {showNewPass ? <EyeOff size={17} color={colors.textSecondary} /> : <Eye size={17} color={colors.textSecondary} />}
            </TouchableOpacity>
          </View>
          {!!pwError && <Text style={styles.fieldError}>{pwError}</Text>}
          {pwEditing && (
            <View style={styles.passwordStrengthCard}>
              <View style={styles.passwordStrengthHeader}>
                <Text style={styles.passwordStrengthHint}>Minimum 8 characters with:</Text>
                <Text style={[styles.passwordStrengthStatus, passwordStrong && styles.passwordStrengthStatusStrong]}>{passwordStrong ? "Strong" : "Building"}</Text>
              </View>
              <View style={styles.passwordRequirementRow}>
                {[{ label: "Capital", met: passwordHasCapital }, { label: "Number", met: passwordHasNumber }, { label: "Special", met: passwordHasSpecial }].map((item) => (
                  <View key={item.label} style={[styles.passwordRequirement, item.met && styles.passwordRequirementMet]}>
                    <Text style={styles.passwordRequirementText}>{item.met ? "✓ " : ""}{item.label}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.passwordStrengthTrack}><View style={[styles.passwordStrengthFill, { width: passwordStrong ? "100%" : newPassword.length ? "45%" : "0%" }]} /></View>
            </View>
          )}

          <Text style={styles.passwordFieldLabel}>Confirm Password</Text>
          <View style={[styles.pwField, !!confirmError && styles.inputErrorBorder]}>
            <CheckCircle2 size={16} color={passwordsMatch ? colors.emerald : colors.textMuted} style={styles.passwordInputIcon} />
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
              {showConfirmPass ? <EyeOff size={17} color={colors.textSecondary} /> : <Eye size={17} color={colors.textSecondary} />}
            </TouchableOpacity>
          </View>
          {!!confirmError && <Text style={styles.fieldError}>{confirmError}</Text>}
          {pwEditing && passwordsMatch && <Text style={styles.passwordMatchText}>✓ Passwords match perfectly</Text>}

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
                    : <View style={styles.changePasswordContent}><KeyRound size={14} color={pressed ? colors.ink : colors.white} /><Text style={[styles.saveBtnText, styles.pwUpdateBtnText, pressed && styles.saveBtnTextPressed]}>Change Password</Text></View>
                }
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.updatePwBtn, pressed && styles.saveBtnPressed]}
              onPress={handleStartEditPassword}
            >
              {({ pressed }) => (
                <View style={styles.changePasswordContent}><KeyRound size={14} color={pressed ? colors.ink : colors.white} /><Text style={[styles.saveBtnText, pressed && styles.saveBtnTextPressed]}>Change Password</Text></View>
              )}
            </Pressable>
          )}
        </Card>
        </View>

        {/* SECURITY QUESTIONS CARD */}
        <View ref={secQSectionRef} collapsable={false} style={{ width: "100%" }}>
        <View style={styles.securityQuestionsSection}>
          {!secEditing && (
            <View style={styles.recoveryQuestionCard}>
              <View style={styles.recoveryQuestionHeading}>
                <LockKeyhole size={17} color={colors.emerald} />
                <Text style={styles.recoveryQuestionTitle}>Recovery Questions</Text>
              </View>
              <Text style={styles.recoveryFieldLabel}>
                {secQuestionCount === null
                  ? "Recovery status is temporarily unavailable."
                  : secQuestionCount >= 5
                    ? "5 recovery questions configured."
                    : secQuestionCount >= 3
                      ? `${secQuestionCount} of 5 questions configured. Update required.`
                      : "Recovery questions have not been configured."}
              </Text>
            </View>
          )}

          {secEditing && [0, 1, 2, 3, 4].map((slot) => (
            <View key={slot} style={styles.recoveryQuestionCard}>
              <View style={styles.recoveryQuestionHeading}>
                <View style={styles.questionNumberBadge}><Text style={styles.questionNumberText}>{String(slot + 1).padStart(2, "0")}</Text></View>
                <Text style={styles.recoveryQuestionTitle}>{["Question One", "Question Two", "Question Three", "Question Four", "Question Five"][slot]}</Text>
              </View>
              <Text style={styles.recoveryFieldLabel}>Select Question</Text>
              <TouchableOpacity
                style={styles.recoverySelect}
                onPress={() => setPickerSlot(slot)}
                disabled={!secEditing}
                activeOpacity={0.7}
              >
                <Text style={[styles.recoverySelectText, !secQuestions[slot] && { color: colors.textMuted }]} numberOfLines={1}>
                  {secQuestions[slot] || "Select a question"}
                </Text>
                <ChevronDown size={15} color={colors.ink} />
              </TouchableOpacity>

              <Text style={styles.recoveryFieldLabel}>Your Answer</Text>
              <View style={styles.recoveryAnswerField}>
                {secEditing ? <Pencil size={15} color={colors.textMuted} /> : <LockKeyhole size={15} color={colors.textMuted} />}
                <TextInput
                  style={styles.recoveryAnswerInput}
                  value={secAnswers[slot]}
                  onChangeText={(t) => setSecAnswers((prev) => {
                    const next = [...prev];
                    next[slot] = t;
                    return next;
                  })}
                  secureTextEntry={!showSecAnswers[slot]}
                  placeholder="Your answer"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  onFocus={() => scrollFieldIntoView(secQSectionRef)}
                  editable={secEditing}
                />
                <TouchableOpacity onPress={() => setShowSecAnswers((prev) => {
                  const next = [...prev];
                  next[slot] = !next[slot];
                  return next;
                })} activeOpacity={0.7}>
                  {showSecAnswers[slot] ? <Eye size={17} color={colors.ink} /> : <EyeOff size={17} color={colors.ink} />}
                </TouchableOpacity>
              </View>
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
                  : <Text style={[styles.saveBtnText, styles.pwUpdateBtnText, pressed && styles.saveBtnTextPressed]}>Save Recovery Questions</Text>
                }
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.updatePwBtn, styles.recoveryEditButton, pressed && styles.saveBtnPressed]}
              onPress={handleStartEditSecQuestions}
            >
              {({ pressed }) => (
                <Text style={[styles.saveBtnText, styles.recoveryEditButtonText, pressed && styles.saveBtnTextPressed]}>
                  {secQuestionCount !== null && secQuestionCount < 5 ? "Set Up Recovery Questions" : "Edit Recovery Questions"}
                </Text>
              )}
            </Pressable>
          )}
        </View>
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
                      const next = [...prev];
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
      <HelpSupportModal visible={helpSupportVisible} steps={tourSteps} onClose={() => setHelpSupportVisible(false)} onReplayTour={() => setTourVisible(true)} />

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
  ownerAvatar: { width: 50, height: 50, borderRadius: 12, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" },
  ownerAvatarText: { fontSize: 19, fontFamily: fontFamily.bold, color: colors.emeraldBright },

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

  // ── Fields card / sections ───────────────────────────────────────────────────

  fieldsCard: {
    width: "100%",
    marginBottom: 14,
  },

  personalHeading: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16 },
  personalAccent: { width: 6, height: 16, borderRadius: 3, backgroundColor: colors.emerald },
  personalHeadingText: { fontSize: 13, fontFamily: fontFamily.semibold, color: colors.ink, textTransform: "uppercase", letterSpacing: 0.5 },
  nameRow: { flexDirection: "row", gap: 10 },
  nameColumn: { flex: 1 },
  profileFieldLabel: { fontSize: 11, fontFamily: fontFamily.medium, color: colors.ink, marginBottom: 7, marginLeft: 2 },
  profileFieldIcon: { marginLeft: 14 },

  sectionCard: {
    width: "100%",
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },

  passwordSectionHeading: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16 },
  passwordSectionTitle: { marginBottom: 0, fontSize: 14 },
  passwordLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  passwordFieldLabel: { fontSize: 10, fontFamily: fontFamily.semibold, color: colors.ink, marginBottom: 6 },

  sectionTitle: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginBottom: spacing.lg,
  },

  securityQuestionsSection: { width: "100%", marginTop: 18, marginBottom: 8 },
  recoveryQuestionCard: { width: "100%", backgroundColor: colors.white, borderRadius: 11, padding: 12, marginBottom: 12, ...shadow.card },
  recoveryQuestionHeading: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 10 },
  questionNumberBadge: { minWidth: 22, height: 20, borderRadius: 10, paddingHorizontal: 4, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" },
  questionNumberText: { fontSize: 10, color: colors.emeraldSoft, fontFamily: fontFamily.bold },
  recoveryQuestionTitle: { fontSize: 14, color: colors.ink, fontFamily: fontFamily.semibold },
  recoveryFieldLabel: { fontSize: 9, color: colors.ink, fontFamily: fontFamily.medium, marginBottom: 5 },
  recoverySelect: { minHeight: 37, flexDirection: "row", alignItems: "center", borderRadius: 6, backgroundColor: colors.mist, paddingHorizontal: 11, marginBottom: 9 },
  recoverySelectText: { flex: 1, fontSize: 11, color: colors.ink, fontFamily: fontFamily.regular, marginRight: 8 },
  recoveryAnswerField: { minHeight: 37, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 6, backgroundColor: colors.mist, paddingHorizontal: 11 },
  recoveryAnswerInput: { flex: 1, paddingVertical: 8, fontSize: 12, color: colors.ink, fontFamily: fontFamily.medium },
  recoveryEditButton: { minHeight: 46, paddingVertical: 11, marginTop: 7 },
  recoveryEditButtonText: { fontSize: 13 },

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
    backgroundColor: colors.white,
  },

  inputReadOnly: {
    backgroundColor: colors.white,
    borderRadius: 12,
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
    minHeight: 54,
    borderRadius: 12,
    borderWidth: 0,
    backgroundColor: colors.white,
    overflow: "hidden",
    marginBottom: 16,
    ...shadow.card,
  },

  rowFieldFocused: {
    borderColor: colors.emeraldBright,
    backgroundColor: colors.white,
  },

  rowFieldReadOnly: {
    backgroundColor: colors.white,
    borderRadius: 12,
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
    gap: 0,
    marginBottom: 16,
    minHeight: 54,
    padding: 5,
    backgroundColor: colors.white,
    borderRadius: 12,
    ...shadow.card,
  },

  phonePrefix: {
    minHeight: 44,
    backgroundColor: colors.mist,
    borderRadius: 8,
    paddingHorizontal: 13,
    paddingVertical: 10,
    justifyContent: "center",
    alignItems: "center",
  },

  phonePrefixReadOnly: {
    backgroundColor: colors.mist,
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
    borderRadius: 8,
    borderWidth: 0,
    backgroundColor: colors.white,
    overflow: "hidden",
  },
  phoneVerifiedIcon: { marginRight: 10 },

  // ── Password fields ───────────────────────────────────────────────────────────

  pwField: {
    width: "100%",
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 7,
    borderWidth: 0,
    backgroundColor: colors.mist,
    marginBottom: 10,
  },

  passwordInputIcon: { marginLeft: 10 },
  eyeBtn: { paddingHorizontal: 10, paddingVertical: 10 },

  passwordStrengthCard: { backgroundColor: colors.mist, borderRadius: 7, padding: 7, marginTop: -4, marginBottom: 10 },
  passwordStrengthHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  passwordStrengthHint: { fontSize: 8, color: colors.ink, fontFamily: fontFamily.regular },
  passwordStrengthStatus: { fontSize: 8, color: colors.textSecondary, fontFamily: fontFamily.semibold },
  passwordStrengthStatusStrong: { color: colors.emerald },
  passwordRequirementRow: { flexDirection: "row", gap: 4 },
  passwordRequirement: { flex: 1, minHeight: 20, borderRadius: 3, backgroundColor: colors.border, alignItems: "center", justifyContent: "center" },
  passwordRequirementMet: { backgroundColor: "#8EF0CF" },
  passwordRequirementText: { fontSize: 8, color: colors.ink, fontFamily: fontFamily.semibold },
  passwordStrengthTrack: { height: 3, borderRadius: 2, backgroundColor: colors.border, marginTop: 7, overflow: "hidden" },
  passwordStrengthFill: { height: 3, borderRadius: 2, backgroundColor: colors.emerald },
  passwordMatchText: { fontSize: 8, color: colors.emerald, fontFamily: fontFamily.semibold, marginTop: -5, marginBottom: 9 },
  changePasswordContent: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },

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
    borderRadius: 12,
    backgroundColor: colors.ink,
    minHeight: 54,
    paddingVertical: 14,
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

  editButtonContent: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },

  saveBtnTextPressed: {
    color: colors.ink,
  },

  updatePwBtn: {
    width: "100%",
    borderRadius: 8,
    backgroundColor: colors.ink,
    minHeight: 42,
    paddingVertical: 11,
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
