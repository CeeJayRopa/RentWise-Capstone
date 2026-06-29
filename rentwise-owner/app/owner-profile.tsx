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
import { router } from "expo-router";
import { onAuthStateChanged, updatePassword } from "firebase/auth";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { auth } from "../shared/services/auth";
import { getUserById, updateUserProfile } from "../shared/services/userServices";

export default function OwnerProfile() {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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

  const toastAnim = useRef(new Animated.Value(0)).current;
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
        const un = data.userName ?? "";
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
    Animated.sequence([
      Animated.timing(toastAnim, { toValue: 1, duration: 250, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.delay(1800),
      Animated.timing(toastAnim, { toValue: 0, duration: 300, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(() => setToastVisible(false));
  };

  const handleSave = async () => {
    const user = auth.currentUser;
    if (!user) return;
    setSaving(true);
    try {
      const fn = firstName.trim();
      const ln = lastName.trim();
      const un = username.trim();
      const cn = contactNo.trim();
      await updateUserProfile(user.uid, { firstName: fn, lastName: ln, username: un, contactNo: cn });
      setOriginal({ firstName: fn, lastName: ln, username: un, contactNo: cn });
      showToast("Profile saved!");
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "Failed to update profile.");
    } finally {
      setSaving(false);
    }
  };

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
          style={styles.input}
          value={lastName}
          onChangeText={setLastName}
          placeholder="Last Name"
          placeholderTextColor="#B5D4F4"
        />

        {/* First Name */}
        <Text style={styles.fieldLabel}>First Name</Text>
        <TextInput
          style={styles.input}
          value={firstName}
          onChangeText={setFirstName}
          placeholder="First Name"
          placeholderTextColor="#B5D4F4"
        />

        {/* Username */}
        <Text style={styles.fieldLabel}>Username</Text>
        <View style={styles.rowField}>
          <TextInput
            style={styles.rowInput}
            value={username}
            onChangeText={setUsername}
            placeholder="username"
            placeholderTextColor="#B5D4F4"
            autoCapitalize="none"
          />
          <Text style={styles.suffix}>@rentwise.app</Text>
        </View>

        {/* Contact */}
        <Text style={styles.fieldLabel}>Contact No.</Text>
        <View style={styles.rowField}>
          <Text style={styles.prefix}>+63</Text>
          <TextInput
            style={styles.rowInput}
            value={contactNo}
            onChangeText={(t) => setContactNo(t.replace(/\D/g, "").slice(0, 11))}
            placeholder="09XXXXXXXXX"
            placeholderTextColor="#B5D4F4"
            keyboardType="phone-pad"
            maxLength={11}
          />
        </View>

        {/* Save Button */}
        <TouchableOpacity
          style={[styles.saveBtn, (saving || (firstName === original.firstName && lastName === original.lastName && username === original.username && contactNo === original.contactNo)) && styles.btnDisabled]}
          onPress={handleSave}
          disabled={saving || (firstName === original.firstName && lastName === original.lastName && username === original.username && contactNo === original.contactNo)}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color="#FFFFFF" size="small" />
            : <Text style={styles.saveBtnText}>Save</Text>
          }
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.divider} />

        <Text style={styles.sectionTitle}>Change Password</Text>

        {/* New Password */}
        <Text style={styles.fieldLabel}>New Password</Text>
        <View style={[styles.pwField, !!pwError && styles.pwFieldError]}>
          <TextInput
            style={styles.pwInput}
            value={newPassword}
            onChangeText={(t) => { setNewPassword(t); setPwError(""); if (confirmPassword && confirmPassword === t) setConfirmError(""); }}
            secureTextEntry={!showNewPass}
            placeholder="New password"
            placeholderTextColor="#B5D4F4"
            autoCapitalize="none"
            maxLength={12}
          />
          <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowNewPass((v) => !v)} activeOpacity={0.7}>
            <Ionicons name={showNewPass ? "eye-outline" : "eye-off-outline"} size={18} color="#1A4DA0" />
          </TouchableOpacity>
        </View>
        {!!pwError && <Text style={styles.fieldError}>{pwError}</Text>}
        <Text style={styles.pwHint}>Min. 8 characters with Capitalize letter, number and special characters</Text>

        {/* Confirm Password */}
        <Text style={styles.fieldLabel}>Confirm Password</Text>
        <View style={[styles.pwField, !!confirmError && styles.pwFieldError]}>
          <TextInput
            style={styles.pwInput}
            value={confirmPassword}
            onChangeText={(t) => { setConfirmPassword(t); setConfirmError(t && t !== newPassword ? "Passwords do not match." : ""); }}
            secureTextEntry={!showConfirmPass}
            placeholder="Confirm new password"
            placeholderTextColor="#B5D4F4"
            autoCapitalize="none"
            maxLength={12}
          />
          <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowConfirmPass((v) => !v)} activeOpacity={0.7}>
            <Ionicons name={showConfirmPass ? "eye-outline" : "eye-off-outline"} size={18} color="#1A4DA0" />
          </TouchableOpacity>
        </View>
        {!!confirmError && <Text style={styles.fieldError}>{confirmError}</Text>}

        {/* Update Password Button */}
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
      </ScrollView>

      {/* Toast */}
      {toastVisible && (
        <Animated.View
          style={[
            styles.toast,
            {
              opacity: toastAnim,
              transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
            },
          ]}
        >
          <Ionicons name="checkmark-circle-outline" size={18} color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.toastText}>{toastMsg}</Text>
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

  toast: {
    position: "absolute",
    bottom: 40,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0C2D6B",
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 20,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  toastText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
});
