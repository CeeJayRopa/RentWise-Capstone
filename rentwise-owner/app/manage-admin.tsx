import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  Alert,
} from "react-native";
import { router } from "expo-router";
import { onAuthStateChanged, updatePassword } from "firebase/auth";
import { collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import { Colors } from "../shared/constants/color";
import OwnerSidebar from "./components/OwnerSidebar";

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
  const [admin, setAdmin] = useState<AdminDoc | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [contactNo, setContactNo] = useState("");
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [pwError, setPwError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [changingPw, setChangingPw] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) { router.replace("/"); return; }
      setChecking(false);
      fetchAdmin();
    });
    return unsub;
  }, []);

  const fetchAdmin = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "users"), where("role", "==", "admin")));
      if (!snap.empty) {
        const d = snap.docs[0];
        const data = { uid: d.id, ...d.data() } as AdminDoc;
        setAdmin(data);
        setFirstName(data.firstName ?? "");
        setLastName(data.lastName ?? "");
        setUsername(data.username ?? "");
        setContactNo(data.contactNo ?? "");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!admin) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "users", admin.uid), {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        username: username.trim(),
        contactNo: contactNo.trim(),
      });
      Alert.alert("Success", "Admin profile updated successfully.");
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "Failed to update admin profile.");
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    const pwRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]).{8,12}$/;
    let valid = true;

    if (!pwRegex.test(newPassword)) {
      setPwError("8–12 characters with letters, numbers, and special characters.");
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
      Alert.alert("Success", "Password changed successfully.");
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

  if (checking) {
    return <View style={styles.fullCenter}><ActivityIndicator color={Colors.primary} size="large" /></View>;
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.menuBtn} onPress={() => setSidebarVisible(true)} activeOpacity={0.7}>
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>RentWise</Text>
        <View style={styles.menuBtn} />
      </View>

      <View style={styles.banner}>
        <Text style={styles.bannerText}>Manage Admin</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.primary} size="large" style={styles.loader} />
      ) : !admin ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>No admin account found.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
          <Text style={styles.fieldLabel}>First Name</Text>
          <TextInput
            style={styles.input}
            value={firstName}
            onChangeText={setFirstName}
            placeholder="First Name"
            placeholderTextColor={Colors.textMuted}
          />

          <Text style={styles.fieldLabel}>Last Name</Text>
          <TextInput
            style={styles.input}
            value={lastName}
            onChangeText={setLastName}
            placeholder="Last Name"
            placeholderTextColor={Colors.textMuted}
          />

          <Text style={styles.fieldLabel}>Username</Text>
          <View style={styles.usernameRow}>
            <TextInput
              style={styles.usernameInput}
              value={username}
              onChangeText={setUsername}
              placeholder="username"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
            />
            <Text style={styles.usernameSuffix}>@rentwise.app</Text>
          </View>

          <Text style={styles.fieldLabel}>Contact Number</Text>
          <View style={styles.phoneRow}>
            <Text style={styles.phonePrefix}>+63</Text>
            <TextInput
              style={styles.phoneInput}
              value={contactNo}
              onChangeText={(t) => setContactNo(t.replace(/\D/g, "").slice(0, 11))}
              placeholder="09XXXXXXXXX"
              placeholderTextColor={Colors.textMuted}
              keyboardType="phone-pad"
              maxLength={11}
            />
          </View>

          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.btnDisabled]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.saveBtnText}>Save Changes</Text>
            )}
          </TouchableOpacity>

          <View style={styles.sectionDivider} />
          <Text style={styles.sectionTitle}>Change Password</Text>

          <Text style={styles.fieldLabel}>New Password</Text>
          <View style={[styles.pwRow, !!pwError && styles.pwRowError]}>
            <TextInput
              style={styles.pwInput}
              value={newPassword}
              onChangeText={(t) => { setNewPassword(t); setPwError(""); }}
              secureTextEntry={!showNewPass}
              placeholder="New password"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowNewPass((v) => !v)} activeOpacity={0.7}>
              <Text style={styles.eyeIcon}>{showNewPass ? "Hide" : "Show"}</Text>
            </TouchableOpacity>
          </View>
          {!!pwError && <Text style={styles.fieldError}>{pwError}</Text>}
          <Text style={styles.pwHint}>8–12 characters, include letters, numbers & special characters</Text>

          <Text style={styles.fieldLabel}>Confirm Password</Text>
          <View style={[styles.pwRow, !!confirmError && styles.pwRowError]}>
            <TextInput
              style={styles.pwInput}
              value={confirmPassword}
              onChangeText={(t) => { setConfirmPassword(t); setConfirmError(""); }}
              secureTextEntry={!showConfirmPass}
              placeholder="Confirm new password"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowConfirmPass((v) => !v)} activeOpacity={0.7}>
              <Text style={styles.eyeIcon}>{showConfirmPass ? "Hide" : "Show"}</Text>
            </TouchableOpacity>
          </View>
          {!!confirmError && <Text style={styles.fieldError}>{confirmError}</Text>}

          <TouchableOpacity
            style={[styles.saveBtn, styles.changePwBtn, changingPw && styles.btnDisabled]}
            onPress={handleChangePassword}
            disabled={changingPw}
            activeOpacity={0.8}
          >
            {changingPw ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.saveBtnText}>Update Password</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      )}

      <OwnerSidebar visible={sidebarVisible} onClose={() => setSidebarVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  fullCenter: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: Colors.background },
  header: {
    backgroundColor: "#1A1A1A",
    paddingBottom: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  menuBtn: { width: 36, alignItems: "center", justifyContent: "center" },
  menuIcon: { fontSize: 24, color: "#FFFFFF" },
  headerTitle: { fontSize: 20, fontWeight: "700", color: "#FFFFFF" },
  banner: { backgroundColor: "#8D7B6A", paddingVertical: 18, alignItems: "center" },
  bannerText: { fontSize: 18, fontWeight: "700", color: "#FFFFFF" },
  loader: { marginTop: 60 },
  emptyBox: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { fontSize: 15, color: Colors.textMuted },
  content: { padding: 20 },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: Colors.textSecondary, marginBottom: 6 },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.textPrimary,
    marginBottom: 16,
  },
  usernameRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    marginBottom: 16,
  },
  usernameInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  usernameSuffix: {
    fontSize: 13,
    color: Colors.textMuted,
    paddingRight: 12,
    fontWeight: "500",
  },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    marginBottom: 16,
  },
  phonePrefix: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.textPrimary,
    fontWeight: "600",
    borderRightWidth: 1,
    borderRightColor: Colors.border,
  },
  phoneInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginTop: 24,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginBottom: 16,
  },
  pwRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    marginBottom: 4,
  },
  pwRowError: { borderColor: Colors.error },
  pwInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  eyeBtn: { paddingHorizontal: 12, paddingVertical: 12 },
  eyeIcon: { fontSize: 13, color: Colors.textMuted, fontWeight: "600" },
  fieldError: { fontSize: 12, color: Colors.error, marginBottom: 4 },
  pwHint: { fontSize: 11, color: Colors.textMuted, marginBottom: 16 },
  saveBtn: {
    marginTop: 8,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  changePwBtn: { marginTop: 4, marginBottom: 8 },
  btnDisabled: { opacity: 0.5 },
  saveBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
});
