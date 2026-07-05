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
import { router } from "expo-router";
import {
  onAuthStateChanged,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { auth } from "../shared/services/auth";
import { firebaseApp } from "../shared/firebaseConfig";
import { getUserById, updateUserProfile, isUsernameTaken } from "../shared/services/userServices";

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

  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(20)).current;
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMsg, setToastMsg] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) { router.replace("/login"); return; }
      setChecking(false);
      loadProfile(user.uid);
    });
    return unsub;
  }, []);

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

  const handleSave = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const fn = firstName.trim();
    const ln = lastName.trim();
    const un = username.trim();
    const cn = contactNo.trim();

    if (!fn || !ln || !un || !cn) {
      Alert.alert("Missing Information", "All fields are required.");
      return;
    }

    setSaving(true);
    try {
      if (un !== original.username) {
        const taken = await isUsernameTaken(un, "owner", user.uid);
        if (taken) {
          Alert.alert("Username Taken", "This username is already in use. Please choose another.");
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

  if (checking || loading) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator color="#0C2D6B" size="large" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.replace("/dashboard")} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color="#E6F1FB" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>RentWise</Text>
        <View style={styles.headerBtn} />
      </View>

      {/* Sub-header */}
      <View style={styles.subHeader}>
        <Text style={styles.subHeaderText}>My Account</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Last Name */}
        <Text style={styles.fieldLabel}>Last Name</Text>
        <TextInput
          style={[styles.input, !isEditing && styles.inputReadOnly]}
          value={lastName}
          onChangeText={setLastName}
          placeholder="Last Name"
          placeholderTextColor="#B5D4F4"
          editable={isEditing}
        />

        {/* First Name */}
        <Text style={styles.fieldLabel}>First Name</Text>
        <TextInput
          style={[styles.input, !isEditing && styles.inputReadOnly]}
          value={firstName}
          onChangeText={setFirstName}
          placeholder="First Name"
          placeholderTextColor="#B5D4F4"
          editable={isEditing}
        />

        {/* Username */}
        <Text style={styles.fieldLabel}>Username</Text>
        <View style={[styles.rowField, !isEditing && styles.rowFieldReadOnly]}>
          <TextInput
            style={[styles.rowInput, !isEditing && styles.rowInputReadOnly]}
            value={username}
            onChangeText={setUsername}
            placeholder="username"
            placeholderTextColor="#B5D4F4"
            autoCapitalize="none"
            editable={isEditing}
          />
          <Text style={styles.suffix}>@rentwise.app</Text>
        </View>

        {/* Contact */}
        <Text style={styles.fieldLabel}>Contact No.</Text>
        <View style={[styles.rowField, !isEditing && styles.rowFieldReadOnly]}>
          <Text style={styles.prefix}>+63</Text>
          <TextInput
            style={[styles.rowInput, !isEditing && styles.rowInputReadOnly]}
            value={contactNo}
            onChangeText={(t) => setContactNo(t.replace(/\D/g, "").slice(0, 11))}
            placeholder="09XXXXXXXXX"
            placeholderTextColor="#B5D4F4"
            keyboardType="phone-pad"
            maxLength={11}
            editable={isEditing}
          />
        </View>

        {/* Edit / Save Button */}
        <TouchableOpacity
          style={[styles.saveBtn, isEditing && (saving || hasEmptyField || !hasChanges) && styles.btnDisabled]}
          onPress={isEditing ? handleSave : () => setIsEditing(true)}
          disabled={isEditing && (saving || hasEmptyField || !hasChanges)}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color="#FFFFFF" size="small" />
            : <Text style={styles.saveBtnText}>{isEditing ? "Save changes" : "Edit Profile"}</Text>
          }
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.divider} />

        <Text style={styles.sectionTitle}>Change Password</Text>

        {/* New Password */}
        <Text style={styles.fieldLabel}>New Password</Text>
        <View style={[styles.pwField, !isEditing && styles.pwFieldReadOnly, !!pwError && styles.pwFieldError]}>
          <TextInput
            style={styles.pwInput}
            value={newPassword}
            onChangeText={(t) => { setNewPassword(t); setPwError(""); if (confirmPassword && confirmPassword === t) setConfirmError(""); }}
            secureTextEntry={!showNewPass}
            placeholder="New password"
            placeholderTextColor="#B5D4F4"
            autoCapitalize="none"
            maxLength={12}
            editable={isEditing}
          />
          <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowNewPass((v) => !v)} activeOpacity={0.7}>
            <Ionicons name={showNewPass ? "eye-outline" : "eye-off-outline"} size={18} color="#1A4DA0" />
          </TouchableOpacity>
        </View>
        {!!pwError && <Text style={styles.fieldError}>{pwError}</Text>}
        <Text style={styles.pwHint}>Min. 8 characters with Capitalize letter, number and special characters</Text>

        {/* Confirm Password */}
        <Text style={styles.fieldLabel}>Confirm Password</Text>
        <View style={[styles.pwField, !isEditing && styles.pwFieldReadOnly, !!confirmError && styles.pwFieldError]}>
          <TextInput
            style={styles.pwInput}
            value={confirmPassword}
            onChangeText={(t) => { setConfirmPassword(t); setConfirmError(t && t !== newPassword ? "Passwords do not match." : ""); }}
            secureTextEntry={!showConfirmPass}
            placeholder="Confirm new password"
            placeholderTextColor="#B5D4F4"
            autoCapitalize="none"
            maxLength={12}
            editable={isEditing}
          />
          <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowConfirmPass((v) => !v)} activeOpacity={0.7}>
            <Ionicons name={showConfirmPass ? "eye-outline" : "eye-off-outline"} size={18} color="#1A4DA0" />
          </TouchableOpacity>
        </View>
        {!!confirmError && <Text style={styles.fieldError}>{confirmError}</Text>}

        {/* Update Password Button — only appears once Edit Profile has been tapped */}
        {isEditing && (
          <TouchableOpacity
            style={[styles.updatePwBtn, (changingPw || newPassword.length < 8 || confirmPassword.length < 8) && styles.btnDisabled]}
            onPress={handleChangePassword}
            disabled={changingPw || newPassword.length < 8 || confirmPassword.length < 8}
            activeOpacity={0.8}
          >
            {changingPw
              ? <ActivityIndicator color="#FFFFFF" size="small" />
              : <Text style={styles.saveBtnText}>Update Password</Text>
            }
          </TouchableOpacity>
        )}

        {/* Divider */}
        <View style={styles.divider} />

        <Text style={styles.sectionTitle}>Security Questions</Text>
        <Text style={styles.pwHint}>
          Set 3 questions so you can recover your password later if you forget it.
        </Text>

        {[0, 1, 2].map((slot) => (
          <View key={slot} style={{ width: "100%", marginTop: slot === 0 ? 12 : 0 }}>
            <Text style={styles.fieldLabel}>Question {slot + 1}</Text>
            <TouchableOpacity
              style={[styles.rowField, !isEditing && styles.rowFieldReadOnly, { paddingHorizontal: 14, paddingVertical: 12 }]}
              onPress={() => isEditing && setPickerSlot(slot as 0 | 1 | 2)}
              disabled={!isEditing}
              activeOpacity={0.7}
            >
              <Text style={[{ flex: 1, fontSize: 15, color: secQuestions[slot] ? "#0C2D6B" : "#B5D4F4" }]}>
                {secQuestions[slot] || "Select a question"}
              </Text>
              <Ionicons name="chevron-down" size={16} color="#1A4DA0" />
            </TouchableOpacity>

            <TextInput
              style={[styles.input, !isEditing && styles.inputReadOnly, { marginTop: 8 }]}
              value={secAnswers[slot]}
              onChangeText={(t) => setSecAnswers((prev) => {
                const next = [...prev] as [string, string, string];
                next[slot] = t;
                return next;
              })}
              placeholder="Your answer"
              placeholderTextColor="#B5D4F4"
              autoCapitalize="none"
              editable={isEditing}
            />
          </View>
        ))}

        {isEditing && (
          <>
            <Text style={styles.fieldLabel}>Current Password</Text>
            <View style={styles.pwField}>
              <TextInput
                style={styles.pwInput}
                value={secCurrentPassword}
                onChangeText={setSecCurrentPassword}
                secureTextEntry={!showSecCurrentPass}
                placeholder="Confirm it's you"
                placeholderTextColor="#B5D4F4"
                autoCapitalize="none"
              />
              <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowSecCurrentPass((v) => !v)} activeOpacity={0.7}>
                <Ionicons name={showSecCurrentPass ? "eye-outline" : "eye-off-outline"} size={18} color="#1A4DA0" />
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
                ? <ActivityIndicator color="#FFFFFF" size="small" />
                : <Text style={styles.saveBtnText}>Save Security Questions</Text>
              }
            </TouchableOpacity>
          </>
        )}
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
            <Ionicons name="checkmark-circle" size={22} color="#7AAEF0" />
            <Text style={styles.toastText}>{toastMsg}</Text>
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F0F4FA" },
  fullCenter: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F0F4FA" },

  header: {
    backgroundColor: "#0C2D6B",
    paddingBottom: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerBtn: { width: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 20, fontWeight: "700", color: "#FFFFFF" },

  subHeader: {
    backgroundColor: "#1A4DA0",
    paddingVertical: 14,
    alignItems: "center",
  },
  subHeaderText: { fontSize: 16, fontWeight: "600", color: "#FFFFFF" },

  scroll: { flex: 1 },
  content: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 28,
  },

  fieldLabel: {
    alignSelf: "flex-start",
    fontSize: 13,
    fontWeight: "600",
    color: "#1A4DA0",
    marginBottom: 6,
  },
  input: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#B5D4F4",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#0C2D6B",
    marginBottom: 16,
  },
  inputReadOnly: {
    backgroundColor: "#EEF2FA",
    color: "#6B87B8",
  },
  rowField: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#B5D4F4",
    marginBottom: 16,
  },
  rowInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#0C2D6B",
  },
  rowFieldReadOnly: {
    backgroundColor: "#EEF2FA",
  },
  rowInputReadOnly: {
    color: "#6B87B8",
  },
  suffix: {
    fontSize: 13,
    color: "#1A4DA0",
    paddingRight: 12,
    fontWeight: "500",
  },
  prefix: {
    paddingHorizontal: 12,
    fontSize: 15,
    color: "#0C2D6B",
    fontWeight: "600",
    borderRightWidth: 1,
    borderRightColor: "#B5D4F4",
    paddingVertical: 12,
  },

  saveBtn: {
    marginTop: 20,
    backgroundColor: "#0C2D6B",
    paddingVertical: 14,
    paddingHorizontal: 64,
    borderRadius: 30,
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.5 },
  saveBtnText: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },

  divider: {
    width: "100%",
    height: 1,
    backgroundColor: "#B5D4F4",
    marginTop: 28,
    marginBottom: 20,
  },
  sectionTitle: {
    alignSelf: "flex-start",
    fontSize: 15,
    fontWeight: "700",
    color: "#0C2D6B",
    marginBottom: 16,
  },

  pwField: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#B5D4F4",
    marginBottom: 4,
  },
  pwFieldError: { borderColor: "#C0392B" },
  pwFieldReadOnly: { backgroundColor: "#EEF2FA" },
  pwInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#0C2D6B",
  },
  eyeBtn: { paddingHorizontal: 12, paddingVertical: 12 },
  fieldError: { alignSelf: "flex-start", fontSize: 12, color: "#C0392B", marginBottom: 4 },
  pwHint: { alignSelf: "flex-start", fontSize: 11, color: "#7AAEF0", marginBottom: 16 },

  updatePwBtn: {
    marginTop: 20,
    backgroundColor: "#1A4DA0",
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 30,
    alignItems: "center",
    marginBottom: 8,
  },

  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(12,45,107,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  pickerCard: {
    width: "100%",
    maxHeight: "70%",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
  },
  pickerTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0C2D6B",
    marginBottom: 10,
  },
  pickerItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#EEF2FA",
  },
  pickerItemText: {
    fontSize: 14,
    color: "#0C2D6B",
  },

  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  toastText: {
    color: "#B5D4F4",
    fontSize: 18,
    fontWeight: "500",
  },
});
