import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  Alert,
  ScrollView,
  Animated,
  Easing,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useRef, useState } from "react";
import { auth } from "../shared/firebaseConfig";
import { getTenantData, updateTenantProfile } from "../services/tenantService";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

export default function Profile() {
  const insets = useSafeAreaInsets();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [contact, setContact] = useState("");
  const [stallId, setStallId] = useState("");
  const [lastNameFocused, setLastNameFocused] = useState(false);
  const [firstNameFocused, setFirstNameFocused] = useState(false);
  const [contactFocused, setContactFocused] = useState(false);
  const [original, setOriginal] = useState({ firstName: "", lastName: "", contact: "" });
  const [showToast, setShowToast] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    try {
      const user = auth.currentUser;
      if (!user) return;
      const data = await getTenantData(user.uid);
      if (data) {
        setFirstName(data.firstName || "");
        setLastName(data.lastName || "");
        setContact(data.contactNo || "");
        setStallId(data.stallId || "");
        setOriginal({
          firstName: data.firstName || "",
          lastName: data.lastName || "",
          contact: data.contactNo || "",
        });
      }
    } catch (error) {
      console.log("Profile Load Error:", error);
    }
  }

  function triggerToast() {
    toastOpacity.setValue(0);
    toastTranslateY.setValue(20);
    setShowToast(true);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(toastOpacity, {
          toValue: 1,
          duration: 300,
          easing: Easing.out(Easing.back(1.5)),
          useNativeDriver: true,
        }),
        Animated.timing(toastTranslateY, {
          toValue: 0,
          duration: 300,
          easing: Easing.out(Easing.back(1.5)),
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(1800),
      Animated.parallel([
        Animated.timing(toastOpacity, {
          toValue: 0,
          duration: 250,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(toastTranslateY, {
          toValue: -10,
          duration: 250,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ]).start(() => setShowToast(false));
  }

  async function saveProfile() {
    try {
      const user = auth.currentUser;
      if (!user) return;
      await updateTenantProfile(user.uid, { firstName, lastName, contactNo: contact });
      setOriginal({ firstName, lastName, contact });
      triggerToast();
    } catch (error) {
      console.log("Save Error:", error);
      Alert.alert("Error", "Cannot update profile");
    }
  }

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#E1F5EE" />
        </Pressable>
        <Text style={styles.headerTitle}>RentWise</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* Sub-header */}
      <View style={styles.subHeader}>
        <Text style={styles.subHeaderTitle}>Manage profile</Text>
      </View>

      {/* Body */}
      <ScrollView
        style={styles.body}
        contentContainerStyle={[styles.bodyContent, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Space ID chip */}
        <View style={styles.spaceIdChip}>
          <Ionicons name="storefront-outline" size={14} color="#0F6E56" style={{ marginRight: 6 }} />
          <Text style={styles.spaceIdText}>Space ID: {stallId || "—"}</Text>
        </View>

        {/* Last name */}
        <Text style={styles.label}>Last name</Text>
        <TextInput
          style={[styles.input, lastNameFocused && styles.inputFocused]}
          value={lastName}
          onChangeText={setLastName}
          placeholder="Enter last name"
          placeholderTextColor="#B4B2A9"
          onFocus={() => setLastNameFocused(true)}
          onBlur={() => setLastNameFocused(false)}
        />

        {/* First name */}
        <Text style={styles.label}>First name</Text>
        <TextInput
          style={[styles.input, firstNameFocused && styles.inputFocused]}
          value={firstName}
          onChangeText={setFirstName}
          placeholder="Enter first name"
          placeholderTextColor="#B4B2A9"
          onFocus={() => setFirstNameFocused(true)}
          onBlur={() => setFirstNameFocused(false)}
        />

        {/* Contact no. */}
        <Text style={styles.label}>Contact no.</Text>
        <View style={[styles.phoneRow, contactFocused && styles.phoneRowFocused]}>
          <View style={styles.phonePrefix}>
            <Text style={styles.phonePrefixText}>+63</Text>
          </View>
          <TextInput
            style={styles.phoneInput}
            value={contact}
            onChangeText={(val) => setContact(val.replace(/[^0-9]/g, ""))}
            placeholder="9XXXXXXXXX"
            placeholderTextColor="#B4B2A9"
            keyboardType="phone-pad"
            maxLength={11}
            onFocus={() => setContactFocused(true)}
            onBlur={() => setContactFocused(false)}
          />
        </View>

        {/* Save button */}
        <Pressable
          style={({ pressed }) => [
            styles.saveButton,
            !(firstName !== original.firstName || lastName !== original.lastName || contact !== original.contact) && styles.saveButtonDisabled,
            pressed && (firstName !== original.firstName || lastName !== original.lastName || contact !== original.contact) && { backgroundColor: "#085041", transform: [{ scale: 0.97 }] },
          ]}
          onPress={saveProfile}
          disabled={!(firstName !== original.firstName || lastName !== original.lastName || contact !== original.contact)}
        >
          <Text style={styles.saveText}>Save changes</Text>
        </Pressable>

      </ScrollView>

      {showToast && (
        <Animated.View
          style={[
            styles.toast,
            { opacity: toastOpacity, transform: [{ translateY: toastTranslateY }] },
          ]}
        >
          <Ionicons name="checkmark-circle" size={22} color="#9FE1CB" />
          <Text style={styles.toastText}>Profile updated.</Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0F6E56",
  },

  // ── Header ──────────────────────────────────────
  header: {
    backgroundColor: "#0F6E56",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 14,
  },

  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: "#fff",
    fontSize: 18,
    fontWeight: "500",
  },

  // ── Sub-header ───────────────────────────────────
  subHeader: {
    backgroundColor: "#1D9E75",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 10,
  },

  subHeaderTitle: {
    flex: 1,
    textAlign: "center",
    color: "#fff",
    fontSize: 16,
    fontWeight: "500",
  },

  // ── Body ────────────────────────────────────────
  body: {
    flex: 1,
    backgroundColor: "#F1EFE8",
  },

  bodyContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },

  // ── Space ID chip ────────────────────────────────
  spaceIdChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#E1F5EE",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginBottom: 24,
  },

  spaceIdText: {
    fontSize: 13,
    color: "#0F6E56",
    fontWeight: "500",
  },

  // ── Form fields ──────────────────────────────────
  label: {
    fontSize: 13,
    fontWeight: "500",
    color: "#0F6E56",
    marginBottom: 6,
  },

  input: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#9FE1CB",
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 15,
    color: "#085041",
    marginBottom: 16,
  },

  inputFocused: {
    borderColor: "#1D9E75",
  },

  // ── Phone row ────────────────────────────────────
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#9FE1CB",
    marginBottom: 16,
    overflow: "hidden",
  },

  phoneRowFocused: {
    borderColor: "#1D9E75",
  },

  phonePrefix: {
    backgroundColor: "#E1F5EE",
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRightWidth: 1,
    borderRightColor: "#9FE1CB",
  },

  phonePrefixText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#0F6E56",
  },

  phoneInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: "#085041",
  },

  // ── Success banner ───────────────────────────────
  successBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
    backgroundColor: "#E1F5EE",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },

  successText: {
    fontSize: 14,
    color: "#0F6E56",
    fontWeight: "500",
  },

  // ── Toast ────────────────────────────────────────
  toast: {
    position: "absolute",
    bottom: 380,
    alignSelf: "center",
    backgroundColor: "#0F6E56",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },

  toastText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "500",
  },

  saveButtonDisabled: {
    opacity: 0.45,
  },

  // ── Save button ──────────────────────────────────
  saveButton: {
    width: "100%",
    borderRadius: 14,
    backgroundColor: "#0F6E56",
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 8,
  },

  saveText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "500",
    textAlign: "center",
  },
});
