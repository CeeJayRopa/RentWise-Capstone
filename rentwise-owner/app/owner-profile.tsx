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
import { onAuthStateChanged } from "firebase/auth";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { auth } from "../shared/services/auth";
import { getUserById, updateUserProfile } from "../shared/services/userServices";
import { Colors } from "../shared/constants/color";
import OwnerSidebar from "./components/OwnerSidebar";

export default function OwnerProfile() {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [contactNo, setContactNo] = useState("");
  const [sidebarVisible, setSidebarVisible] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) { router.replace("/"); return; }
      setChecking(false);
      loadProfile(user.uid);
    });
    return unsub;
  }, []);

  const loadProfile = async (uid: string) => {
    try {
      const data = await getUserById(uid);
      if (data) {
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
    const user = auth.currentUser;
    if (!user) return;
    setSaving(true);
    try {
      await updateUserProfile(user.uid, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        username: username.trim(),
        contactNo: contactNo.trim(),
      });
      Alert.alert("Success", "Profile updated successfully.");
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "Failed to update profile.");
    } finally {
      setSaving(false);
    }
  };

  if (checking || loading) {
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
        <Text style={styles.bannerText}>My Account</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.avatarWrapper}>
          <View style={styles.avatar}>
            <View style={styles.avatarHead} />
            <View style={styles.avatarBody} />
          </View>
          <View style={styles.editBadge}>
            <Text style={styles.editBadgeIcon}>✏</Text>
          </View>
        </View>

        <Text style={styles.fieldLabel}>Last Name</Text>
        <TextInput style={styles.input} value={lastName} onChangeText={setLastName} placeholder="Last Name" placeholderTextColor={Colors.textMuted} />

        <Text style={styles.fieldLabel}>First Name</Text>
        <TextInput style={styles.input} value={firstName} onChangeText={setFirstName} placeholder="First Name" placeholderTextColor={Colors.textMuted} />

        <Text style={styles.fieldLabel}>Username</Text>
        <TextInput style={styles.input} value={username} onChangeText={setUsername} placeholder="Username" placeholderTextColor={Colors.textMuted} autoCapitalize="none" />

        <Text style={styles.fieldLabel}>Contact No.</Text>
        <TextInput
          style={styles.input}
          value={contactNo}
          onChangeText={(t) => setContactNo(t.replace(/\D/g, "").slice(0, 11))}
          placeholder="09XXXXXXXXX"
          placeholderTextColor={Colors.textMuted}
          keyboardType="phone-pad"
          maxLength={11}
        />

        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.btnDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.saveBtnText}>Save</Text>}
        </TouchableOpacity>
      </ScrollView>

      <OwnerSidebar visible={sidebarVisible} onClose={() => setSidebarVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#EBEBEB" },
  fullCenter: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#EBEBEB" },
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
  content: { alignItems: "center", paddingHorizontal: 32, paddingTop: 28 },
  avatarWrapper: { position: "relative", marginBottom: 28 },
  avatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "#C8C8C8",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  avatarHead: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#6B6B6B", position: "absolute", top: 16 },
  avatarBody: { width: 54, height: 38, borderRadius: 27, backgroundColor: "#6B6B6B" },
  editBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
  },
  editBadgeIcon: { fontSize: 13 },
  fieldLabel: { alignSelf: "flex-start", fontSize: 13, fontWeight: "600", color: "#333333", marginBottom: 6 },
  input: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#DDDDDD",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#1A1A1A",
    marginBottom: 16,
  },
  saveBtn: {
    marginTop: 20,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 64,
    borderRadius: 30,
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.5 },
  saveBtnText: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
});
