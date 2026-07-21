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
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { sendEmailVerification, updatePassword } from "firebase/auth";
import { auth } from "../../shared/firebaseConfig";
import { db } from "../../shared/services/firestore";
import { getTenantData, updateTenantProfile, syncPersonalEmail } from "../../services/tenantService";
import { logoutUser } from "../../services/authService";
import { setRememberMe } from "../../shared/services/rememberMe";
import { router } from "expo-router";
import { Store, Tag, CheckCircle2, LogOut, User, Phone, Mail, Pencil, ShieldCheck, HelpCircle, Eye, EyeOff } from "lucide-react-native";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";
import HelpTour, { HelpStep } from "../components/HelpTour";
import { hasSeenPageTour, markPageTourSeen } from "../../shared/services/onboardingTour";

type MarketCategory = "Wet Market" | "Dry Market" | "Home Essential";
const MARKET_CATEGORIES: MarketCategory[] = ["Wet Market", "Dry Market", "Home Essential"];

export default function Profile() {
  const insets = useSafeAreaInsets();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [contact, setContact] = useState("");
  const [personalEmail, setPersonalEmail] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);
  const [stallId, setStallId] = useState("");
  const [memberSince, setMemberSince] = useState("");
  const [category, setCategory] = useState<MarketCategory | "">("");
  const [lastNameFocused, setLastNameFocused] = useState(false);
  const [firstNameFocused, setFirstNameFocused] = useState(false);
  const [contactFocused, setContactFocused] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [original, setOriginal] = useState({ firstName: "", lastName: "", contact: "", personalEmail: "", category: "" as MarketCategory | "" });
  const [isEditing, setIsEditing] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [pwError, setPwError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [changingPw, setChangingPw] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(20)).current;

  const [tourVisible, setTourVisible] = useState(false);
  const helpRef = useRef<View>(null);
  const identityRef = useRef<View>(null);
  const categoryRef = useRef<View>(null);
  const formRef = useRef<View>(null);
  const emailSectionRef = useRef<View>(null);
  const pwSectionRef = useRef<View>(null);
  const saveBtnRef = useRef<View>(null);
  const signOutRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const isEditingRef = useRef(isEditing);
  useEffect(() => {
    isEditingRef.current = isEditing;
  }, [isEditing]);

  // Scrolls a given section into view and gives the ScrollView time to
  // settle before HelpTour measures it — otherwise a section below the
  // fold would measure to its stale, off-screen position, and its
  // spotlight would bleed past the visible screen edge.
  const scrollSectionIntoView = (targetRef: React.RefObject<View | null>) =>
    new Promise<void>((resolve) => {
      const scrollNode = scrollRef.current?.getNativeScrollRef?.();
      if (!scrollNode || !targetRef.current) { resolve(); return; }
      targetRef.current.measureLayout(
        scrollNode as any,
        (_x: number, y: number) => {
          scrollRef.current?.scrollTo({ y: Math.max(0, y - 100), animated: true });
          setTimeout(resolve, 400);
        },
        () => resolve(),
      );
    });

  const tourSteps: HelpStep[] = [
    { key: "identity", ref: identityRef, title: "Your space", description: "Your space ID and how long you've been a tenant.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(identityRef) },
    { key: "category", ref: categoryRef, title: "Market category", description: "The kind of goods sold at your stall. Tap Edit Profile to change it — updates here sync with the admin's records too.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(categoryRef) },
    { key: "form", ref: formRef, endRef: emailSectionRef, title: "Your details", description: "Your name, contact number, and personal email — the email enables self-service password reset without needing the admin, once verified. Didn't get the verification email? Resend it here.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(formRef) },
    { key: "save", ref: saveBtnRef, title: "Edit Profile", description: "Unlocks the fields above so you can update them.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(saveBtnRef) },
    { key: "password", ref: pwSectionRef, title: "Change password", description: "Set a new login password without needing the Forgot Password flow. Must be 8-12 characters with an uppercase letter, a number, and a special character.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(pwSectionRef) },
    { key: "signout", ref: signOutRef, title: "Sign out", description: "Signs you out of your account.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(signOutRef) },
  ];

  useEffect(() => {
    loadProfile();
  }, []);

  // Live-syncs market category with the stall doc — the admin can change it
  // from Edit Rental Info and it shows up here (and vice versa) without
  // needing to reopen the page. Skipped while actively editing so an
  // incoming update can't clobber a selection the tenant hasn't saved yet.
  useEffect(() => {
    if (!stallId) return;
    const unsub = onSnapshot(doc(db, "stalls", stallId), (snap) => {
      if (!snap.exists() || isEditingRef.current) return;
      const liveCategory = ((snap.data().category as string) || "") as MarketCategory | "";
      setCategory(liveCategory);
      setOriginal((prev) => ({ ...prev, category: liveCategory }));
    });
    return unsub;
  }, [stallId]);

  // Auto-opens the guided tour the first time the tenant ever lands on this
  // page — never again after that, since it flips a persisted per-device
  // flag. Can still be replayed anytime via the Help button.
  useEffect(() => {
    (async () => {
      const seen = await hasSeenPageTour("tenant-profile");
      if (!seen) {
        setTourVisible(true);
        await markPageTourSeen("tenant-profile");
      }
    })();
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
        setPersonalEmail(data.personalEmail || "");
        setEmailVerified((data as any).emailVerified === true);
        setStallId(data.stallId || "");
        const createdAt = (data as any).createdAt;
        if (createdAt?.toDate) {
          setMemberSince(
            createdAt.toDate().toLocaleDateString("en-US", { month: "long", year: "numeric" }),
          );
        }

        // Category itself is populated by the live listener below (it
        // lives on the stall doc, not the tenant doc) — this just seeds a
        // blank default until that listener's first snapshot arrives.
        setOriginal({
          firstName: data.firstName || "",
          lastName: data.lastName || "",
          contact: data.contactNo || "",
          personalEmail: data.personalEmail || "",
          category: "",
        });
      }
    } catch (error) {
      console.log("Profile Load Error:", error);
    }
  }

  async function handleResendVerification() {
    const user = auth.currentUser;
    if (!user) return;
    setResendingVerification(true);
    try {
      await sendEmailVerification(user);
      Alert.alert("Verification email sent", "Check your inbox and tap the link to confirm your email.");
    } catch {
      Alert.alert("Error", "Couldn't send the verification email. Please try again later.");
    } finally {
      setResendingVerification(false);
    }
  }

  async function handleChangePassword() {
    const pwRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]).{8,12}$/;
    let valid = true;

    if (!pwRegex.test(newPassword)) {
      setPwError("8–12 characters with at least 1 uppercase letter, number & special character.");
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
      Alert.alert("Success", "Password updated!");
    } catch (err: any) {
      if (err?.code === "auth/requires-recent-login") {
        Alert.alert("Session Expired", "Please log out and log in again before changing your password.");
      } else {
        Alert.alert("Error", "Failed to change password.");
      }
    } finally {
      setChangingPw(false);
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
          duration: 450,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(toastTranslateY, {
          toValue: 0,
          duration: 450,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(1000),
      Animated.parallel([
        Animated.timing(toastOpacity, {
          toValue: 0,
          duration: 450,
          easing: Easing.in(Easing.back(1.5)),
          useNativeDriver: true,
        }),
        Animated.timing(toastTranslateY, {
          toValue: -10,
          duration: 450,
          easing: Easing.in(Easing.back(1.5)),
          useNativeDriver: true,
        }),
      ]),
    ]).start(() => setShowToast(false));
  }

  async function handleSignOut() {
    await logoutUser();
    await setRememberMe(false);
    router.replace("/login");
  }

  async function saveProfile() {
    const fn = firstName.trim();
    const ln = lastName.trim();
    const cn = contact.trim();
    const pe = personalEmail.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!fn || !ln || !cn) {
      Alert.alert("Missing Information", "Name and contact no. are required.");
      return;
    }
    if (pe && !emailRegex.test(pe)) {
      Alert.alert("Invalid Email", "Enter a valid email address, or leave it blank.");
      return;
    }

    try {
      const user = auth.currentUser;
      if (!user) return;

      // Sync the email first — if it fails (e.g. already used by another
      // account), nothing else has changed yet.
      if (pe && pe !== original.personalEmail) {
        try {
          await syncPersonalEmail(pe);
        } catch (error) {
          console.log("Email Sync Error:", error);
          Alert.alert("Error", "Couldn't save that email — it may already be in use.");
          return;
        }
      }

      await updateTenantProfile(user.uid, { firstName: fn, lastName: ln, contactNo: cn });

      if (category !== original.category && stallId) {
        await updateDoc(doc(db, "stalls", stallId), { category });
      }

      setFirstName(fn);
      setLastName(ln);
      setContact(cn);
      setOriginal({ firstName: fn, lastName: ln, contact: cn, personalEmail: pe, category });
      setIsEditing(false);
      triggerToast();
    } catch (error) {
      console.log("Save Error:", error);
      Alert.alert("Error", "Cannot update profile");
    }
  }

  return (
    <View style={styles.root}>
      {/* Header */}
      <LinearGradient
        colors={[colors.emerald, colors.ink]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={[styles.header, { paddingTop: insets.top + 28 }]}>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle}>Manage Profile</Text>
          <View ref={helpRef} collapsable={false}>
            <Pressable onPress={() => setTourVisible(true)} hitSlop={8} style={styles.helpBtn}>
              <HelpCircle size={22} color={colors.white} />
            </Pressable>
          </View>
        </View>
      </LinearGradient>

      {/* Body */}
      <ScrollView
        ref={scrollRef}
        style={styles.body}
        contentContainerStyle={[styles.bodyContent, { paddingBottom: insets.bottom + 20 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Identity card */}
        <View style={styles.identityCard} ref={identityRef} collapsable={false}>
          <View style={styles.avatarWrap}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {`${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase() || "?"}
              </Text>
            </View>
            <View style={styles.avatarBadge}>
              <ShieldCheck size={12} color={colors.emerald} />
            </View>
          </View>

          <View style={styles.spaceIdChip}>
            <Store size={14} color={colors.emerald} style={{ marginRight: 6 }} />
            <Text style={styles.spaceIdText}>Space ID: {stallId || "—"}</Text>
          </View>

          <Text style={styles.identitySubtitle}>
            Tenant{memberSince ? ` · Member since ${memberSince}` : ""}
          </Text>
        </View>

        {/* Market category card */}
        <View style={styles.categoryCard} ref={categoryRef} collapsable={false}>
          <View style={styles.labelRow}>
            <Tag size={13} color={colors.emerald} />
            <Text style={styles.label}>Market category</Text>
          </View>
          <View style={[styles.categoryRow, !isEditing && styles.categoryRowReadOnly]}>
            {MARKET_CATEGORIES.map((c) => (
              <Pressable
                key={c}
                style={[styles.categoryTab, category === c && styles.categoryTabActive]}
                onPress={() => setCategory(c)}
                disabled={!isEditing}
              >
                <Text style={[styles.categoryTabText, category === c && styles.categoryTabTextActive]}>
                  {c}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Form card */}
        <View style={styles.formCard} ref={formRef} collapsable={false}>
          {/* Last name */}
          <View style={styles.labelRow}>
            <User size={13} color={colors.emerald} />
            <Text style={styles.label}>Last name</Text>
          </View>
          <TextInput
            style={[styles.input, !isEditing && styles.inputReadOnly, isEditing && lastNameFocused && styles.inputFocused]}
            value={lastName}
            onChangeText={setLastName}
            placeholder="Enter last name"
            placeholderTextColor={colors.textMuted}
            editable={isEditing}
            onFocus={() => setLastNameFocused(true)}
            onBlur={() => setLastNameFocused(false)}
          />

          {/* First name */}
          <View style={styles.labelRow}>
            <User size={13} color={colors.emerald} />
            <Text style={styles.label}>First name</Text>
          </View>
          <TextInput
            style={[styles.input, !isEditing && styles.inputReadOnly, isEditing && firstNameFocused && styles.inputFocused]}
            value={firstName}
            onChangeText={setFirstName}
            placeholder="Enter first name"
            placeholderTextColor={colors.textMuted}
            editable={isEditing}
            onFocus={() => setFirstNameFocused(true)}
            onBlur={() => setFirstNameFocused(false)}
          />

          {/* Contact no. */}
          <View style={styles.labelRow}>
            <Phone size={13} color={colors.emerald} />
            <Text style={styles.label}>Contact no.</Text>
          </View>
          <View style={[styles.phoneRow, !isEditing && styles.phoneRowReadOnly, isEditing && contactFocused && styles.phoneRowFocused]}>
            <View style={[styles.phonePrefix, !isEditing && styles.phonePrefixReadOnly]}>
              <Text style={styles.phonePrefixText}>+63</Text>
            </View>
            <TextInput
              style={[styles.phoneInput, !isEditing && { color: colors.textSecondary }]}
              value={contact}
              onChangeText={(val) => setContact(val.replace(/[^0-9]/g, ""))}
              placeholder="9XXXXXXXXX"
              placeholderTextColor={colors.textMuted}
              keyboardType="phone-pad"
              maxLength={10}
              editable={isEditing}
              onFocus={() => setContactFocused(true)}
              onBlur={() => setContactFocused(false)}
            />
          </View>

          {/* Personal email — optional, enables self-service password reset.
              Once set, it's shown read-only (changing an email in place isn't
              supported yet — that's a bigger operation than adding one).
              Wrapped in its own ref so the "Your details" tour step's
              spotlight can end here instead of at formRef's full height,
              which also spans the Save/Edit button below. */}
          <View ref={emailSectionRef} collapsable={false}>
            <View style={styles.labelRow}>
              <Mail size={13} color={colors.emerald} />
              <Text style={styles.label}>Email</Text>
            </View>
            {!original.personalEmail && (
              <Text style={styles.emailHint}>
                Add this so you can reset your own password later, without needing the admin.
              </Text>
            )}
            <TextInput
              style={[
                styles.input,
                (!isEditing || !!original.personalEmail) && styles.inputReadOnly,
                isEditing && !original.personalEmail && emailFocused && styles.inputFocused,
              ]}
              value={personalEmail}
              onChangeText={setPersonalEmail}
              placeholder="example@gmail.com"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
              editable={isEditing && !original.personalEmail}
              onFocus={() => setEmailFocused(true)}
              onBlur={() => setEmailFocused(false)}
            />

            {!!original.personalEmail && (
              <View style={styles.verifyRow}>
                {emailVerified ? (
                  <View style={styles.verifyBadgeSuccess}>
                    <CheckCircle2 size={13} color={colors.emerald} />
                    <Text style={styles.verifyBadgeSuccessText}>Email verified</Text>
                  </View>
                ) : (
                  <>
                    <View style={styles.verifyBadgeWarning}>
                      <Text style={styles.verifyBadgeWarningText}>Email not verified yet</Text>
                    </View>
                    <Pressable onPress={handleResendVerification} disabled={resendingVerification} hitSlop={8}>
                      <Text style={styles.resendLink}>
                        {resendingVerification ? "Sending..." : "Resend verification email"}
                      </Text>
                    </Pressable>
                  </>
                )}
              </View>
            )}
          </View>

          {/* Edit / Save button */}
          {(() => {
            const hasChanges =
              firstName !== original.firstName ||
              lastName !== original.lastName ||
              contact !== original.contact ||
              personalEmail.trim() !== original.personalEmail ||
              category !== original.category;
            const hasEmptyField = !firstName.trim() || !lastName.trim() || !contact.trim();
            const disabled = isEditing && (!hasChanges || hasEmptyField);
            return (
              <Pressable
                ref={saveBtnRef}
                style={({ pressed }) => [
                  styles.saveButton,
                  disabled && styles.saveButtonDisabled,
                  pressed && !disabled && { backgroundColor: colors.ink, transform: [{ scale: 0.97 }] },
                ]}
                onPress={isEditing ? saveProfile : () => setIsEditing(true)}
                disabled={disabled}
              >
                {!isEditing && <Pencil size={15} color={colors.white} style={{ marginRight: 8 }} />}
                <Text style={styles.saveText}>{isEditing ? "Save changes" : "Edit Profile"}</Text>
              </Pressable>
            );
          })()}
        </View>

        {/* Change password */}
        <View ref={pwSectionRef} collapsable={false} style={styles.formCard}>
          <Text style={styles.sectionTitle}>Change Password</Text>

          <View style={styles.labelRow}>
            <Text style={styles.label}>New password</Text>
          </View>
          <View style={[styles.pwField, !isEditing && styles.inputReadOnly, !!pwError && styles.pwFieldError]}>
            <TextInput
              style={styles.pwInput}
              value={newPassword}
              onChangeText={(t) => {
                setNewPassword(t);
                setPwError("");
                if (confirmPassword && confirmPassword === t) setConfirmError("");
              }}
              secureTextEntry={!showNewPass}
              placeholder="New password"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              maxLength={12}
              editable={isEditing}
            />
            <Pressable onPress={() => setShowNewPass((v) => !v)} hitSlop={8}>
              {showNewPass ? <Eye size={18} color={colors.emerald} /> : <EyeOff size={18} color={colors.emerald} />}
            </Pressable>
          </View>
          {!!pwError && <Text style={styles.pwFieldErrorText}>{pwError}</Text>}
          <Text style={styles.emailHint}>Min. 8 characters with a capital letter, a number, and a special character.</Text>

          <View style={styles.labelRow}>
            <Text style={styles.label}>Confirm password</Text>
          </View>
          <View style={[styles.pwField, !isEditing && styles.inputReadOnly, !!confirmError && styles.pwFieldError]}>
            <TextInput
              style={styles.pwInput}
              value={confirmPassword}
              onChangeText={(t) => {
                setConfirmPassword(t);
                setConfirmError(t && t !== newPassword ? "Passwords do not match." : "");
              }}
              secureTextEntry={!showConfirmPass}
              placeholder="Confirm new password"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              maxLength={12}
              editable={isEditing}
            />
            <Pressable onPress={() => setShowConfirmPass((v) => !v)} hitSlop={8}>
              {showConfirmPass ? <Eye size={18} color={colors.emerald} /> : <EyeOff size={18} color={colors.emerald} />}
            </Pressable>
          </View>
          {!!confirmError && <Text style={styles.pwFieldErrorText}>{confirmError}</Text>}

          {isEditing && (
            <Pressable
              style={({ pressed }) => [
                styles.saveButton,
                (changingPw || newPassword.length < 8 || confirmPassword.length < 8) && styles.saveButtonDisabled,
                pressed && { backgroundColor: colors.ink, transform: [{ scale: 0.97 }] },
              ]}
              onPress={handleChangePassword}
              disabled={changingPw || newPassword.length < 8 || confirmPassword.length < 8}
            >
              <Text style={styles.saveText}>{changingPw ? "Updating…" : "Update Password"}</Text>
            </Pressable>
          )}
        </View>

        <Pressable
          ref={signOutRef}
          style={({ pressed }) => [
            styles.signOutButton,
            pressed && { backgroundColor: colors.errorSoft },
          ]}
          onPress={handleSignOut}
        >
          <LogOut size={16} color={colors.error} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>

      </ScrollView>

      {showToast && (
        <Animated.View style={[styles.overlay, { opacity: toastOpacity }]}>
          <Animated.View style={[styles.toast, { transform: [{ translateY: toastTranslateY }] }]}>
            <CheckCircle2 size={22} color={colors.emeraldBright} />
            <Text style={styles.toastText}>Profile Updated</Text>
          </Animated.View>
        </Animated.View>
      )}

      <HelpTour
        visible={tourVisible}
        steps={tourSteps}
        onClose={() => {
          setTourVisible(false);
          scrollRef.current?.scrollTo({ y: 0, animated: true });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.parchment,
  },

  // ── Header ──────────────────────────────────────
  headerGradient: {
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: "hidden",
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl + 4,
  },

  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: colors.white,
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
  },

  headerSpacer: {
    width: 40,
  },

  helpBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Body ────────────────────────────────────────
  body: {
    flex: 1,
    backgroundColor: colors.parchment,
  },

  bodyContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    gap: spacing.lg,
  },

  // ── Identity card ─────────────────────────────────
  identityCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    paddingVertical: spacing.xxl,
    alignItems: "center",
    ...shadow.card,
  },

  avatarWrap: {
    marginBottom: spacing.lg,
  },

  avatar: {
    width: 88,
    height: 88,
    borderRadius: radius.xl,
    backgroundColor: colors.emerald,
    alignItems: "center",
    justifyContent: "center",
  },

  avatarText: {
    color: colors.white,
    fontSize: fontSize.xxl,
    fontFamily: fontFamily.extrabold,
  },

  avatarBadge: {
    position: "absolute",
    bottom: -4,
    right: -4,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.emeraldSoft,
    alignItems: "center",
    justifyContent: "center",
  },

  identitySubtitle: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },

  // ── Space ID chip ────────────────────────────────
  spaceIdChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: colors.emeraldSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs + 2,
  },

  spaceIdText: {
    fontSize: fontSize.sm,
    color: colors.emerald,
    fontFamily: fontFamily.semibold,
  },

  // ── Market category card ─────────────────────────
  categoryCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.xl,
    ...shadow.card,
  },

  categoryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm + 2,
    marginTop: 2,
  },

  categoryRowReadOnly: {
    opacity: 0.6,
  },

  categoryTab: {
    flexBasis: "47%",
    flexGrow: 1,
    maxWidth: "47%",
    paddingVertical: spacing.md - 1,
    paddingHorizontal: spacing.sm - 2,
    borderRadius: radius.pill,
    alignItems: "center",
    backgroundColor: colors.mist,
  },

  categoryTabActive: {
    backgroundColor: colors.emerald,
  },

  categoryTabText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
    textAlign: "center",
  },

  categoryTabTextActive: {
    color: colors.white,
    fontFamily: fontFamily.bold,
  },

  // ── Form card ─────────────────────────────────────
  formCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.xl,
    ...shadow.card,
  },

  // ── Change password card ─────────────────────────
  sectionTitle: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginBottom: spacing.lg,
  },

  pwField: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.emeraldSoft,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm - 2,
  },

  pwFieldError: {
    borderColor: colors.error,
  },

  pwInput: {
    flex: 1,
    paddingVertical: spacing.md + 1,
    fontSize: fontSize.base,
    fontFamily: fontFamily.medium,
    color: colors.ink,
  },

  pwFieldErrorText: {
    fontSize: fontSize.xs,
    color: colors.error,
    fontFamily: fontFamily.medium,
    marginBottom: spacing.sm,
    marginTop: -spacing.sm + 2,
  },

  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },

  label: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },

  input: {
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.emeraldSoft,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 1,
    fontSize: fontSize.base,
    fontFamily: fontFamily.medium,
    color: colors.ink,
    marginBottom: spacing.lg,
  },

  inputFocused: {
    borderColor: colors.emeraldBright,
  },

  inputReadOnly: {
    backgroundColor: colors.mist,
    borderColor: colors.mist,
    color: colors.textSecondary,
  },

  emailHint: {
    fontSize: fontSize.xs + 1,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    marginTop: -4,
    marginBottom: spacing.sm,
  },

  verifyRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.xs + 2,
    marginBottom: spacing.sm,
  },
  verifyBadgeSuccess: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.successSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  verifyBadgeSuccessText: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },
  verifyBadgeWarning: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  verifyBadgeWarningText: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.warning,
  },
  resendLink: {
    fontSize: fontSize.xs + 1,
    fontFamily: fontFamily.semibold,
    color: colors.emeraldBright,
    textDecorationLine: "underline",
  },

  // ── Phone row ────────────────────────────────────
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.emeraldSoft,
    marginBottom: spacing.lg,
    overflow: "hidden",
  },

  phoneRowFocused: {
    borderColor: colors.emeraldBright,
  },

  phoneRowReadOnly: {
    backgroundColor: colors.mist,
    borderColor: colors.mist,
  },

  phonePrefixReadOnly: {
    backgroundColor: colors.border,
    borderRightColor: colors.border,
  },

  phonePrefix: {
    backgroundColor: colors.emeraldSoft,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md + 1,
    borderRightWidth: 1,
    borderRightColor: colors.emeraldSoft,
  },

  phonePrefixText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },

  phoneInput: {
    flex: 1,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md + 1,
    fontSize: fontSize.base,
    fontFamily: fontFamily.medium,
    color: colors.ink,
  },

// ── Toast notif ────────────────────────────────────────
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    alignItems: "center",
  },

  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.white,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    ...shadow.raised,
  },

  toastText: {
    color: colors.ink,
    fontSize: fontSize.md,
    fontFamily: fontFamily.semibold,
  },

  // ── Save / Edit button ───────────────────────────
  saveButton: {
    flexDirection: "row",
    borderRadius: radius.pill,
    backgroundColor: colors.emerald,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.md,
    ...shadow.button,
  },

  saveButtonDisabled: {
    opacity: 0.45,
  },

  saveText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    textAlign: "center",
  },

  // ── Sign out ─────────────────────────────────────
  signOutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.errorSoft,
    backgroundColor: colors.errorSoft,
    paddingVertical: 13,
  },

  signOutText: {
    color: colors.error,
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
  },
});
