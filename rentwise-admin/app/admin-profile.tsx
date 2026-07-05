import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  Alert,
  ScrollView,
} from "react-native";
import { router } from "expo-router";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import Sidebar from "./components/Sidebar";

export default function AdminProfile() {
  const insets = useSafeAreaInsets();

  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [contactNo, setContactNo] = useState("");

  const [focusedField, setFocusedField] = useState<string | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(20)).current;
  const originalRef = useRef({ firstName: "", lastName: "", contactNo: "" });

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      router.replace("/");
      return;
    }
    loadProfile(user.uid);
  }, []);

  useEffect(() => {
    if (!saved) return;
    fadeAnim.setValue(0);
    toastTranslateY.setValue(20);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 450, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(toastTranslateY, { toValue: 0, duration: 450, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]),
      Animated.delay(1000),
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 0, duration: 450, easing: Easing.in(Easing.back(1.5)), useNativeDriver: true }),
        Animated.timing(toastTranslateY, { toValue: -10, duration: 450, easing: Easing.in(Easing.back(1.5)), useNativeDriver: true }),
      ]),
    ]).start(() => setSaved(false));
  }, [saved]);

  const loadProfile = async (uid: string) => {
    try {
      const snap = await getDoc(doc(db, "users", uid));
      if (snap.exists()) {
        const data = snap.data();
        const fn = data.firstName ?? "";
        const ln = data.lastName ?? "";
        const cn = data.contactNo ?? "";
        setFirstName(fn);
        setLastName(ln);
        setContactNo(cn);
        originalRef.current = { firstName: fn, lastName: ln, contactNo: cn };
      }
    } catch (err) {
      console.error("ADMIN PROFILE LOAD ERROR:", err);
    } finally {
      setLoading(false);
    }
  };

  const hasChanges =
    firstName.trim() !== originalRef.current.firstName ||
    lastName.trim() !== originalRef.current.lastName ||
    contactNo.trim() !== originalRef.current.contactNo;

  const hasEmptyField =
    !firstName.trim() || !lastName.trim() || !contactNo.trim();

  const handleSave = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const fn = firstName.trim();
    const ln = lastName.trim();
    const cn = contactNo.trim();

    if (!fn || !ln || !cn) {
      Alert.alert("Missing Information", "All fields are required.");
      return;
    }

    setSaving(true);
    try {
      await updateDoc(doc(db, "users", user.uid), {
        firstName: fn,
        lastName: ln,
        contactNo: cn,
      });
      originalRef.current = { firstName: fn, lastName: ln, contactNo: cn };
      setIsEditing(false);
      setSaved(true);
    } catch (err) {
      console.error("ADMIN PROFILE SAVE ERROR:", err);
      Alert.alert("Error", "Failed to update profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator color="#0C2D6B" size="large" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* HEADER */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => setSidebarVisible(true)} activeOpacity={0.7}>
          <Ionicons name="menu" size={24} color="#E6F1FB" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>RentWise</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* SUB-HEADER */}
      <View style={styles.subHeader}>
        <Text style={styles.subHeaderText}>My account</Text>
      </View>

      {/* BODY */}
      <ScrollView
        style={styles.body}
        contentContainerStyle={[
          styles.bodyContent,
          { paddingBottom: insets.bottom + 48 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* LAST NAME */}
        <Text style={styles.fieldLabel}>Last name</Text>
        <TextInput
          style={[
            styles.input,
            focusedField === "lastName" && styles.inputFocused,
            !isEditing && styles.inputReadOnly,
          ]}
          value={lastName}
          onChangeText={setLastName}
          placeholder="Enter last name"
          placeholderTextColor="#B4B2A9"
          onFocus={() => setFocusedField("lastName")}
          onBlur={() => setFocusedField(null)}
          editable={isEditing && !saving}
        />

        {/* FIRST NAME */}
        <Text style={styles.fieldLabel}>First name</Text>
        <TextInput
          style={[
            styles.input,
            focusedField === "firstName" && styles.inputFocused,
            !isEditing && styles.inputReadOnly,
          ]}
          value={firstName}
          onChangeText={setFirstName}
          placeholder="Enter first name"
          placeholderTextColor="#B4B2A9"
          onFocus={() => setFocusedField("firstName")}
          onBlur={() => setFocusedField(null)}
          editable={isEditing && !saving}
        />

        {/* CONTACT NO. */}
        <Text style={styles.fieldLabel}>Contact no.</Text>
        <View
          style={[
            styles.phoneRow,
            focusedField === "contactNo" && styles.phoneRowFocused,
            !isEditing && styles.phoneRowReadOnly,
          ]}
        >
          <View style={styles.phonePrefix}>
            <Text style={styles.phonePrefixText}>+63</Text>
          </View>
          <TextInput
            style={[styles.phoneInput, !isEditing && styles.inputReadOnly]}
            value={contactNo}
            onChangeText={(t) => setContactNo(t.replace(/\D/g, "").slice(0, 10))}
            keyboardType="phone-pad"
            placeholder="9XXXXXXXXX"
            placeholderTextColor="#B4B2A9"
            onFocus={() => setFocusedField("contactNo")}
            onBlur={() => setFocusedField(null)}
            editable={isEditing && !saving}
          />
        </View>

        {/* EDIT / SAVE BUTTON */}
        <Pressable
          style={({ pressed }) => [
            styles.saveBtn,
            isEditing && (!hasChanges || hasEmptyField || saving) && styles.saveBtnDisabled,
            pressed && (!isEditing || (hasChanges && !hasEmptyField && !saving)) && styles.saveBtnPressed,
          ]}
          onPress={isEditing ? handleSave : () => setIsEditing(true)}
          disabled={isEditing && (!hasChanges || hasEmptyField || saving)}
        >
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.saveBtnText}>{isEditing ? "Save changes" : "Edit Profile"}</Text>
          )}
        </Pressable>
      </ScrollView>

      {/* SUCCESS TOAST */}
      {saved && (
        <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
          <Animated.View style={[styles.toast, { transform: [{ translateY: toastTranslateY }] }]}>
            <Ionicons name="checkmark-circle" size={22} color="#7AAEF0" />
            <Text style={styles.toastText}>Profile Updated</Text>
          </Animated.View>
        </Animated.View>
      )}

      <Sidebar
        visible={sidebarVisible}
        onClose={() => setSidebarVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F0F4FA",
  },

  fullCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F0F4FA",
  },

  // ── Header ────────────────────────────────────────────────────────────────────

  header: {
    backgroundColor: "#0C2D6B",
    paddingHorizontal: 20,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
  },

  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "500",
    flex: 1,
    textAlign: "center",
  },

  // ── Sub-header ────────────────────────────────────────────────────────────────

  subHeader: {
    backgroundColor: "#1A4DA0",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },

  subHeaderText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "500",
    textAlign: "center",
  },

  // ── Body ─────────────────────────────────────────────────────────────────────

  body: {
    flex: 1,
  },

  bodyContent: {
    paddingHorizontal: 20,
    paddingTop: 28,
  },

  // ── Fields ────────────────────────────────────────────────────────────────────

  fieldLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: "#1A4DA0",
    marginBottom: 6,
  },

  input: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#B5D4F4",
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 15,
    color: "#0C2D6B",
    marginBottom: 16,
  },

  inputFocused: {
    borderColor: "#2E6FD9",
  },

  inputReadOnly: {
    backgroundColor: "#EEF2FA",
    color: "#6B87B8",
  },

  // ── Phone row ─────────────────────────────────────────────────────────────────

  phoneRow: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#B5D4F4",
    backgroundColor: "#fff",
    overflow: "hidden",
    marginBottom: 16,
  },

  phoneRowFocused: {
    borderColor: "#2E6FD9",
  },

  phoneRowReadOnly: {
    backgroundColor: "#EEF2FA",
  },

  phonePrefix: {
    backgroundColor: "#E6F1FB",
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRightWidth: 1,
    borderRightColor: "#B5D4F4",
    justifyContent: "center",
  },

  phonePrefixText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#0C2D6B",
  },

  phoneInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: "#0C2D6B",
  },

  // ── Save button ───────────────────────────────────────────────────────────────

  saveBtn: {
    width: "100%",
    borderRadius: 14,
    backgroundColor: "#0C2D6B",
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    transform: [{ scale: 1 }],
  },

  saveBtnPressed: {
    backgroundColor: "#091f4a",
    transform: [{ scale: 0.97 }],
  },

  saveBtnDisabled: {
    backgroundColor: "#B5D4F4",
  },

  saveBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "500",
    textAlign: "center",
  },

  // ── Toast ─────────────────────────────────────────────────────────────────────

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
