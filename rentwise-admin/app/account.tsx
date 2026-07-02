import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import { createTenantAccount, DEFAULT_TENANT_PASSWORD } from "../shared/services/accountServices";

type StallInfo = {
  buildingNumber: string;
  spaceId: string;
  tenantId: string;
};

type TenantInfo = {
  uid: string;
  firstName: string;
  lastName: string;
  username: string;
  contactNo: string;
};

export default function Account() {
  const insets = useSafeAreaInsets();
  const { stallId, mode } = useLocalSearchParams<{
    stallId: string;
    mode: string;
  }>();
  const isCreate = mode === "create";
  const mountedRef = useRef(true);

  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [stallInfo, setStallInfo] = useState<StallInfo | null>(null);
  const [tenantInfo, setTenantInfo] = useState<TenantInfo | null>(null);

  // Create mode form fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [contactNo, setContactNo] = useState("");

  // Field errors (create mode)
  const [firstNameError, setFirstNameError] = useState("");
  const [lastNameError, setLastNameError] = useState("");
  const [usernameError, setUsernameError] = useState("");

  // Shared submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace("/");
        return;
      }
      setChecking(false);
      if (stallId) {
        fetchData(stallId);
      } else {
        setLoadError("No stall selected.");
        setLoading(false);
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stallId]);

  const fetchData = useCallback(
    async (id: string) => {
      setLoading(true);
      setLoadError("");
      try {
        const stallSnap = await getDoc(doc(db, "stalls", id));
        if (!stallSnap.exists()) {
          setLoadError("Stall not found.");
          return;
        }
        const sd = stallSnap.data();
        const stall: StallInfo = {
          buildingNumber: (sd.buildingNumber as string) ?? "",
          spaceId: (sd.spaceId as string) ?? "",
          tenantId: (sd.tenantId as string) ?? "",
        };
        setStallInfo(stall);

        if (!isCreate && stall.tenantId) {
          const userSnap = await getDoc(doc(db, "users", stall.tenantId));
          if (userSnap.exists()) {
            const ud = userSnap.data();
            setTenantInfo({
              uid: userSnap.id,
              firstName: (ud.firstName as string) ?? "",
              lastName: (ud.lastName as string) ?? "",
              username: (ud.username as string) ?? "",
              contactNo: (ud.contactNo as string) ?? "",
            });
          }
        }
      } catch (err) {
        console.error("ACCOUNT FETCH ERROR:", err);
        setLoadError("Failed to load data. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [isCreate],
  );

  const validateCreate = (): boolean => {
    let valid = true;
    if (!firstName.trim()) {
      setFirstNameError("Required.");
      valid = false;
    } else setFirstNameError("");
    if (!lastName.trim()) {
      setLastNameError("Required.");
      valid = false;
    } else setLastNameError("");
    if (!username.trim()) {
      setUsernameError("Required.");
      valid = false;
    } else if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) {
      setUsernameError("Letters, numbers, and _ only.");
      valid = false;
    } else {
      setUsernameError("");
    }
    return valid;
  };

  const handleCreate = async () => {
    if (!validateCreate() || !stallId) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      await createTenantAccount({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        username: username.trim().toLowerCase(),
        contactNo: contactNo.trim(),
        stallId,
      });
      setSubmitSuccess("Tenant account created successfully.");
      setTimeout(() => {
        if (mountedRef.current) router.replace("/building");
      }, 1200);
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string };
      if (
        e.message === "Username is already taken." ||
        e.code === "auth/email-already-in-use"
      ) {
        setSubmitError("Username is already taken.");
      } else if (
        e.message?.includes("registered by another admin") ||
        e.message === "Stall not found."
      ) {
        setSubmitError(e.message);
      } else {
        setSubmitError("Failed to create account. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
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
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color="#E6F1FB" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {isCreate ? "Register Tenant" : "Manage Account"}
        </Text>
        <View style={{ width: 22 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 32 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {loading ? (
            <View style={styles.centeredBox}>
              <ActivityIndicator color="#0C2D6B" size="large" />
            </View>
          ) : loadError ? (
            <View style={styles.centeredBox}>
              <Text style={styles.loadErrorText}>{loadError}</Text>
              <TouchableOpacity
                style={styles.backLink}
                onPress={() => router.back()}
                activeOpacity={0.7}
              >
                <Text style={styles.backLinkText}>← Go Back</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {/* STALL ID PILL */}
              {stallInfo && (
                <View style={styles.stallPill}>
                  <Ionicons
                    name="storefront-outline"
                    size={16}
                    color="#0C2D6B"
                    style={{ marginRight: 10 }}
                  />
                  <Text style={styles.stallPillText}>
                    Building {stallInfo.buildingNumber} {"·"} Space ID:{" "}
                    {stallInfo.spaceId}
                  </Text>
                </View>
              )}

              {isCreate ? (
                /* ── Create Mode ─────────────────────────────────────── */
                <>
                  <Field
                    label="First Name"
                    value={firstName}
                    onChange={(t) => {
                      setFirstName(t);
                      setFirstNameError("");
                    }}
                    error={firstNameError}
                    disabled={submitting || !!submitSuccess}
                  />
                  <Field
                    label="Last Name"
                    value={lastName}
                    onChange={(t) => {
                      setLastName(t);
                      setLastNameError("");
                    }}
                    error={lastNameError}
                    disabled={submitting || !!submitSuccess}
                  />
                  {/* Username with @rentwise.app suffix */}
                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>Username</Text>
                    <Text style={styles.fieldHint}>Used for tenant login</Text>
                    <View style={[styles.usernameRow, !!usernameError && styles.inputError]}>
                      <TextInput
                        style={styles.usernameInput}
                        value={username}
                        onChangeText={(t) => {
                          setUsername(t);
                          setUsernameError("");
                        }}
                        placeholder="username"
                        autoCapitalize="none"
                        editable={!submitting && !submitSuccess}
                        placeholderTextColor="#B4B2A9"
                      />
                      <Text style={styles.usernameSuffix}>@rentwise.app</Text>
                    </View>
                    {usernameError ? <Text style={styles.fieldError}>{usernameError}</Text> : null}
                  </View>

                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>Contact No.</Text>
                    <View style={styles.phoneRow}>
                      <View style={styles.phonePrefix}>
                        <Text style={styles.phonePrefixText}>+63</Text>
                      </View>
                      <TextInput
                        style={styles.phoneInput}
                        value={contactNo}
                        onChangeText={(t) => setContactNo(t.replace(/\D/g, "").slice(0, 10))}
                        placeholder="9XXXXXXXXX"
                        placeholderTextColor="#B4B2A9"
                        keyboardType="phone-pad"
                        maxLength={10}
                        editable={!submitting && !submitSuccess}
                      />
                    </View>
                  </View>

                  <View style={styles.defaultPasswordNote}>
                    <Ionicons
                      name="information-circle-outline"
                      size={16}
                      color="#0C2D6B"
                      style={{ marginRight: 8 }}
                    />
                    <Text style={styles.defaultPasswordNoteText}>
                      The tenant's login password will be set to{" "}
                      <Text style={styles.defaultPasswordNoteBold}>{DEFAULT_TENANT_PASSWORD}</Text>.
                      Share the username and this password with the tenant.
                    </Text>
                  </View>

                  {submitError ? (
                    <Text style={styles.submitError}>{submitError}</Text>
                  ) : null}
                  {submitSuccess ? (
                    <View style={styles.successBox}>
                      <Text style={styles.successText}>{submitSuccess}</Text>
                    </View>
                  ) : null}

                  <TouchableOpacity
                    style={[
                      styles.primaryBtn,
                      (submitting || !!submitSuccess) && styles.btnDisabled,
                    ]}
                    onPress={handleCreate}
                    activeOpacity={0.8}
                    disabled={submitting || !!submitSuccess}
                  >
                    {submitting ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Text style={styles.primaryBtnText}>Create Account</Text>
                    )}
                  </TouchableOpacity>
                </>
              ) : (
                /* ── Manage Mode ─────────────────────────────────────── */
                <>
                  {tenantInfo ? (
                    <>
                      <View style={styles.infoCard}>
                        <InfoRow
                          label="Name"
                          value={`${tenantInfo.firstName} ${tenantInfo.lastName}`}
                        />
                        <InfoRow label="Username" value={tenantInfo.username} />
                        <InfoRow
                          label="Contact no."
                          value={tenantInfo.contactNo ? `+63 ${tenantInfo.contactNo}` : "—"}
                          last
                        />
                      </View>

                      {submitError ? (
                        <Text style={styles.submitError}>{submitError}</Text>
                      ) : null}
                      {submitSuccess ? (
                        <View style={styles.successBox}>
                          <Text style={styles.successText}>{submitSuccess}</Text>
                        </View>
                      ) : null}
                    </>
                  ) : (
                    <View style={styles.emptyState}>
                      <Ionicons
                        name="person-outline"
                        size={40}
                        color="#B5D4F4"
                        style={{ marginBottom: 10 }}
                      />
                      <Text style={styles.emptyText}>
                        Tenant information not found.
                      </Text>
                    </View>
                  )}
                </>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Field({
  label,
  value,
  onChange,
  error,
  hint,
  disabled,
  autoCapitalize,
  keyboardType,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (t: string) => void;
  error?: string;
  hint?: string;
  disabled?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: "default" | "numeric" | "email-address" | "phone-pad";
  maxLength?: number;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      <TextInput
        style={[styles.input, error ? styles.inputError : null]}
        value={value}
        onChangeText={onChange}
        autoCapitalize={autoCapitalize ?? "sentences"}
        keyboardType={keyboardType ?? "default"}
        maxLength={maxLength}
        editable={!disabled}
        placeholderTextColor="#B4B2A9"
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

function InfoRow({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.infoRow, last && styles.infoRowLast]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F0F4FA",
  },

  fullCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
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

  // ── Body ─────────────────────────────────────────────────────────────────────

  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },

  centeredBox: {
    paddingVertical: 60,
    alignItems: "center",
  },

  loadErrorText: {
    fontSize: 15,
    color: "#A32D2D",
    textAlign: "center",
    marginBottom: 16,
  },

  backLink: { paddingVertical: 8, paddingHorizontal: 16 },
  backLinkText: { fontSize: 14, fontWeight: "600", color: "#0C2D6B" },

  // ── Stall ID pill ─────────────────────────────────────────────────────────────

  stallPill: {
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderWidth: 0.5,
    borderColor: "#B5D4F4",
    borderLeftWidth: 4,
    borderLeftColor: "#0C2D6B",
    marginBottom: 20,
    flexDirection: "row",
    alignItems: "center",
  },

  stallPillText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#0C2D6B",
  },

  // ── Tenant info card (manage mode) ────────────────────────────────────────────

  infoCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: "#B5D4F4",
    overflow: "hidden",
    marginBottom: 22,
  },

  infoRow: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: "#E6F1FB",
  },

  infoRowLast: {
    borderBottomWidth: 0,
  },

  infoLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: "#B5D4F4",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 4,
  },

  infoValue: {
    fontSize: 16,
    fontWeight: "500",
    color: "#0C2D6B",
  },

  // ── Empty state (manage mode) ─────────────────────────────────────────────────

  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
  },

  emptyText: {
    fontSize: 15,
    color: "#888780",
    textAlign: "center",
  },

  // ── Create mode — form fields ─────────────────────────────────────────────────

  field: { marginBottom: 18 },

  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#444441",
    marginBottom: 4,
  },

  fieldHint: { fontSize: 11, color: "#888780", marginBottom: 5 },

  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#B5D4F4",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#0C2D6B",
  },

  inputError: { borderColor: "#A32D2D" },
  fieldError: { fontSize: 12, color: "#A32D2D", marginTop: 4 },

  usernameRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#B5D4F4",
    borderRadius: 10,
  },
  usernameInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#0C2D6B",
  },
  usernameSuffix: {
    fontSize: 13,
    color: "#888780",
    paddingRight: 12,
    fontWeight: "500",
  },

  phoneRow: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#B5D4F4",
    backgroundColor: "#fff",
    overflow: "hidden",
  },
  phonePrefix: {
    backgroundColor: "#E6F1FB",
    paddingHorizontal: 14,
    paddingVertical: 12,
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
    paddingVertical: 12,
    fontSize: 15,
    color: "#0C2D6B",
  },

  defaultPasswordNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#E6F1FB",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 18,
  },
  defaultPasswordNoteText: {
    flex: 1,
    fontSize: 13,
    color: "#0C2D6B",
    lineHeight: 19,
  },
  defaultPasswordNoteBold: {
    fontWeight: "700",
  },

  // ── Feedback ──────────────────────────────────────────────────────────────────

  submitError: {
    fontSize: 13,
    color: "#A32D2D",
    textAlign: "center",
    marginBottom: 12,
  },

  successBox: {
    backgroundColor: "#EBF5EB",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
    alignItems: "center",
  },
  successText: { fontSize: 14, fontWeight: "600", color: "#2D6A4F" },

  // ── Buttons ───────────────────────────────────────────────────────────────────

  primaryBtn: {
    backgroundColor: "#0C2D6B",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    minHeight: 48,
  },
  primaryBtnText: { fontSize: 15, fontWeight: "600", color: "#fff" },

  dangerBtn: {
    backgroundColor: "#A32D2D",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    minHeight: 48,
  },
  dangerBtnText: { fontSize: 15, fontWeight: "600", color: "#fff" },

  btnDisabled: { backgroundColor: "#B5D4F4" },

  // ── Modal (unused in this screen but kept for compatibility) ──────────────────

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: "#B5D4F4",
    width: "100%",
    overflow: "hidden",
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#0C2D6B", marginBottom: 10 },
  modalBody: { fontSize: 14, color: "#444441", lineHeight: 21, marginBottom: 20 },
  modalBtns: { flexDirection: "row", gap: 10, alignItems: "stretch" },
  modalBtn: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  outlineBtn: { borderWidth: 1.5, borderColor: "#B5D4F4" },
  outlineBtnText: { fontSize: 14, fontWeight: "600", color: "#0C2D6B" },
});
