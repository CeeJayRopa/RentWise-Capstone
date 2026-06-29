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
  Modal,
  StyleSheet,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import { Colors } from "../shared/constants/color";
import {
  createTenantAccount,
  archiveTenant,
} from "../shared/services/accountServices";

type StallInfo = {
  buildingNumber: string;
  spaceId: string;
  tenantId: string;
};

type TenantInfo = {
  uid: string;
  firstName: string;
  lastName: string;
  userName: string;
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
  const [userName, setUserName] = useState("");
  const [contactNo, setContactNo] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Field errors (create mode)
  const [firstNameError, setFirstNameError] = useState("");
  const [lastNameError, setLastNameError] = useState("");
  const [userNameError, setUserNameError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState("");

  // Shared submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");

  // Archive confirmation modal
  const [archiveModalVisible, setArchiveModalVisible] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState("");

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
              userName: (ud.userName as string) ?? "",
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
    if (!userName.trim()) {
      setUserNameError("Required.");
      valid = false;
    } else if (!/^[a-zA-Z0-9_]+$/.test(userName.trim())) {
      setUserNameError("Letters, numbers, and _ only.");
      valid = false;
    } else {
      setUserNameError("");
    }
    const pwRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]).{8,12}$/;
    if (!pwRegex.test(password)) {
      setPasswordError("8–12 characters with letters, numbers, and special characters.");
      valid = false;
    } else setPasswordError("");
    if (!confirmPassword) {
      setConfirmPasswordError("Please confirm your password.");
      valid = false;
    } else if (password !== confirmPassword) {
      setConfirmPasswordError("Passwords do not match");
      valid = false;
    } else setConfirmPasswordError("");
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
        userName: userName.trim().toLowerCase(),
        contactNo: contactNo.trim(),
        password,
        stallId,
      });
      setSubmitSuccess("Tenant account created successfully.");
      setTimeout(() => {
        if (mountedRef.current) router.back();
      }, 1200);
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string };
      if (
        e.message === "Username is already taken." ||
        e.code === "auth/email-already-in-use"
      ) {
        setSubmitError("Username is already taken.");
      } else {
        setSubmitError("Failed to create account. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async () => {
    if (!tenantInfo) return;
    setArchiving(true);
    setArchiveError("");
    try {
      await archiveTenant(tenantInfo.uid);
      setArchiveModalVisible(false);
      setSubmitSuccess("Tenant archived.");
      setTimeout(() => {
        if (mountedRef.current) router.back();
      }, 1200);
    } catch {
      setArchiveError("Failed to archive tenant. Please try again.");
    } finally {
      setArchiving(false);
    }
  };

  // ── Auth spinner ─────────────────────────────────────────────────────────

  if (checking) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Text style={styles.navIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {isCreate ? "Register Tenant" : "Manage Account"}
        </Text>
        <View style={styles.navBtn} />
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
              <ActivityIndicator color={Colors.primary} size="large" />
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
              {/* Stall context badge */}
              {stallInfo && (
                <View style={styles.contextBox}>
                  <Text style={styles.contextText}>
                    Building {stallInfo.buildingNumber} · Space ID:{" "}
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
                    <View style={[styles.usernameRow, !!userNameError && styles.inputError]}>
                      <TextInput
                        style={styles.usernameInput}
                        value={userName}
                        onChangeText={(t) => {
                          setUserName(t);
                          setUserNameError("");
                        }}
                        placeholder="username"
                        autoCapitalize="none"
                        editable={!submitting && !submitSuccess}
                        placeholderTextColor={Colors.textMuted}
                      />
                      <Text style={styles.usernameSuffix}>@rentwise.app</Text>
                    </View>
                    {userNameError ? <Text style={styles.fieldError}>{userNameError}</Text> : null}
                  </View>

                  <Field
                    label="Contact No."
                    value={contactNo}
                    onChange={(t) => setContactNo(t.replace(/\D/g, "").slice(0, 11))}
                    keyboardType="phone-pad"
                    maxLength={11}
                    disabled={submitting || !!submitSuccess}
                  />
                  <Field
                    label="Password"
                    value={password}
                    onChange={(t) => {
                      setPassword(t);
                      setPasswordError("");
                    }}
                    error={passwordError}
                    hint="8–12 characters, include letters, numbers & special characters"
                    secure
                    showToggle
                    disabled={submitting || !!submitSuccess}
                  />
                  <Field
                    label="Confirm Password"
                    value={confirmPassword}
                    onChange={(t) => {
                      setConfirmPassword(t);
                      setConfirmPasswordError("");
                    }}
                    error={confirmPasswordError}
                    secure
                    showToggle
                    disabled={submitting || !!submitSuccess}
                  />

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
                        <InfoRow label="Username" value={tenantInfo.userName} />
                        <InfoRow
                          label="Contact No."
                          value={tenantInfo.contactNo || "—"}
                          last
                        />
                      </View>

                      {submitError ? (
                        <Text style={styles.submitError}>{submitError}</Text>
                      ) : null}
                      {submitSuccess ? (
                        <View style={styles.successBox}>
                          <Text style={styles.successText}>
                            {submitSuccess}
                          </Text>
                        </View>
                      ) : null}

                      <TouchableOpacity
                        style={[
                          styles.dangerBtn,
                          submitting && styles.btnDisabled,
                        ]}
                        onPress={() => {
                          setArchiveError("");
                          setArchiveModalVisible(true);
                        }}
                        activeOpacity={0.8}
                        disabled={submitting}
                      >
                        <Text style={styles.dangerBtnText}>Archive Tenant</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <View style={styles.centeredBox}>
                      <Text style={styles.loadErrorText}>
                        No tenant found for this stall.
                      </Text>
                    </View>
                  )}
                </>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Archive confirmation modal */}
      <Modal
        visible={archiveModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!archiving) setArchiveModalVisible(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => {
              if (!archiving) setArchiveModalVisible(false);
            }}
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Archive Tenant</Text>
            <Text style={styles.modalBody}>
              This will mark the tenant as archived and free up their stall. The
              account remains in Firebase but will be inactive.
            </Text>
            {archiveError ? (
              <Text style={styles.submitError}>{archiveError}</Text>
            ) : null}
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.outlineBtn]}
                onPress={() => setArchiveModalVisible(false)}
                activeOpacity={0.7}
                disabled={archiving}
              >
                <Text style={styles.outlineBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  styles.modalDangerBtn,
                  archiving && styles.btnDisabled,
                ]}
                onPress={handleArchive}
                activeOpacity={0.8}
                disabled={archiving}
              >
                {archiving ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.dangerBtnText}>Archive</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  secure,
  showToggle,
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
  secure?: boolean;
  showToggle?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: "default" | "numeric" | "email-address" | "phone-pad";
  maxLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  const isSecure = secure && !visible;

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      {secure && showToggle ? (
        <View style={[styles.fieldInputRow, error ? styles.inputError : null]}>
          <TextInput
            style={styles.fieldInputFlex}
            value={value}
            onChangeText={onChange}
            secureTextEntry={isSecure}
            autoCapitalize={autoCapitalize ?? "none"}
            keyboardType={keyboardType ?? "default"}
            maxLength={maxLength}
            editable={!disabled}
            placeholderTextColor={Colors.textMuted}
          />
          <TouchableOpacity
            style={styles.fieldEyeBtn}
            onPress={() => setVisible((v) => !v)}
            activeOpacity={0.7}
          >
            <Text style={styles.fieldEyeIcon}>{visible ? "🙈" : "👁"}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TextInput
          style={[styles.input, error ? styles.inputError : null]}
          value={value}
          onChangeText={onChange}
          secureTextEntry={isSecure}
          autoCapitalize={autoCapitalize ?? "sentences"}
          keyboardType={keyboardType ?? "default"}
          maxLength={maxLength}
          editable={!disabled}
          placeholderTextColor={Colors.textMuted}
        />
      )}
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
  screen: { flex: 1, backgroundColor: Colors.background },
  fullCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.background,
  },

  // Header
  header: {
    backgroundColor: Colors.primary,
    paddingBottom: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navBtn: { width: 36, alignItems: "center", justifyContent: "center" },
  navIcon: { fontSize: 22, color: "#FFFFFF" },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#FFFFFF" },

  // Scroll
  scrollContent: { padding: 20 },
  centeredBox: { paddingVertical: 60, alignItems: "center" },

  // Load error
  loadErrorText: {
    fontSize: 15,
    color: Colors.error,
    textAlign: "center",
    marginBottom: 16,
  },
  backLink: { paddingVertical: 8, paddingHorizontal: 16 },
  backLinkText: { fontSize: 14, fontWeight: "600", color: Colors.primary },

  // Context badge (mirrors edit-rental-info.tsx)
  contextBox: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 22,
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  contextText: { fontSize: 14, fontWeight: "600", color: Colors.textPrimary },

  // Form fields
  field: { marginBottom: 18 },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  fieldHint: { fontSize: 11, color: Colors.textMuted, marginBottom: 5 },
  input: {
    backgroundColor: Colors.inputBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  inputError: { borderColor: Colors.error },
  fieldError: { fontSize: 12, color: Colors.error, marginTop: 4 },

  // Password show/hide row inside Field
  fieldInputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.inputBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
  },
  fieldInputFlex: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  fieldEyeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  fieldEyeIcon: {
    fontSize: 18,
  },

  // Username with @rentwise.app suffix
  usernameRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.inputBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
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

  // Tenant info card (manage mode)
  infoCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 22,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  infoRow: {
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  infoRowLast: { borderBottomWidth: 0 },
  infoLabel: { fontSize: 12, color: Colors.textMuted, marginBottom: 3 },
  infoValue: { fontSize: 15, fontWeight: "600", color: Colors.textPrimary },

  // Feedback
  submitError: {
    fontSize: 13,
    color: Colors.error,
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

  // Buttons
  primaryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    minHeight: 48,
  },
  primaryBtnText: { fontSize: 15, fontWeight: "600", color: "#FFFFFF" },

  dangerBtn: {
    backgroundColor: Colors.error,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    minHeight: 48,
  },
  dangerBtnText: { fontSize: 15, fontWeight: "600", color: "#FFFFFF" },

  btnDisabled: { backgroundColor: Colors.disabled },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginBottom: 10,
  },
  modalBody: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 21,
    marginBottom: 20,
  },
  modalBtns: { flexDirection: "row", gap: 10, alignItems: "stretch" },
  modalBtn: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  modalDangerBtn: { backgroundColor: Colors.error },
  outlineBtn: { borderWidth: 1.5, borderColor: Colors.border },
  outlineBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.textSecondary,
  },
});
