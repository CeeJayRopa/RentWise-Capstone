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
  Modal,
  FlatList,
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

const FIELD_MINT = "#C7E3C2";
const FIELD_MINT_DARK = "#A9CBA1";

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

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [pwError, setPwError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [changingPw, setChangingPw] = useState(false);

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

  const tourSteps: HelpStep[] = [
    { key: "fields", ref: fieldsRef, title: "Your details", description: "Your last name, first name, login username, and contact number.", offsetY: 41, onBeforeMeasure: () => scrollSectionIntoView(fieldsRef) },
    { key: "edit", ref: editBtnRef, title: "Edit Profile", description: "Unlocks your name, username, and contact number so you can update them, plus the password fields below.", offsetY: 41, onBeforeMeasure: () => scrollSectionIntoView(editBtnRef) },
    { key: "password", ref: pwSectionRef, title: "Change password", description: "Set a new login password. Must be 8-12 characters with an uppercase letter, a number, and a special character.", offsetY: 41, onBeforeMeasure: () => scrollSectionIntoView(pwSectionRef) },
    { key: "secquestions", ref: secQSectionRef, title: "Security questions", description: "Set 3 recovery questions so you can get back into your account if you ever forget your password.", offsetY: 41, onBeforeMeasure: () => scrollSectionIntoView(secQSectionRef) },
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
    if (!user) return;
    setChangingPw(true);
    try {
      await updatePassword(user, newPassword);
      try {
        const syncFn = httpsCallable(cloudFunctions, "ownerSyncRecoveryPassword");
        await syncFn({ callerUid: user.uid, newPassword });
      } catch (syncErr) {
        // Non-fatal: the Auth password change already succeeded. Recovery
        // will just show the old password until the owner re-syncs it.
        console.error("Failed to sync recovery password:", syncErr);
      }
      setNewPassword("");
      setConfirmPassword("");
      showToast("Password updated!");
    } catch (err: any) {
      if (err?.code === "auth/requires-recent-login") {
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
      // Confirms secCurrentPassword is actually correct before it's ever
      // stored/returned as the "recovered" password later.
      await reauthenticateWithCredential(
        user,
        EmailAuthProvider.credential(user.email, secCurrentPassword),
      );
      const saveFn = httpsCallable(cloudFunctions, "ownerSaveSecurityQuestions");
      await saveFn({
        callerUid: user.uid,
        securityQuestions: secQuestions.map((q, i) => ({ question: q, answer: secAnswers[i] })),
        currentPassword: secCurrentPassword,
      });
      setSecCurrentPassword("");
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

  const handleLogout = async () => {
    await logoutUser();
    await setRememberMe(false);
    router.replace("/login");
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
        <View ref={editBtnRef} collapsable={false} style={{ width: "100%" }}>
          <TouchableOpacity
            style={[styles.saveBtn, isEditing && (saving || hasEmptyField || !hasChanges) && styles.btnDisabled]}
            onPress={isEditing ? handleSave : () => setIsEditing(true)}
            disabled={isEditing && (saving || hasEmptyField || !hasChanges)}
            activeOpacity={0.8}
          >
            {saving
              ? <ActivityIndicator color={colors.white} size="small" />
              : <Text style={styles.saveBtnText}>{isEditing ? "Save changes" : "Edit Profile"}</Text>
            }
          </TouchableOpacity>
        </View>

        {/* PASSWORD CARD */}
        <View ref={pwSectionRef} collapsable={false} style={{ width: "100%" }}>
        <Card style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Change Password</Text>

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

          {isEditing && (
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
                style={[styles.rowField, !isEditing && styles.rowFieldReadOnly, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 1 }]}
                onPress={() => isEditing && setPickerSlot(slot as 0 | 1 | 2)}
                disabled={!isEditing}
                activeOpacity={0.7}
              >
                <Text style={[{ flex: 1, fontSize: fontSize.base, fontFamily: fontFamily.medium, color: secQuestions[slot] ? colors.ink : colors.textMuted }]}>
                  {secQuestions[slot] || "Select a question"}
                </Text>
                <ChevronDown size={16} color={colors.emerald} />
              </TouchableOpacity>

              <TextInput
                style={[styles.input, !isEditing && styles.inputReadOnly, { marginTop: spacing.sm, marginBottom: 0 }]}
                value={secAnswers[slot]}
                onChangeText={(t) => setSecAnswers((prev) => {
                  const next = [...prev] as [string, string, string];
                  next[slot] = t;
                  return next;
                })}
                placeholder="Your answer"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                editable={isEditing}
              />
            </View>
          ))}

          {isEditing && (
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
                />
                <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowSecCurrentPass((v) => !v)} activeOpacity={0.7}>
                  {showSecCurrentPass ? <Eye size={18} color={colors.emerald} /> : <EyeOff size={18} color={colors.emerald} />}
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[
                  styles.updatePwBtn,
                  (savingSecQ || !secSlotsFilled || !secCurrentPassword) && styles.btnDisabled,
                ]}
                onPress={handleSaveSecurityQuestions}
                disabled={savingSecQ || !secSlotsFilled || !secCurrentPassword}
                activeOpacity={0.8}
              >
                {savingSecQ
                  ? <ActivityIndicator color={colors.white} size="small" />
                  : <Text style={styles.saveBtnText}>Save Security Questions</Text>
                }
              </TouchableOpacity>
            </>
          )}
        </Card>
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.7}>
          <LogOut size={18} color={colors.error} style={{ marginRight: spacing.sm + 2 }} />
          <Text style={styles.logoutBtnText}>Logout Account</Text>
        </TouchableOpacity>
      </ScrollView>

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
  logoutBtnText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    color: colors.error,
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
});
