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
import { House, Info, User, ArrowLeftRight, ArrowLeft, HelpCircle } from "lucide-react-native";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import { createTenantAccount, DEFAULT_TENANT_PASSWORD } from "../shared/services/accountServices";
import HelpTour, { HelpStep } from "./components/HelpTour";
import { hasSeenPageTour, markPageTourSeen } from "../shared/services/onboardingTour";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../shared/theme";
import { ScreenHeader, Card, Button, TextField, EmptyState } from "../shared/components/ui";

type StallInfo = {
  buildingNumber: string;
  spaceId: string;
  tenantId: string;
};

type TenantInfo = {
  uid: string;
  firstName: string;
  lastName: string;
  email: string;
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
  const [contactNo, setContactNo] = useState("");
  const [personalEmail, setPersonalEmail] = useState("");

  // Field errors (create mode)
  const [firstNameError, setFirstNameError] = useState("");
  const [lastNameError, setLastNameError] = useState("");
  const [personalEmailError, setPersonalEmailError] = useState("");

  // Shared submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");
  const [tourVisible, setTourVisible] = useState(false);

  const helpRef = useRef<View>(null);
  const stallPillRef = useRef<View>(null);
  const detailsRef = useRef<View>(null);
  const passwordNoteRef = useRef<View>(null);
  const createBtnRef = useRef<View>(null);
  const infoCardRef = useRef<View>(null);
  const moveBtnRef = useRef<View>(null);

  const tourSteps: HelpStep[] = isCreate
    ? [
        { key: "help", ref: helpRef, title: "Help", description: "Come back here anytime for a guided tour of this page.", edgeInset: "top", round: true },
        { key: "stall", ref: stallPillRef, title: "Stall", description: "The stall this tenant will be registered to.", edgeInset: "top" },
        { key: "details", ref: detailsRef, title: "Tenant details", description: "Enter the new tenant's name, contact number, and personal email — used to log in and reset their own password.", edgeInset: "top" },
        { key: "password", ref: passwordNoteRef, title: "Default password", description: "The tenant signs in with this password the first time, then sets their own.", edgeInset: "top" },
        { key: "create", ref: createBtnRef, title: "Create Account", description: "Creates the tenant's account and assigns them to this stall.", edgeInset: "top" },
      ]
    : [
        { key: "help", ref: helpRef, title: "Help", description: "Come back here anytime for a guided tour of this page.", edgeInset: "top", round: true },
        { key: "stall", ref: stallPillRef, title: "Stall", description: "The stall this tenant currently occupies.", edgeInset: "top" },
        { key: "info", ref: infoCardRef, title: "Tenant info", description: "The current tenant's name, email, and contact number.", edgeInset: "top" },
        { key: "move", ref: moveBtnRef, title: "Move Location", description: "Relocate this active tenant to a different stall, without archiving them first.", edgeInset: "top" },
      ];

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

  // Auto-opens the guided tour the first time the admin ever lands on this
  // page — never again after that, since it flips a persisted per-device
  // flag. Can still be replayed anytime via the Help button. Create and
  // manage modes show almost entirely different content, so each gets its
  // own independent "have they seen it" flag.
  useEffect(() => {
    if (checking) return;
    (async () => {
      const pageKey = isCreate ? "account-create" : "account-manage";
      const seen = await hasSeenPageTour(pageKey);
      if (!seen) {
        setTourVisible(true);
        await markPageTourSeen(pageKey);
      }
    })();
  }, [checking, isCreate]);

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
              email: (ud.personalEmail as string) ?? (ud.email as string) ?? "",
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
    if (!personalEmail.trim()) {
      setPersonalEmailError("Email is required.");
      valid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail.trim())) {
      setPersonalEmailError("Enter a valid email address.");
      valid = false;
    } else {
      setPersonalEmailError("");
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
        contactNo: contactNo.trim(),
        stallId,
        personalEmail: personalEmail.trim(),
      });
      setSubmitSuccess("Tenant account created successfully.");
      setTimeout(() => {
        if (mountedRef.current) router.replace("/building");
      }, 1200);
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string };
      if (e.code === "auth/email-already-in-use") {
        setSubmitError("This email is already in use by another account.");
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
        <ActivityIndicator color={colors.emerald} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={isCreate ? "Register Tenant" : "Manage Account"}
        onBack={() => router.back()}
        rightAction={
          <View ref={helpRef} collapsable={false}>
            <TouchableOpacity style={styles.headerIconBtn} onPress={() => setTourVisible(true)} activeOpacity={0.7} hitSlop={8}>
              <HelpCircle size={22} color={colors.white} />
            </TouchableOpacity>
          </View>
        }
      />

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
              <ActivityIndicator color={colors.emerald} size="large" />
            </View>
          ) : loadError ? (
            <View style={styles.centeredBox}>
              <Text style={styles.loadErrorText}>{loadError}</Text>
              <TouchableOpacity
                style={styles.backLink}
                onPress={() => router.back()}
                activeOpacity={0.7}
              >
                <ArrowLeft size={15} color={colors.emerald} style={{ marginRight: spacing.xs }} />
                <Text style={styles.backLinkText}>Go Back</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {/* STALL ID PILL */}
              {stallInfo && (
                <View style={styles.stallPill} ref={stallPillRef} collapsable={false}>
                  <House size={16} color={colors.emerald} style={{ marginRight: spacing.sm }} />
                  <Text style={styles.stallPillText}>
                    Building {stallInfo.buildingNumber} {"·"} Space ID:{" "}
                    {stallInfo.spaceId}
                  </Text>
                </View>
              )}

              {isCreate ? (
                /* ── Create Mode ─────────────────────────────────────── */
                <>
                  <View ref={detailsRef} collapsable={false}>
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
                        placeholderTextColor={colors.textMuted}
                        keyboardType="phone-pad"
                        maxLength={10}
                        editable={!submitting && !submitSuccess}
                      />
                    </View>
                  </View>

                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>Email</Text>
                    <Text style={styles.fieldHint}>
                      Used to log in, and to set up and reset their own password.
                    </Text>
                    <TextField
                      value={personalEmail}
                      onChangeText={(t) => {
                        setPersonalEmail(t);
                        setPersonalEmailError("");
                      }}
                      placeholder="example@gmail.com"
                      autoCapitalize="none"
                      keyboardType="email-address"
                      editable={!submitting && !submitSuccess}
                      error={personalEmailError}
                    />
                  </View>
                  </View>

                  <View style={styles.defaultPasswordNote} ref={passwordNoteRef} collapsable={false}>
                    <Info size={16} color={colors.emerald} style={{ marginRight: spacing.sm }} />
                    <Text style={styles.defaultPasswordNoteText}>
                      The tenant's login password starts as{" "}
                      <Text style={styles.defaultPasswordNoteBold}>{DEFAULT_TENANT_PASSWORD}</Text>
                      {" "}— they'll be required to set their own the first time they log in.
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

                  <View ref={createBtnRef} collapsable={false}>
                    <Button
                      label="Create Account"
                      onPress={handleCreate}
                      loading={submitting}
                      disabled={submitting || !!submitSuccess}
                      style={styles.createBtn}
                    />
                  </View>
                </>
              ) : (
                /* ── Manage Mode ─────────────────────────────────────── */
                <>
                  {tenantInfo ? (
                    <>
                      <View ref={infoCardRef} collapsable={false}>
                      <Card noPadding style={styles.infoCard}>
                        <InfoRow
                          label="Name"
                          value={`${tenantInfo.firstName} ${tenantInfo.lastName}`}
                        />
                        <InfoRow label="Email" value={tenantInfo.email} />
                        <InfoRow
                          label="Contact no."
                          value={tenantInfo.contactNo ? `+63 ${tenantInfo.contactNo}` : "—"}
                        />
                      </Card>
                      </View>

                      {/* MOVE LOCATION — relocate this active tenant to a different
                          stall directly, instead of archiving them first. */}
                      <TouchableOpacity
                        ref={moveBtnRef}
                        style={styles.outlineActionBtn}
                        onPress={() =>
                          router.push({
                            pathname: "/tenant-relocation",
                            params: {
                              mode: "move",
                              uid: tenantInfo.uid,
                              firstName: tenantInfo.firstName,
                              lastName: tenantInfo.lastName,
                              email: tenantInfo.email,
                              buildingNumber: stallInfo?.buildingNumber ?? "",
                              spaceId: stallInfo?.spaceId ?? "",
                              stallId: stallId ?? "",
                            },
                          } as any)
                        }
                        activeOpacity={0.8}
                      >
                        <ArrowLeftRight size={16} color={colors.emerald} style={{ marginRight: spacing.sm }} />
                        <Text style={styles.outlineActionBtnText}>Move Location</Text>
                      </TouchableOpacity>

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
                    <EmptyState
                      icon={<User size={28} color={colors.textMuted} />}
                      title="Tenant information not found."
                    />
                  )}
                </>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <HelpTour visible={tourVisible} steps={tourSteps} onClose={() => setTourVisible(false)} />
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
      <TextField
        value={value}
        onChangeText={onChange}
        autoCapitalize={autoCapitalize ?? "sentences"}
        keyboardType={keyboardType ?? "default"}
        maxLength={maxLength}
        editable={!disabled}
        error={error}
      />
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.parchment,
  },

  fullCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.parchment,
  },

  headerIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Body ─────────────────────────────────────────────────────────────────────

  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },

  centeredBox: {
    paddingVertical: 60,
    alignItems: "center",
  },

  loadErrorText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.medium,
    color: colors.error,
    textAlign: "center",
    marginBottom: spacing.lg,
  },

  backLink: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  backLinkText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },

  // ── Stall ID pill ─────────────────────────────────────────────────────────────

  stallPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.mist,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xl,
  },

  stallPillText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.medium,
    color: colors.ink,
    flexShrink: 1,
  },

  // ── Tenant info card (manage mode) ────────────────────────────────────────────

  infoCard: {
    marginBottom: spacing.lg,
  },

  infoRow: {
    paddingHorizontal: spacing.xl - 2,
    paddingVertical: spacing.md + 2,
  },

  infoLabel: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: spacing.xs,
  },

  infoValue: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  // ── Create mode — form fields ─────────────────────────────────────────────────

  field: { marginBottom: spacing.xl },

  fieldLabel: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },

  fieldHint: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.regular,
    color: colors.textMuted,
    marginBottom: spacing.xs + 1,
  },

  noEmailRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.md - 2,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },
  checkboxChecked: {
    backgroundColor: colors.emerald,
    borderColor: colors.emerald,
  },
  noEmailText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
  },

  usernameRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  usernameInput: {
    flex: 1,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
    fontSize: fontSize.base,
    fontFamily: fontFamily.regular,
    color: colors.ink,
  },
  usernameSuffix: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
    paddingRight: spacing.md,
  },

  phoneRow: {
    flexDirection: "row",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.mist,
    overflow: "hidden",
  },
  phonePrefix: {
    backgroundColor: colors.emeraldSoft,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    justifyContent: "center",
  },
  phonePrefixText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.medium,
    color: colors.emerald,
  },
  phoneInput: {
    flex: 1,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
    fontSize: fontSize.base,
    fontFamily: fontFamily.regular,
    color: colors.ink,
  },

  defaultPasswordNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: colors.emeraldSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
    marginBottom: spacing.xl,
  },
  defaultPasswordNoteText: {
    flex: 1,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    color: colors.ink,
    lineHeight: 19,
  },
  defaultPasswordNoteBold: {
    fontFamily: fontFamily.bold,
  },

  // ── Feedback ──────────────────────────────────────────────────────────────────

  submitError: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    color: colors.error,
    textAlign: "center",
    marginBottom: spacing.md,
  },

  successBox: {
    backgroundColor: colors.successSoft,
    borderRadius: radius.sm - 2,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md + 2,
    marginBottom: spacing.md,
    alignItems: "center",
  },
  successText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    color: colors.success,
  },

  // ── Buttons ───────────────────────────────────────────────────────────────────

  createBtn: {
    marginBottom: spacing.md,
  },

  outlineActionBtn: {
    flexDirection: "row",
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.emerald,
    paddingVertical: spacing.md + 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
    minHeight: 48,
  },
  outlineActionBtnText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },

  dangerBtn: {
    backgroundColor: colors.error,
    borderRadius: radius.sm,
    paddingVertical: spacing.md + 2,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
    minHeight: 48,
  },
  dangerBtnText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    color: colors.white,
  },

  btnDisabled: { backgroundColor: colors.emeraldSoft },

  // ── Modal (unused in this screen but kept for compatibility) ──────────────────

  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xxl,
  },
  modalCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 0.5,
    borderColor: colors.border,
    width: "100%",
    overflow: "hidden",
  },
  modalTitle: {
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginBottom: spacing.md - 2,
  },
  modalBody: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    lineHeight: 21,
    marginBottom: spacing.xxl - 4,
  },
  modalBtns: { flexDirection: "row", gap: spacing.sm + 2, alignItems: "stretch" },
  modalBtn: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  outlineBtn: { borderWidth: 1.5, borderColor: colors.border },
  outlineBtnText: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },
});
