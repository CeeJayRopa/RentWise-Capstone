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
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            placeholder="Username"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
          />

          <Text style={styles.fieldLabel}>Contact Number</Text>
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
            {saving ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.saveBtnText}>Save Changes</Text>
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
  saveBtn: {
    marginTop: 8,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.5 },
  saveBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
});
