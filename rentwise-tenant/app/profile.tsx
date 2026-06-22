import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import { auth } from "../shared/firebaseConfig";
import { getTenantData, updateTenantProfile } from "../services/tenantService";
import { router } from "expo-router";

export default function Profile() {
  const insets = useSafeAreaInsets();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [contact, setContact] = useState("");
  const [stallId, setStallId] = useState("");

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
      }
    } catch (error) {
      console.log("Profile Load Error:", error);
    }
  }

  async function saveProfile() {
    try {
      const user = auth.currentUser;
      if (!user) return;
      await updateTenantProfile(user.uid, { firstName, lastName, contactNo: contact });
      Alert.alert("Success", "Profile updated");
      router.back();
    } catch (error) {
      console.log("Save Error:", error);
      Alert.alert("Error", "Cannot update profile");
    }
  }

  return (
    <View style={styles.root}>
      {/* Top Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Text style={styles.headerTitle}>RentWise</Text>
      </View>

      {/* Sub-header with back arrow */}
      <View style={styles.subHeader}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backArrow}>◄</Text>
        </TouchableOpacity>
        <Text style={styles.subHeaderTitle}>Manage Profile</Text>
        <View style={styles.backBtn} />
      </View>

      {/* Body */}
      <View style={[styles.body, { paddingBottom: insets.bottom }]}>
        {/* Avatar */}
        <View style={styles.avatarWrapper}>
          <View style={styles.avatarCircle}>
            <View style={styles.avatarHead} />
            <View style={styles.avatarBody} />
          </View>
          <View style={styles.editBadge}>
            <Text style={styles.editIcon}>✎</Text>
          </View>
        </View>

        <Text style={styles.spaceId}>Space ID: {stallId || "—"}</Text>

        {/* Form */}
        <Text style={styles.label}>Last Name</Text>
        <TextInput
          style={styles.input}
          value={lastName}
          onChangeText={setLastName}
          placeholder="Last Name"
        />

        <Text style={styles.label}>First Name</Text>
        <TextInput
          style={styles.input}
          value={firstName}
          onChangeText={setFirstName}
          placeholder="First Name"
        />

        <Text style={styles.label}>Contact No.</Text>
        <View style={styles.phoneRow}>
          <View style={styles.phonePrefix}>
            <Text style={styles.phonePrefixText}>+63</Text>
          </View>
          <View style={styles.phoneDivider} />
          <TextInput
            style={styles.phoneInput}
            value={contact}
            onChangeText={setContact}
            placeholder="9XXXXXXXXX"
            keyboardType="phone-pad"
          />
        </View>

        <TouchableOpacity style={styles.saveButton} onPress={saveProfile}>
          <Text style={styles.saveText}>Save</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#1A1A1A",
  },

  header: {
    backgroundColor: "#1A1A1A",
    paddingVertical: 16,
    alignItems: "center",
  },

  headerTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "bold",
  },

  subHeader: {
    backgroundColor: "#B5A89A",
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },

  backBtn: {
    width: 40,
  },

  backArrow: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "bold",
  },

  subHeaderTitle: {
    flex: 1,
    textAlign: "center",
    color: "#1A1A1A",
    fontSize: 17,
    fontWeight: "bold",
  },

  body: {
    flex: 1,
    backgroundColor: "#E8E8E8",
    alignItems: "center",
    padding: 24,
  },

  avatarWrapper: {
    marginTop: 20,
    marginBottom: 12,
  },

  avatarCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "#C8C8C8",
    alignItems: "center",
    justifyContent: "flex-end",
    overflow: "hidden",
  },

  avatarHead: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#6B6B6B",
    position: "absolute",
    top: 16,
  },

  avatarBody: {
    width: 60,
    height: 40,
    borderRadius: 30,
    backgroundColor: "#6B6B6B",
    marginBottom: -6,
  },

  editBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#CCCCCC",
  },

  editIcon: {
    fontSize: 13,
    color: "#555555",
  },

  spaceId: {
    fontSize: 14,
    color: "#333333",
    marginBottom: 24,
  },

  label: {
    alignSelf: "flex-start",
    fontSize: 14,
    color: "#1A1A1A",
    marginBottom: 6,
    fontWeight: "500",
  },

  input: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CCCCCC",
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: "#1A1A1A",
    marginBottom: 16,
  },

  phoneRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CCCCCC",
    borderRadius: 8,
    marginBottom: 16,
    overflow: "hidden",
  },

  phonePrefix: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },

  phonePrefixText: {
    fontSize: 15,
    color: "#1A1A1A",
    fontWeight: "500",
  },

  phoneDivider: {
    width: 1,
    height: "60%",
    backgroundColor: "#CCCCCC",
  },

  phoneInput: {
    flex: 1,
    padding: 12,
    fontSize: 15,
    color: "#1A1A1A",
  },

  saveButton: {
    backgroundColor: "#7CB87A",
    borderRadius: 30,
    paddingVertical: 13,
    paddingHorizontal: 60,
    alignItems: "center",
    marginTop: 16,
  },

  saveText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
});
