import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Modal,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Store, Info, User, UserRoundPlus, ArrowLeftRight, ArrowLeft, HelpCircle, AtSign, Phone, Building2, ChevronRight, CheckCircle2, Archive, AlertCircle, Trash2 } from "lucide-react-native";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import { archiveTenant, assignStallToExistingTenant, checkTenantArchiveEligibility, createTenantAccount, DEFAULT_TENANT_PASSWORD, removeStallFromTenantSafely, usernameBase } from "../shared/services/accountServices";
import HelpTour, { HelpStep } from "./components/HelpTour";
import HelpSupportModal from "./components/HelpSupportModal";
import { hasSeenPageTour, markPageTourSeen } from "../shared/services/onboardingTour";
import { requireOnlineAction } from "../shared/services/networkStatus";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../shared/theme";
import { ScreenHeader, Card, Button, TextField, EmptyState } from "../shared/components/ui";

type StallInfo = {
  id?: string;
  buildingNumber: string;
  spaceId: string;
  tenantId: string;
  price: number;
};

type TenantInfo = {
  uid: string;
  firstName: string;
  middleName: string;
  lastName: string;
  username: string;
  contactNo: string;
};

type ExistingTenantChoice = TenantInfo & {
  stallCount: number;
  dailyTotal: number;
};

type AssignmentStep = "choose" | "existing" | "confirm" | "assigning" | "success";

type AccountScreenProps = {
  manageTitle?: string;
  manageTourKey?: string;
  allowArchive?: boolean;
};

export function AccountScreen({
  manageTitle = "Manage Account",
  manageTourKey = "account-manage",
  allowArchive = false,
}: AccountScreenProps = {}) {
  const insets = useSafeAreaInsets();
  const { stallId, tenantId, mode } = useLocalSearchParams<{
    stallId: string;
    tenantId?: string;
    mode: string;
  }>();
  const isCreate = mode === "create";
  const mountedRef = useRef(true);

  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [stallInfo, setStallInfo] = useState<StallInfo | null>(null);
  const [assignedStalls, setAssignedStalls] = useState<StallInfo[]>([]);
  const [tenantInfo, setTenantInfo] = useState<TenantInfo | null>(null);

  // Create mode form fields
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [contactNo, setContactNo] = useState("");

  // Field errors (create mode)
  const [firstNameError, setFirstNameError] = useState("");
  const [lastNameError, setLastNameError] = useState("");
  const [contactNoError, setContactNoError] = useState("");

  // Shared submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");
  const [tourVisible, setTourVisible] = useState(false);
  const [helpSupportVisible, setHelpSupportVisible] = useState(false);
  const [archiveVisible, setArchiveVisible] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const [assignmentModalVisible, setAssignmentModalVisible] = useState(isCreate);
  const [assignmentStep, setAssignmentStep] = useState<AssignmentStep>("choose");
  const [existingTenants, setExistingTenants] = useState<ExistingTenantChoice[]>([]);
  const [selectedExistingTenant, setSelectedExistingTenant] = useState<ExistingTenantChoice | null>(null);
  const [stallLimitTenant, setStallLimitTenant] = useState<ExistingTenantChoice | null>(null);
  const [existingTenantSearch, setExistingTenantSearch] = useState("");
  const [existingTenantsLoading, setExistingTenantsLoading] = useState(false);
  const [assignmentError, setAssignmentError] = useState("");
  const [removeStallMode, setRemoveStallMode] = useState(false);
  const [selectedRemoveStallId, setSelectedRemoveStallId] = useState("");
  const [removeStallConfirmVisible, setRemoveStallConfirmVisible] = useState(false);
  const [removingStall, setRemovingStall] = useState(false);
  const [removeStallError, setRemoveStallError] = useState("");

  const helpRef = useRef<View>(null);
  const stallPillRef = useRef<View>(null);
  const detailsRef = useRef<View>(null);
  const passwordNoteRef = useRef<View>(null);
  const createBtnRef = useRef<View>(null);
  const infoCardRef = useRef<View>(null);
  const moveBtnRef = useRef<View>(null);
  const archiveBtnRef = useRef<View>(null);

  const tourSteps: HelpStep[] = isCreate
    ? [
        { key: "stall", ref: stallPillRef, title: "Stall", description: "The stall this tenant will be registered to.", edgeInset: "top" },
        { key: "details", ref: detailsRef, title: "Tenant details", description: "Enter the new tenant's name and contact number. RentWise creates their login username as RW plus their first name.", edgeInset: "top" },
        { key: "password", ref: passwordNoteRef, title: "Default password", description: "The tenant signs in with this password the first time, then sets their own.", edgeInset: "top" },
        { key: "create", ref: createBtnRef, title: "Create Account", description: "Creates the tenant's account and assigns them to this stall.", edgeInset: "top" },
      ]
    : [
        { key: "stall", ref: stallPillRef, title: "Stall", description: "The stall this tenant currently occupies.", edgeInset: "top" },
        { key: "info", ref: infoCardRef, title: "Tenant info", description: "The current tenant's name, email, and contact number.", edgeInset: "top" },
        { key: "move", ref: moveBtnRef, title: allowArchive ? "Remove Stall" : "Move Location", description: allowArchive ? "Select and safely release one of this tenant's stalls. The final stall stays protected." : "Relocate this active tenant to a different stall, without archiving them first.", edgeInset: "top" },
        ...(allowArchive ? [{ key: "archive", ref: archiveBtnRef, title: "Archive Tenant", description: "Archives this tenant and marks their assigned stall as unoccupied after confirmation.", edgeInset: "top" } as HelpStep] : []),
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
      if (allowArchive && tenantId) {
        fetchTenantData(tenantId);
      } else if (stallId) {
        fetchData(stallId);
      } else {
        setLoadError(allowArchive ? "No tenant selected." : "No stall selected.");
        setLoading(false);
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowArchive, stallId, tenantId]);

  // Auto-opens the guided tour the first time the admin ever lands on this
  // page — never again after that, since it flips a persisted per-device
  // flag. Can still be replayed anytime via the Help button. Create and
  // manage modes show almost entirely different content, so each gets its
  // own independent "have they seen it" flag.
  useEffect(() => {
    if (checking) return;
    (async () => {
      const pageKey = isCreate ? "account-create" : manageTourKey;
      const seen = await hasSeenPageTour(pageKey);
      if (!seen) {
        setTourVisible(true);
        await markPageTourSeen(pageKey);
      }
    })();
  }, [checking, isCreate, manageTourKey]);

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
          id,
          buildingNumber: (sd.buildingNumber as string) ?? "",
          spaceId: (sd.spaceId as string) ?? "",
          tenantId: (sd.tenantId as string) ?? "",
          price: Number(sd.price ?? 0),
        };
        setStallInfo(stall);
        setAssignedStalls([stall]);

        if (!isCreate && stall.tenantId) {
          const userSnap = await getDoc(doc(db, "users", stall.tenantId));
          if (userSnap.exists()) {
            const ud = userSnap.data();
            const first = (ud.firstName as string) ?? "";
            const last = (ud.lastName as string) ?? "";
            setTenantInfo({
              uid: userSnap.id,
              firstName: first,
              middleName: (ud.middleName as string) ?? "",
              lastName: last,
              username: usernameBase(first, last),
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

  const fetchTenantData = useCallback(async (uid: string) => {
    setLoading(true);
    setLoadError("");
    setTenantInfo(null);
    setStallInfo(null);
    setAssignedStalls([]);
    try {
      const userSnap = await getDoc(doc(db, "users", uid));
      if (!userSnap.exists()) {
        setLoadError("Tenant not found.");
        return;
      }
      const data = userSnap.data();
      if (data.role !== "tenant") {
        setLoadError("The selected account is not a tenant.");
        return;
      }
      if (data.status !== "active") {
        setLoadError("This tenant account is not active.");
        return;
      }

      const ids = [...new Set([
        ...(Array.isArray(data.stallIds) ? data.stallIds.map(String) : []),
        String(data.primaryStallId ?? ""),
        String(data.stallId ?? ""),
      ].filter(Boolean))];
      if (ids.length === 0 || ids.length > 3) {
        setLoadError(ids.length > 3 ? "Tenant assignment exceeds the three-stall limit." : "This tenant has no assigned stalls.");
        return;
      }

      const stallSnaps = await Promise.all(ids.map((id) => getDoc(doc(db, "stalls", id))));
      const stalls: StallInfo[] = [];
      for (let index = 0; index < stallSnaps.length; index += 1) {
        const snap = stallSnaps[index];
        if (!snap.exists()) {
          setLoadError("A tenant stall assignment is missing. No changes were made.");
          return;
        }
        const stallData = snap.data();
        if (String(stallData.tenantId ?? "") !== uid) {
          setLoadError("Tenant and stall records do not match. No changes were made.");
          return;
        }
        stalls.push({
          id: ids[index],
          buildingNumber: String(stallData.buildingNumber ?? ""),
          spaceId: String(stallData.spaceId ?? ""),
          tenantId: uid,
          price: Number(stallData.price ?? 0),
        });
      }

      const primaryId = String(data.primaryStallId ?? data.stallId ?? ids[0]);
      const primary = stalls.find((stall) => stall.id === primaryId) ?? stalls[0];
      const first = String(data.firstName ?? "");
      const last = String(data.lastName ?? "");
      setTenantInfo({
        uid,
        firstName: first,
        middleName: String(data.middleName ?? ""),
        lastName: last,
        username: String(data.username ?? (first && last ? usernameBase(first, last) : "")),
        contactNo: String(data.contactNo ?? ""),
      });
      setAssignedStalls(stalls);
      setStallInfo(primary);
    } catch (error) {
      console.error("MANAGE TENANT FETCH ERROR:", error);
      setLoadError("Failed to load tenant data. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadExistingTenants = async () => {
    setExistingTenantsLoading(true);
    setAssignmentError("");
    try {
      const snapshot = await getDocs(query(
        collection(db, "users"),
        where("role", "==", "tenant"),
        where("status", "==", "active"),
      ));
      const choices = snapshot.docs.map((tenantDoc) => {
        const data = tenantDoc.data();
        const ids = [...new Set([
          ...(Array.isArray(data.stallIds) ? data.stallIds.map(String) : []),
          String(data.primaryStallId ?? ""),
          String(data.stallId ?? ""),
        ].filter(Boolean))];
        const first = String(data.firstName ?? "");
        const last = String(data.lastName ?? "");
        return {
          uid: tenantDoc.id,
          firstName: first,
          middleName: String(data.middleName ?? ""),
          lastName: last,
          username: String(data.username ?? (first && last ? usernameBase(first, last) : "")),
          contactNo: String(data.contactNo ?? ""),
          stallCount: ids.length,
          dailyTotal: Number(data.price ?? 0),
        } satisfies ExistingTenantChoice;
      });
      choices.sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
      setExistingTenants(choices);
    } catch (error) {
      console.error("LOAD EXISTING TENANTS ERROR:", error);
      setAssignmentError("Unable to load active tenants. Please try again.");
    } finally {
      setExistingTenantsLoading(false);
    }
  };

  const openExistingTenantSelection = async () => {
    setAssignmentStep("existing");
    await loadExistingTenants();
  };

  const confirmExistingTenantAssignment = async () => {
    if (!selectedExistingTenant || !stallId) return;
    if (!(await requireOnlineAction("Assigning an additional stall"))) return;
    setAssignmentStep("assigning");
    setAssignmentError("");
    try {
      await assignStallToExistingTenant(selectedExistingTenant.uid, stallId);
      setAssignmentStep("success");
      setTimeout(() => {
        if (mountedRef.current) router.replace("/building");
      }, 900);
    } catch (error: any) {
      console.error("ASSIGN EXISTING TENANT ERROR:", error);
      setAssignmentError(error?.message?.replace(/^.*?:\s*/, "") || "Unable to assign this stall. Please try again.");
      setAssignmentStep("confirm");
    }
  };

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
    if (!/^9\d{9}$/.test(contactNo.trim())) {
      setContactNoError("Enter a valid 10-digit number starting with 9.");
      valid = false;
    } else setContactNoError("");
    return valid;
  };

  const handleCreate = async () => {
    if (!validateCreate() || !stallId) return;
    if (!(await requireOnlineAction("Registering a tenant"))) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const created = await createTenantAccount({
        firstName: firstName.trim(),
        middleName: middleName.trim(),
        lastName: lastName.trim(),
        contactNo: contactNo.trim(),
        stallId,
      });
      setSubmitSuccess(`Tenant account created. Username: ${created.username}`);
      setTimeout(() => {
        if (mountedRef.current) router.replace("/building");
      }, 1200);
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string };
      if (e.code === "auth/email-already-in-use") {
        setSubmitError("The generated username is already in use. Please try again.");
      } else if (
        e.message?.includes("username") ||
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

  const handleArchiveTenant = async () => {
    if (!allowArchive || !tenantInfo) return;
    if (!(await requireOnlineAction("Archiving a tenant"))) return;

    setArchiving(true);
    setArchiveError("");
    try {
      const eligibility = await checkTenantArchiveEligibility(tenantInfo.uid);
      if (!eligibility.canArchive) {
        if (eligibility.hasPendingPayment) {
          setArchiveError("Cannot archive this tenant. An online payment is awaiting approval. Review it in Financials first.");
        } else {
          setArchiveError(
            `Cannot archive this tenant. They have an unsettled balance of ₱${eligibility.outstandingBalance.toLocaleString()}. Settle it in Financials first.`,
          );
        }
        return;
      }

      await archiveTenant(tenantInfo.uid);
      setArchiveVisible(false);
      router.replace("/tenant-management");
    } catch (error) {
      console.error("ARCHIVE TENANT ERROR:", error);
      setArchiveError("Failed to archive tenant. Please try again.");
    } finally {
      setArchiving(false);
    }
  };

  const handleRemoveStall = async () => {
    if (!tenantInfo || !selectedRemoveStallId) return;
    if (!(await requireOnlineAction("Removing a tenant stall"))) return;
    setRemovingStall(true);
    setRemoveStallError("");
    try {
      await removeStallFromTenantSafely(tenantInfo.uid, selectedRemoveStallId);
      setRemoveStallConfirmVisible(false);
      setRemoveStallMode(false);
      setSelectedRemoveStallId("");
      await fetchTenantData(tenantInfo.uid);
    } catch (error: any) {
      console.error("REMOVE TENANT STALL ERROR:", error);
      const message = String(error?.message ?? "").replace(/^.*?:\s*/, "");
      setRemoveStallError(message || "Unable to remove this stall. Please try again.");
    } finally {
      setRemovingStall(false);
    }
  };

  if (checking) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator color={colors.emerald} size="large" />
      </View>
    );
  }

  const normalizedTenantSearch = existingTenantSearch.trim().toLowerCase();
  const filteredExistingTenants = existingTenants.filter((tenant) =>
    `${tenant.firstName} ${tenant.middleName} ${tenant.lastName} ${tenant.username}`
      .toLowerCase()
      .includes(normalizedTenantSearch),
  );
  const selectedRemoveStall = assignedStalls.find((stall) => stall.id === selectedRemoveStallId) ?? null;
  const displayedTenantUsername = tenantInfo
    ? (/^rw/i.test(tenantInfo.username) ? tenantInfo.username.toUpperCase() : usernameBase(tenantInfo.firstName, tenantInfo.lastName))
    : "";

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={isCreate ? "Register Tenant" : manageTitle}
        onBack={() => router.back()}
        rightAction={
          <View ref={helpRef} collapsable={false}>
            <TouchableOpacity style={styles.headerIconBtn} onPress={() => setHelpSupportVisible(true)} activeOpacity={0.7} hitSlop={8}>
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
              <Pressable style={styles.backLink} onPress={() => router.back()}>
                {({ pressed }) => (
                  <>
                    <ArrowLeft size={15} color={pressed ? colors.ink : colors.emerald} style={{ marginRight: spacing.xs }} />
                    <Text style={[styles.backLinkText, pressed && styles.backLinkTextPressed]}>Go Back</Text>
                  </>
                )}
              </Pressable>
            </View>
          ) : (
            <>
              {/* STALL ID PILL */}
              {stallInfo && isCreate && (
                <View style={styles.stallPill} ref={stallPillRef} collapsable={false}>
                  <View style={styles.stallPillIcon}><Store size={15} color={colors.ink} /></View>
                  <View>
                    <Text style={styles.stallPillLabel}>ASSIGNED SPACE</Text>
                    <Text style={styles.stallPillText}>Building {stallInfo.buildingNumber} · Space {stallInfo.spaceId}</Text>
                  <Text style={styles.hiddenLegacyText}>
                    Building {stallInfo.buildingNumber} {"·"} Space ID:{" "}
                    {stallInfo.spaceId}
                  </Text>
                  </View>
                </View>
              )}

              {isCreate ? (
                /* ── Create Mode ─────────────────────────────────────── */
                <>
                  <View style={styles.sectionHeadingRow}>
                    <Text style={styles.sectionHeading}>TENANT INFORMATION</Text>
                    <Text style={styles.requiredLegend}>* Required</Text>
                  </View>
                  <View ref={detailsRef} collapsable={false}>
                  <View style={styles.formCard}>
                  <Field
                    label="First Name"
                    required
                    placeholder="Enter tenant first name"
                    value={firstName}
                    onChange={(t) => {
                      setFirstName(t);
                      setFirstNameError("");
                    }}
                    error={firstNameError}
                    disabled={submitting || !!submitSuccess}
                  />
                  <Field
                    label="Middle Name (Optional)"
                    optional
                    placeholder="Enter middle name (optional)"
                    value={middleName}
                    onChange={setMiddleName}
                    disabled={submitting || !!submitSuccess}
                  />
                  <Field
                    label="Last Name"
                    required
                    placeholder="Enter tenant last name"
                    value={lastName}
                    onChange={(t) => {
                      setLastName(t);
                      setLastNameError("");
                    }}
                    error={lastNameError}
                    disabled={submitting || !!submitSuccess}
                  />
                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>Contact No.<Text style={styles.requiredMark}> *</Text></Text>
                    <View style={styles.phoneRow}>
                      <View style={styles.phonePrefix}>
                        <Text style={styles.phonePrefixText}>+63</Text>
                      </View>
                      <TextInput
                        style={styles.phoneInput}
                        value={contactNo}
                        onChangeText={(t) => {
                          setContactNo(t.replace(/\D/g, "").slice(0, 10));
                          setContactNoError("");
                        }}
                        placeholder="912 345 6789"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="phone-pad"
                        maxLength={10}
                        editable={!submitting && !submitSuccess}
                      />
                    </View>
                    {!!contactNoError && (
                      <Text style={{ color: colors.error, fontSize: 12, marginTop: 4 }}>
                        {contactNoError}
                      </Text>
                    )}
                    <Text style={styles.contactHint}>Primary mobile channel for payment notifications and SMS receipts.</Text>
                  </View>
                  </View>

                  <Text style={styles.sectionHeading}>ACCOUNT CREDENTIALS</Text>
                  <View style={styles.credentialsCard}>
                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>Generated username</Text>
                    <TextField
                      value={firstName.trim() && lastName.trim() ? usernameBase(firstName, lastName) : "*Generated automatically from name (e.g. RWJUAN)*"}
                      editable={false}
                      style={styles.generatedUsernameInput}
                    />
                    <View style={styles.usernameHintRow}>
                      <Info size={12} color={colors.textMuted} />
                      <Text style={styles.usernameHint}>The tenant signs in with this username and their password. A number is added automatically if it is already used.</Text>
                    </View>
                  </View>
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
                      icon={<UserRoundPlus size={15} color={colors.white} />}
                    />
                  </View>
                </>
              ) : (
                /* ── Manage Mode ─────────────────────────────────────── */
                <>
                  {tenantInfo ? (
                    <>
                      <View ref={infoCardRef} collapsable={false}>
                      <Card noPadding style={styles.manageLegacyCard}>
                        <InfoRow
                          label="Name"
                          value={[tenantInfo.firstName, tenantInfo.middleName, tenantInfo.lastName].filter(Boolean).join(" ")}
                        />
                        <InfoRow label="Username" value={displayedTenantUsername || "—"} />
                        <InfoRow
                          label="Contact no."
                          value={tenantInfo.contactNo ? `+63 ${tenantInfo.contactNo}` : "—"}
                        />
                      </Card>
                        <View style={styles.manageProfileCard}>
                          <View style={styles.manageAccent} />
                          <View style={styles.manageIdentityRow}>
                            <View style={styles.manageAvatar}>
                              <Text style={styles.manageAvatarText}>{`${tenantInfo.firstName.charAt(0)}${tenantInfo.lastName.charAt(0)}`.toUpperCase()}</Text>
                              <View style={styles.avatarOnlineDot} />
                            </View>
                            <View style={styles.manageIdentityText}>
                              <Text style={styles.manageName}>{[tenantInfo.firstName, tenantInfo.middleName, tenantInfo.lastName].filter(Boolean).join(" ")}</Text>
                              <View style={styles.registeredBadge}>
                                <CheckCircle2 size={10} color={colors.emerald} />
                                <Text style={styles.registeredBadgeText}>Registered Market Tenant</Text>
                              </View>
                            </View>
                          </View>
                          <View style={styles.manageContactCard}>
                            <View style={styles.manageDetailRow}>
                              <View style={styles.manageDetailIcon}><AtSign size={12} color={colors.ink} /></View>
                              <View><Text style={styles.manageDetailLabel}>USERNAME</Text><Text style={styles.manageDetailValue}>{displayedTenantUsername || "—"}</Text></View>
                            </View>
                            <View style={styles.manageDivider} />
                            <View style={styles.manageDetailRow}>
                              <View style={styles.manageDetailIcon}><Phone size={11} color={colors.ink} /></View>
                              <View><Text style={styles.manageDetailLabel}>CONTACT NUMBER</Text><Text style={styles.manageDetailValue}>{tenantInfo.contactNo ? `+63 ${tenantInfo.contactNo}` : "—"}</Text></View>
                            </View>
                          </View>
                        </View>
                      </View>

                      <View style={styles.assignedLocationCard}>
                        <View style={styles.locationHeaderRow}>
                          <View style={styles.locationTitleRow}><Building2 size={12} color={colors.emerald} /><Text style={styles.locationLabel}>{allowArchive ? "ASSIGNED STALLS" : "ASSIGNED LOCATION"}</Text></View>
                          <Text style={styles.locationBuilding}>{allowArchive ? `${assignedStalls.length} of 3 stalls` : `Building ${stallInfo?.buildingNumber}`}</Text>
                        </View>
                        {allowArchive ? assignedStalls.map((assignedStall, index) => {
                          const selected = assignedStall.id === selectedRemoveStallId;
                          return (
                          <Pressable
                            key={assignedStall.id ?? `${assignedStall.buildingNumber}-${assignedStall.spaceId}`}
                            disabled={!removeStallMode}
                            accessibilityRole={removeStallMode ? "checkbox" : undefined}
                            accessibilityState={removeStallMode ? {checked: selected} : undefined}
                            onPress={() => setSelectedRemoveStallId(selected ? "" : assignedStall.id ?? "")}
                            style={[styles.assignedStallRow, index > 0 && styles.assignedStallRowBorder, selected && styles.assignedStallRowSelected]}
                          >
                            {removeStallMode ? <View style={[styles.stallCheckbox, selected && styles.stallCheckboxSelected]}>{selected ? <Text style={styles.stallCheckboxTick}>✓</Text> : null}</View> : null}
                            <View style={styles.assignedStallDetails}>
                              <Text style={styles.assignedStallSpace}>SPACE {assignedStall.spaceId}</Text>
                              <Text style={styles.assignedStallBuilding}>Building {assignedStall.buildingNumber}{assignedStall.id === stallInfo?.id ? " · Primary" : ""}</Text>
                            </View>
                            <Text style={styles.assignedStallPrice}>₱{assignedStall.price.toLocaleString()}/day</Text>
                          </Pressable>
                        );}) : (
                          <>
                            <Text style={styles.locationSpace}>SPACE {stallInfo?.spaceId}</Text>
                            <View style={styles.occupiedRow}><View style={styles.occupiedDot} /><Text style={styles.occupiedText}>Currently Leased &amp; Occupied</Text></View>
                          </>
                        )}
                        {allowArchive ? <View style={styles.combinedRentRow}><Text style={styles.combinedRentLabel}>Combined daily rent</Text><Text style={styles.combinedRentValue}>₱{assignedStalls.reduce((sum, stall) => sum + stall.price, 0).toLocaleString()}</Text></View> : null}
                        <Store size={64} color="#DFECE7" style={styles.locationWatermark} />
                      </View>

                      {/* MOVE LOCATION — relocate this active tenant to a different
                          stall directly, instead of archiving them first. */}
                      <Pressable
                        ref={moveBtnRef}
                        style={({ pressed }) => [styles.outlineActionBtn, pressed && styles.outlineActionBtnPressed, allowArchive && removeStallMode && !selectedRemoveStallId && styles.removeStallButtonDisabled]}
                        onPress={() => {
                          if (allowArchive) {
                            if (assignedStalls.length <= 1) {
                              setSubmitError("The tenant's final stall cannot be removed. Archive the tenant instead.");
                              return;
                            }
                            setSubmitError("");
                            setRemoveStallError("");
                            if (!removeStallMode) {
                              setRemoveStallMode(true);
                              setSelectedRemoveStallId("");
                            } else if (selectedRemoveStallId) {
                              setRemoveStallConfirmVisible(true);
                            }
                            return;
                          }
                          router.push({
                            pathname: "/tenant-relocation",
                            params: {
                              mode: "move",
                              uid: tenantInfo.uid,
                              firstName: tenantInfo.firstName,
                              middleName: tenantInfo.middleName,
                              lastName: tenantInfo.lastName,
                              email: tenantInfo.username,
                              contactNo: tenantInfo.contactNo,
                              buildingNumber: stallInfo?.buildingNumber ?? "",
                              spaceId: stallInfo?.spaceId ?? "",
                              stallId: stallInfo?.id ?? stallId ?? "",
                            },
                          } as any);
                        }}
                      >
                        {({ pressed }) => (
                          <View style={styles.moveLocationContent}>
                            <View style={styles.moveLocationIcon}>{allowArchive ? <Trash2 size={14} color={colors.error} /> : <ArrowLeftRight size={14} color={colors.ink} />}</View>
                            <View style={styles.moveLocationTextWrap}>
                              <Text style={[styles.outlineActionBtnText, allowArchive && styles.removeStallButtonText, pressed && styles.outlineActionBtnTextPressed]}>{allowArchive ? (removeStallMode ? "Confirm selected stall" : "Remove Stall") : "Move Location"}</Text>
                              <Text style={styles.moveLocationSubtitle} numberOfLines={1}>{allowArchive ? (removeStallMode ? "Select one assigned stall using its checkbox." : "Release one of this tenant's assigned stalls...") : "Transfer tenant to another available stall..."}</Text>
                            </View>
                            <ChevronRight size={15} color={colors.ink} />
                          </View>
                        )}
                      </Pressable>

                      {allowArchive && removeStallMode ? (
                        <Pressable style={styles.cancelRemoveSelection} onPress={() => { setRemoveStallMode(false); setSelectedRemoveStallId(""); setRemoveStallError(""); }}>
                          <Text style={styles.cancelRemoveSelectionText}>Cancel stall selection</Text>
                        </Pressable>
                      ) : null}

                      {allowArchive ? (
                        <Pressable
                          ref={archiveBtnRef}
                          style={({ pressed }) => [styles.archiveActionBtn, pressed && styles.archiveActionBtnPressed]}
                          onPress={() => {
                            setArchiveError("");
                            setArchiveVisible(true);
                          }}
                        >
                          {({ pressed }) => (
                            <View style={styles.archiveActionContent}>
                              <View style={styles.archiveActionIcon}><Archive size={14} color={colors.error} /></View>
                              <View style={styles.moveLocationTextWrap}>
                                <Text style={[styles.archiveActionTitle, pressed && styles.archiveActionTitlePressed]}>Archive Tenant</Text>
                                <Text style={styles.moveLocationSubtitle} numberOfLines={1}>Disable the account and release the assigned stall...</Text>
                              </View>
                              <ChevronRight size={15} color={colors.error} />
                            </View>
                          )}
                        </Pressable>
                      ) : null}

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

      <Modal
        visible={isCreate && assignmentModalVisible && !loading}
        transparent
        animationType="fade"
        onRequestClose={() => router.back()}
      >
        <View style={styles.assignmentOverlay}>
          <View style={styles.assignmentCard}>
            {stallLimitTenant ? (
              <View style={styles.stallLimitNotice}>
                <View style={styles.stallLimitIcon}><AlertCircle size={25} color={colors.error} /></View>
                <Text style={styles.assignmentTitle}>Stall limit reached</Text>
                <Text style={styles.stallLimitMessage}>
                  {[stallLimitTenant.firstName, stallLimitTenant.middleName, stallLimitTenant.lastName].filter(Boolean).join(" ")} is already renting the maximum of 3 stalls. Remove an assigned stall before adding another.
                </Text>
                <Pressable style={[styles.assignmentButton, styles.assignmentButtonPrimary, styles.stallLimitButton]} onPress={() => setStallLimitTenant(null)}>
                  <Text style={styles.assignmentButtonPrimaryText}>Okay</Text>
                </Pressable>
              </View>
            ) : assignmentStep === "choose" ? (
              <>
                <Text style={styles.assignmentEyebrow}>STALL ASSIGNMENT</Text>
                <Text style={styles.assignmentTitle}>How would you like to assign this stall?</Text>
                <Text style={styles.assignmentSubtitle}>Building {stallInfo?.buildingNumber || "—"} · Space {stallInfo?.spaceId || "—"}</Text>
                <Pressable style={styles.assignmentOption} onPress={() => setAssignmentModalVisible(false)}>
                  <UserRoundPlus size={19} color={colors.emerald} />
                  <View style={styles.assignmentOptionText}><Text style={styles.assignmentOptionTitle}>Register New Tenant</Text><Text style={styles.assignmentOptionSubtitle}>Continue using the registration form already open.</Text></View>
                  <ChevronRight size={17} color={colors.ink} />
                </Pressable>
                <Pressable style={styles.assignmentOption} onPress={openExistingTenantSelection}>
                  <Building2 size={19} color={colors.emerald} />
                  <View style={styles.assignmentOptionText}><Text style={styles.assignmentOptionTitle}>Add to Existing Tenant</Text><Text style={styles.assignmentOptionSubtitle}>Assign this stall to a tenant who is expanding.</Text></View>
                  <ChevronRight size={17} color={colors.ink} />
                </Pressable>
                <Pressable style={styles.assignmentCancelLink} onPress={() => router.back()}><Text style={styles.assignmentCancelText}>Cancel</Text></Pressable>
              </>
            ) : assignmentStep === "existing" ? (
              <>
                <Text style={styles.assignmentEyebrow}>SELECT TENANT</Text>
                <Text style={styles.assignmentTitle}>Add stall to an existing tenant</Text>
                <TextInput
                  value={existingTenantSearch}
                  onChangeText={setExistingTenantSearch}
                  placeholder="Search tenant or username"
                  placeholderTextColor={colors.textMuted}
                  style={styles.assignmentSearch}
                />
                {existingTenantsLoading ? <ActivityIndicator color={colors.emerald} style={{marginVertical: 28}} /> : (
                  <ScrollView style={styles.assignmentTenantList} nestedScrollEnabled>
                    {filteredExistingTenants.map((tenant) => {
                      const full = [tenant.firstName, tenant.middleName, tenant.lastName].filter(Boolean).join(" ");
                      const fullCapacity = tenant.stallCount >= 3;
                      return (
                        <Pressable
                          key={tenant.uid}
                          style={[styles.assignmentTenantRow, fullCapacity && styles.assignmentTenantRowDisabled]}
                          onPress={() => {
                            if (fullCapacity) {
                              setStallLimitTenant(tenant);
                              return;
                            }
                            setSelectedExistingTenant(tenant);
                            setAssignmentError("");
                            setAssignmentStep("confirm");
                          }}
                        >
                          <View style={styles.assignmentTenantAvatar}><Text style={styles.assignmentTenantAvatarText}>{`${tenant.firstName.charAt(0)}${tenant.lastName.charAt(0)}`.toUpperCase()}</Text></View>
                          <View style={styles.assignmentOptionText}><Text style={styles.assignmentOptionTitle}>{full}</Text><Text style={styles.assignmentOptionSubtitle}>{tenant.username} · {tenant.stallCount} of 3 stalls</Text></View>
                          <Text style={[styles.assignmentCapacity, fullCapacity && styles.assignmentCapacityFull]}>{fullCapacity ? "Full" : "Select"}</Text>
                        </Pressable>
                      );
                    })}
                    {!existingTenantsLoading && filteredExistingTenants.length === 0 ? <Text style={styles.assignmentEmpty}>No matching active tenants.</Text> : null}
                  </ScrollView>
                )}
                {assignmentError ? <Text style={styles.assignmentError}>{assignmentError}</Text> : null}
                <Pressable style={styles.assignmentBackLink} onPress={() => setAssignmentStep("choose")}><ArrowLeft size={14} color={colors.emerald} /><Text style={styles.assignmentBackText}>Back</Text></Pressable>
              </>
            ) : assignmentStep === "confirm" && selectedExistingTenant ? (
              <>
                <Text style={styles.assignmentEyebrow}>CONFIRM ASSIGNMENT</Text>
                <Text style={styles.assignmentTitle}>Assign this stall to {[selectedExistingTenant.firstName, selectedExistingTenant.middleName, selectedExistingTenant.lastName].filter(Boolean).join(" ")}?</Text>
                <View style={styles.assignmentSummary}>
                  <Text style={styles.assignmentSummaryLine}>Current stalls: {selectedExistingTenant.stallCount}</Text>
                  <Text style={styles.assignmentSummaryLine}>After assignment: {selectedExistingTenant.stallCount + 1} of 3 stalls</Text>
                  <Text style={styles.assignmentSummaryTotal}>Combined daily rent: ₱{(selectedExistingTenant.dailyTotal + Number(stallInfo?.price ?? 0)).toLocaleString()}</Text>
                </View>
                {assignmentError ? <Text style={styles.assignmentError}>{assignmentError}</Text> : null}
                <View style={styles.assignmentButtonRow}>
                  <Pressable style={[styles.assignmentButton, styles.assignmentButtonSecondary]} onPress={() => setAssignmentStep("existing")}><Text style={styles.assignmentButtonSecondaryText}>Back</Text></Pressable>
                  <Pressable style={[styles.assignmentButton, styles.assignmentButtonPrimary]} onPress={confirmExistingTenantAssignment}><Text style={styles.assignmentButtonPrimaryText}>Confirm</Text></Pressable>
                </View>
              </>
            ) : assignmentStep === "assigning" ? (
              <View style={styles.assignmentStatus}><ActivityIndicator color={colors.emerald} size="large" /><Text style={styles.assignmentStatusText}>Assigning stall securely…</Text></View>
            ) : (
              <View style={styles.assignmentStatus}><CheckCircle2 color={colors.emerald} size={34} /><Text style={styles.assignmentTitle}>Stall assigned successfully</Text></View>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={allowArchive && removeStallConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!removingStall) setRemoveStallConfirmVisible(false); }}
      >
        <View style={styles.archiveModalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => { if (!removingStall) setRemoveStallConfirmVisible(false); }} />
          <View style={styles.archiveModalCard}>
            <View style={styles.archiveModalTitleBar}><Text style={styles.archiveModalTitle}>Remove this stall?</Text></View>
            <View style={styles.archiveModalBody}>
              <Text style={styles.archiveModalMessage}>
                {selectedRemoveStall ? `Space ${selectedRemoveStall.spaceId} will become unoccupied. The tenant's new combined daily rent will be ₱${Math.max(0, assignedStalls.reduce((sum, stall) => sum + stall.price, 0) - selectedRemoveStall.price).toLocaleString()}.` : "Select an assigned stall first."}
              </Text>
              <Text style={styles.removeStallSafetyNote}>Existing payment history will not be changed. Removal is blocked while the tenant has an unsettled balance or pending payment.</Text>
              {removeStallError ? <View style={styles.archiveModalErrorBox}><AlertCircle size={14} color={colors.error} /><Text style={styles.archiveModalError}>{removeStallError}</Text></View> : null}
              <View style={styles.archiveModalButtons}>
                <Pressable style={[styles.archiveModalButton, styles.archiveModalCancel]} onPress={() => setRemoveStallConfirmVisible(false)} disabled={removingStall}><Text style={styles.archiveModalCancelText}>Cancel</Text></Pressable>
                <Pressable style={[styles.archiveModalButton, styles.archiveModalConfirm, removingStall && styles.archiveModalButtonDisabled]} onPress={handleRemoveStall} disabled={removingStall || !selectedRemoveStall}>
                  {removingStall ? <ActivityIndicator size="small" color={colors.white} /> : <Text style={styles.archiveModalConfirmText}>Remove Stall</Text>}
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={allowArchive && archiveVisible}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!archiving) setArchiveVisible(false); }}
      >
        <View style={styles.archiveModalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => { if (!archiving) setArchiveVisible(false); }}
          />
          <View style={styles.archiveModalCard}>
            <View style={styles.archiveModalTitleBar}>
              <Text style={styles.archiveModalTitle}>Archive tenant?</Text>
            </View>
            <View style={styles.archiveModalBody}>
              <Text style={styles.archiveModalMessage}>
                Are you sure you want to archive {[tenantInfo?.firstName, tenantInfo?.middleName, tenantInfo?.lastName].filter(Boolean).join(" ") || "this tenant"}? This will disable the account and change all assigned stalls to unoccupied.
              </Text>
              {archiveError ? (
                <View style={styles.archiveModalErrorBox}>
                  <AlertCircle size={14} color={colors.error} />
                  <Text style={styles.archiveModalError}>{archiveError}</Text>
                </View>
              ) : null}
              <View style={styles.archiveModalButtons}>
                <Pressable
                  style={({ pressed }) => [styles.archiveModalButton, styles.archiveModalCancel, pressed && styles.archiveModalCancelPressed]}
                  onPress={() => setArchiveVisible(false)}
                  disabled={archiving}
                >
                  <Text style={styles.archiveModalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.archiveModalButton, styles.archiveModalConfirm, pressed && styles.archiveModalConfirmPressed, archiving && styles.archiveModalButtonDisabled]}
                  onPress={handleArchiveTenant}
                  disabled={archiving}
                >
                  {archiving
                    ? <ActivityIndicator size="small" color={colors.white} />
                    : <Text style={styles.archiveModalConfirmText}>Archive</Text>}
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <HelpTour visible={tourVisible} steps={tourSteps} onClose={() => setTourVisible(false)} />
      <HelpSupportModal visible={helpSupportVisible} steps={tourSteps} onClose={() => setHelpSupportVisible(false)} onReplayTour={() => setTourVisible(true)} />
    </View>
  );
}

export default function Account() {
  return <AccountScreen />;
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
  required,
  optional,
  placeholder,
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
  required?: boolean;
  optional?: boolean;
  placeholder?: string;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}>
        <Text style={styles.fieldLabel}>{label}{required ? <Text style={styles.requiredMark}> *</Text> : null}</Text>
        {optional ? <Text style={styles.optionalText}>Optional</Text> : null}
      </View>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      <TextField
        value={value}
        onChangeText={onChange}
        autoCapitalize={autoCapitalize ?? "sentences"}
        keyboardType={keyboardType ?? "default"}
        maxLength={maxLength}
        editable={!disabled}
        error={error}
        placeholder={placeholder}
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
    paddingHorizontal: 12,
    paddingTop: 12,
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
  backLinkTextPressed: {
    color: colors.ink,
  },

  // ── Stall ID pill ─────────────────────────────────────────────────────────────

  stallPill: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    backgroundColor: "#EAF8F2",
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 11,
    marginBottom: 14,
  },

  stallPillIcon: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },

  stallPillLabel: {
    fontSize: 8,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },

  stallPillText: {
    fontSize: 12,
    fontFamily: fontFamily.medium,
    color: colors.ink,
  },

  hiddenLegacyText: { display: "none" },

  sectionHeadingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginHorizontal: 2,
    marginBottom: 8,
  },
  sectionHeading: {
    fontSize: 10,
    fontFamily: fontFamily.medium,
    color: colors.ink,
    marginHorizontal: 2,
    marginBottom: 8,
  },
  requiredLegend: {
    fontSize: 9,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  formCard: {
    backgroundColor: colors.white,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 2,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: "#F0F1EF",
  },
  credentialsCard: {
    backgroundColor: colors.white,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 2,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#F0F1EF",
  },

  // ── Tenant info card (manage mode) ────────────────────────────────────────────

  infoCard: {
    marginBottom: spacing.lg,
  },

  manageLegacyCard: { display: "none" },
  manageProfileCard: {
    position: "relative",
    overflow: "hidden",
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#EEF0ED",
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 14,
    marginBottom: 10,
  },
  manageAccent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: colors.emerald,
  },
  manageIdentityRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  manageAvatar: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  manageAvatarText: {
    color: colors.white,
    fontSize: 15,
    fontFamily: fontFamily.bold,
  },
  avatarOnlineDot: {
    position: "absolute",
    right: -3,
    bottom: -3,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.emerald,
    borderWidth: 2,
    borderColor: colors.white,
  },
  manageIdentityText: { flex: 1 },
  manageName: {
    fontSize: 13,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginBottom: 3,
  },
  registeredBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: 999,
    backgroundColor: "#DDF8EE",
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  registeredBadgeText: {
    fontSize: 8,
    fontFamily: fontFamily.medium,
    color: colors.emerald,
  },
  manageContactCard: {
    backgroundColor: "#F2F4F2",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  manageDetailRow: { flexDirection: "row", alignItems: "center" },
  manageDetailIcon: {
    width: 22,
    height: 22,
    borderRadius: 5,
    backgroundColor: "#E8EBE8",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 9,
  },
  manageDetailLabel: {
    fontSize: 8,
    fontFamily: fontFamily.medium,
    color: colors.ink,
  },
  manageDetailValue: {
    fontSize: 12,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
  },
  manageDivider: {
    height: 1,
    backgroundColor: "#E1E5E2",
    marginVertical: 7,
    marginLeft: 31,
  },
  assignedLocationCard: {
    position: "relative",
    overflow: "hidden",
    minHeight: 121,
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#EEF0ED",
    padding: 14,
    marginBottom: 10,
  },
  locationHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  locationTitleRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  locationLabel: { fontSize: 8, fontFamily: fontFamily.semibold, color: colors.emerald },
  locationBuilding: { fontSize: 8, fontFamily: fontFamily.regular, color: colors.ink },
  locationSpace: { fontSize: 24, fontFamily: fontFamily.bold, color: colors.ink, marginTop: 10 },
  occupiedRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  occupiedDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.emerald },
  occupiedText: { fontSize: 8, fontFamily: fontFamily.medium, color: colors.emerald },
  assignedStallRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingRight: 54 },
  assignedStallRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  assignedStallRowSelected: { backgroundColor: "transparent" },
  assignedStallDetails: { flex: 1 },
  stallCheckbox: { width: 20, height: 20, marginRight: 10, borderRadius: 5, borderWidth: 1.5, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.white },
  stallCheckboxSelected: { borderColor: colors.error, backgroundColor: colors.error },
  stallCheckboxTick: { fontSize: 13, lineHeight: 16, fontFamily: fontFamily.bold, color: colors.white },
  assignedStallSpace: { fontSize: 15, fontFamily: fontFamily.bold, color: colors.ink },
  assignedStallBuilding: { marginTop: 2, fontSize: 9, fontFamily: fontFamily.regular, color: colors.textMuted },
  assignedStallPrice: { fontSize: 11, fontFamily: fontFamily.semibold, color: colors.emerald },
  combinedRentRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, paddingRight: 54 },
  combinedRentLabel: { fontSize: 10, fontFamily: fontFamily.medium, color: colors.textSecondary },
  combinedRentValue: { fontSize: 13, fontFamily: fontFamily.bold, color: colors.ink },
  locationWatermark: { position: "absolute", right: 4, bottom: -3 },

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

  field: { marginBottom: 12 },

  fieldLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  fieldLabel: {
    fontSize: 10,
    fontFamily: fontFamily.medium,
    color: colors.ink,
    marginBottom: 5,
  },

  requiredMark: { color: colors.error },
  optionalText: {
    fontSize: 9,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    marginBottom: 5,
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
    borderWidth: 0,
    backgroundColor: colors.mist,
    overflow: "hidden",
  },
  phonePrefix: {
    backgroundColor: colors.mist,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
    borderRightWidth: 0,
    justifyContent: "center",
  },
  phonePrefixText: {
    fontSize: 11,
    fontFamily: fontFamily.medium,
    color: colors.emerald,
  },
  phoneInput: {
    flex: 1,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: 12,
    fontSize: 11,
    fontFamily: fontFamily.regular,
    color: colors.ink,
  },

  defaultPasswordNote: {
    display: "none",
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
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: colors.ink,
    marginTop: 8,
    marginBottom: spacing.md,
  },

  contactHint: {
    fontSize: 9,
    lineHeight: 13,
    fontFamily: fontFamily.regular,
    color: colors.textMuted,
    marginTop: 6,
  },
  generatedUsernameInput: {
    fontSize: 10,
    fontStyle: "italic",
  },
  usernameHintRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 5,
    marginTop: 7,
  },
  usernameHint: {
    flex: 1,
    fontSize: 9,
    lineHeight: 13,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
  },

  outlineActionBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#EEF0ED",
    backgroundColor: colors.white,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: spacing.md,
    minHeight: 54,
  },
  outlineActionBtnPressed: {
    backgroundColor: colors.mist,
  },
  outlineActionBtnText: {
    fontSize: 11,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
  },
  outlineActionBtnTextPressed: {
    color: colors.ink,
  },
  removeStallButtonText: { color: colors.error },
  removeStallButtonDisabled: { opacity: 0.55 },
  cancelRemoveSelection: { alignSelf: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.xs },
  cancelRemoveSelectionText: { fontSize: fontSize.xs, fontFamily: fontFamily.semibold, color: colors.textMuted },
  moveLocationContent: { flexDirection: "row", alignItems: "center", width: "100%" },
  moveLocationIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#DDF8EE",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 9,
  },
  moveLocationTextWrap: { flex: 1 },
  moveLocationSubtitle: { fontSize: 8, fontFamily: fontFamily.regular, color: colors.textSecondary, marginTop: 1 },
  archiveActionBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#F3D8D8",
    backgroundColor: colors.white,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: spacing.md,
    minHeight: 54,
  },
  archiveActionBtnPressed: { backgroundColor: colors.errorSoft },
  archiveActionContent: { flexDirection: "row", alignItems: "center", width: "100%" },
  archiveActionIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.errorSoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 9,
  },
  archiveActionTitle: { fontSize: 11, fontFamily: fontFamily.semibold, color: colors.error },
  archiveActionTitlePressed: { color: colors.error },

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
  assignmentOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: "center", alignItems: "center", padding: spacing.lg },
  assignmentCard: { width: "100%", maxWidth: 430, maxHeight: "84%", backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.lg },
  assignmentEyebrow: { fontSize: fontSize.xs, fontFamily: fontFamily.bold, color: colors.emerald, letterSpacing: 0.8 },
  assignmentTitle: { marginTop: spacing.sm, fontSize: fontSize.lg, fontFamily: fontFamily.bold, color: colors.ink, lineHeight: 24 },
  assignmentSubtitle: { marginTop: 5, marginBottom: spacing.md, fontSize: fontSize.sm, fontFamily: fontFamily.regular, color: colors.textSecondary },
  assignmentOption: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 68, marginTop: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.mist },
  assignmentOptionText: { flex: 1 },
  assignmentOptionTitle: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.ink },
  assignmentOptionSubtitle: { marginTop: 3, fontSize: fontSize.xs, fontFamily: fontFamily.regular, color: colors.textMuted, lineHeight: 16 },
  assignmentCancelLink: { alignSelf: "center", padding: spacing.md },
  assignmentCancelText: { fontSize: fontSize.sm, fontFamily: fontFamily.medium, color: colors.textMuted },
  assignmentSearch: { minHeight: 46, marginTop: spacing.md, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, fontSize: fontSize.sm, fontFamily: fontFamily.regular, color: colors.ink },
  assignmentTenantList: { marginTop: spacing.sm, maxHeight: 330 },
  assignmentTenantRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 64, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  assignmentTenantRowDisabled: { opacity: 0.48 },
  stallLimitNotice: { minHeight: 245, alignItems: "center", justifyContent: "center", paddingVertical: spacing.md },
  stallLimitIcon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: colors.errorSoft },
  stallLimitMessage: { marginTop: spacing.sm, maxWidth: 330, textAlign: "center", fontSize: fontSize.sm, fontFamily: fontFamily.regular, color: colors.textSecondary, lineHeight: 20 },
  stallLimitButton: { flex: 0, alignSelf: "stretch", marginTop: spacing.lg },
  assignmentTenantAvatar: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.emeraldSoft },
  assignmentTenantAvatarText: { fontSize: fontSize.xs, fontFamily: fontFamily.bold, color: colors.emerald },
  assignmentCapacity: { fontSize: fontSize.xs, fontFamily: fontFamily.semibold, color: colors.emerald },
  assignmentCapacityFull: { color: colors.error },
  assignmentEmpty: { paddingVertical: spacing.xl, textAlign: "center", fontSize: fontSize.sm, fontFamily: fontFamily.regular, color: colors.textMuted },
  assignmentError: { marginTop: spacing.sm, fontSize: fontSize.xs, fontFamily: fontFamily.medium, color: colors.error, lineHeight: 17 },
  assignmentBackLink: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 5, marginTop: spacing.md, paddingVertical: spacing.sm },
  assignmentBackText: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.emerald },
  assignmentSummary: { marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.mist },
  assignmentSummaryLine: { marginBottom: 6, fontSize: fontSize.sm, fontFamily: fontFamily.regular, color: colors.textSecondary },
  assignmentSummaryTotal: { marginTop: 5, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, fontSize: fontSize.md, fontFamily: fontFamily.bold, color: colors.ink },
  assignmentButtonRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  assignmentButton: { flex: 1, minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  assignmentButtonSecondary: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  assignmentButtonSecondaryText: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.ink },
  assignmentButtonPrimary: { backgroundColor: colors.emerald },
  assignmentButtonPrimaryText: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.white },
  assignmentStatus: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: spacing.md },
  assignmentStatusText: { fontSize: fontSize.sm, fontFamily: fontFamily.medium, color: colors.textSecondary },
  archiveModalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
  },
  archiveModalCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.white,
  },
  archiveModalTitleBar: { backgroundColor: colors.ink, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  archiveModalTitle: { fontSize: fontSize.lg, fontFamily: fontFamily.bold, color: colors.white },
  archiveModalBody: { padding: spacing.lg },
  archiveModalMessage: { fontSize: fontSize.sm, fontFamily: fontFamily.regular, color: colors.textSecondary, lineHeight: 20 },
  removeStallSafetyNote: { marginTop: spacing.md, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.mist, fontSize: fontSize.xs, fontFamily: fontFamily.regular, color: colors.textMuted, lineHeight: 17 },
  archiveModalErrorBox: { flexDirection: "row", alignItems: "flex-start", gap: 7, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.sm, backgroundColor: colors.errorSoft },
  archiveModalError: { flex: 1, fontSize: fontSize.sm, fontFamily: fontFamily.medium, color: colors.error, lineHeight: 18 },
  archiveModalButtons: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  archiveModalButton: { flex: 1, minHeight: 44, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  archiveModalCancel: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  archiveModalCancelPressed: { backgroundColor: colors.mist },
  archiveModalCancelText: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.ink },
  archiveModalConfirm: { backgroundColor: colors.error },
  archiveModalConfirmPressed: { opacity: 0.86 },
  archiveModalConfirmText: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.white },
  archiveModalButtonDisabled: { opacity: 0.6 },
});
