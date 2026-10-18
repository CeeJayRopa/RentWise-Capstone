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
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback, useEffect, useRef, useState } from "react";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { auth } from "../../shared/firebaseConfig";
import { db } from "../../shared/services/firestore";
import { getTenantData, updateTenantProfile } from "../../services/tenantService";
import { logoutUser } from "../../services/authService";
import { setRememberMe } from "../../shared/services/rememberMe";
import { router, useFocusEffect } from "expo-router";
import { Tag, CheckCircle2, LogOut, User, Phone, Pencil, ShieldCheck, HelpCircle, Eye, EyeOff, KeyRound, Info, RotateCcw, Droplet, Archive, Store } from "lucide-react-native";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";
import HelpTour, { HelpStep } from "../components/HelpTour";
import { hasSeenPageTour, markPageTourSeen } from "../../shared/services/onboardingTour";
import { requireOnlineAction } from "../../shared/services/networkStatus";

type MarketCategory = "Wet Market" | "Dry Market" | "Home Essential";
const MARKET_CATEGORIES: MarketCategory[] = ["Wet Market", "Dry Market", "Home Essential"];

export default function Profile() {
  const insets = useSafeAreaInsets();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [contact, setContact] = useState("");
  const [username, setUsername] = useState("");
  const [stallId, setStallId] = useState("");
  const [memberSince, setMemberSince] = useState("");
  const [category, setCategory] = useState<MarketCategory | "">("");
  const [lastNameFocused, setLastNameFocused] = useState(false);
  const [firstNameFocused, setFirstNameFocused] = useState(false);
  const [contactFocused, setContactFocused] = useState(false);
  const [original, setOriginal] = useState({ firstName: "", lastName: "", contact: "", username: "", category: "" as MarketCategory | "" });
  const [isEditing, setIsEditing] = useState(false);
  const [showToast, setShowToast] = useState(false);

  // Fully separate from `isEditing` (the profile-fields toggle) -- this
  // section unlocks independently via its own "Change Password" button.
  const [pwEditing, setPwEditing] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showOldPass, setShowOldPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [oldPwError, setOldPwError] = useState("");
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

  // Tabs keep this screen mounted in the background instead of unmounting
  // it, so leaving either section mid-edit and switching tabs (e.g. to
  // Home) would otherwise leave it stuck in edit mode on return. Resetting
  // on blur (not focus) means it only fires when the tenant actually
  // navigates away, discarding any unsaved edits exactly like pressing
  // Cancel would. Routed through refs (updated every render) rather than a
  // dependency array, so the focus-effect's identity never changes and it
  // can't misfire mid-visit right after a save updates `original`.
  const cancelEditProfileRef = useRef(() => {});
  const cancelPasswordEditRef = useRef(() => {});
  cancelEditProfileRef.current = handleCancelEditProfile;
  cancelPasswordEditRef.current = handleCancelPasswordEdit;
  useFocusEffect(
    useCallback(() => {
      return () => {
        cancelEditProfileRef.current();
        cancelPasswordEditRef.current();
      };
    }, []),
  );

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

  // Tracks whichever section's field was focused most recently, so the
  // keyboardDidShow re-scroll (below) knows what to bring back into view.
  const focusedSectionRef = useRef<React.RefObject<View | null> | null>(null);

  // Locks manual scrolling for as long as a field is focused -- the field
  // being typed into is already brought into view automatically, so a
  // stray manual scroll mid-typing would just fight that and confuse
  // which field is actually focused.
  const [scrollLocked, setScrollLocked] = useState(false);

  // Called from a field's onFocus -- scrolls that field's section up so it
  // isn't hidden behind the keyboard while typing, and locks manual scroll
  // until the keyboard is dismissed.
  function scrollFieldIntoView(sectionRef: React.RefObject<View | null>) {
    focusedSectionRef.current = sectionRef;
    setScrollLocked(true);
    scrollSectionIntoView(sectionRef);
  }

  useEffect(() => {
    // onFocus fires before the keyboard has finished animating in, so a
    // fixed delay can land short if the OS is still resizing the window --
    // scroll again once the keyboard is confirmed fully shown.
    const showSub = Keyboard.addListener("keyboardDidShow", () => {
      if (focusedSectionRef.current) scrollSectionIntoView(focusedSectionRef.current);
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setScrollLocked(false);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const tourSteps: HelpStep[] = [
    { key: "identity", ref: identityRef, title: "Your space", description: "Your space ID and how long you've been a tenant.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(identityRef) },
    { key: "category", ref: categoryRef, title: "Market category", description: "The kind of goods sold at your stall. Tap Edit Profile to change it — updates here sync with the admin's records too.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(categoryRef) },
    { key: "form", ref: formRef, endRef: emailSectionRef, title: "Your details", description: "Your name, contact number, and assigned login username. SMS OTP secures password recovery.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(formRef) },
    { key: "save", ref: saveBtnRef, title: "Edit Profile", description: "Unlocks the fields above so you can update them.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(saveBtnRef) },
    { key: "password", ref: pwSectionRef, title: "Change password", description: "Set a new login password without needing the Forgot Password flow. Must be 8-12 characters with an uppercase letter, a number, and a special character.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(pwSectionRef) },
    { key: "signout", ref: signOutRef, title: "Sign out", description: "Signs you out of your account.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(signOutRef) },
  ];

  useEffect(() => {
    loadProfile();
  }, []);

  // Live-syncs market category AND stallId with the tenant's own doc (the
  // source of truth for their billing terms, category, and current stall) —
  // the admin can change either from Edit Rental Info/a relocation and it
  // shows up here (and vice versa) without needing to reopen the page.
  // stallId in particular used to only ever be set once on mount, so a
  // tenant relocated to a different stall while this screen was already
  // open would keep showing (and, if they edited category, keep WRITING
  // to) their old stall until they fully reloaded the app. Category-sync is
  // skipped while actively editing so an incoming update can't clobber a
  // selection the tenant hasn't saved yet; stallId always stays current
  // regardless, since it's not something the tenant edits themselves here.
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const unsub = onSnapshot(doc(db, "users", uid), (snap) => {
      if (!snap.exists()) return;
      setStallId((snap.data().stallId as string) || "");
      if (isEditingRef.current) return;
      const liveCategory = ((snap.data().category as string) || "") as MarketCategory | "";
      setCategory(liveCategory);
      setOriginal((prev) => ({ ...prev, category: liveCategory }));
    });
    return unsub;
  }, []);

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
        setUsername(data.username || "");
        setStallId(data.stallId || "");
        const createdAt = (data as any).createdAt;
        if (createdAt?.toDate) {
          setMemberSince(
            createdAt.toDate().toLocaleDateString("en-US", { month: "long", year: "numeric" }),
          );
        }

        // Category itself is populated by the live listener below (it
        // lives on the tenant's own doc) — this just seeds a blank default
        // until that listener's first snapshot arrives.
        setOriginal({
          firstName: data.firstName || "",
          lastName: data.lastName || "",
          contact: data.contactNo || "",
          username: data.username || "",
          category: "",
        });
      }
    } catch (error) {
      console.log("Profile Load Error:", error);
    }
  }

  function handleCancelPasswordEdit() {
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setOldPwError("");
    setPwError("");
    setConfirmError("");
    setPwEditing(false);
  }

  // Only one of the two sections can be in edit mode at a time -- opening
  // one closes the other (discarding whatever was unsaved there), same as
  // if Cancel had been pressed on it.
  function handleStartEditProfile() {
    handleCancelPasswordEdit();
    setIsEditing(true);
  }

  function handleStartEditPassword() {
    handleCancelEditProfile();
    setPwEditing(true);
  }

  async function handleChangePassword() {
    if (!(await requireOnlineAction("Changing your password"))) return;
    const pwRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]).{8,12}$/;
    let valid = true;

    if (!oldPassword) {
      setOldPwError("Please enter your current password.");
      valid = false;
    } else {
      setOldPwError("");
    }

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
    if (!user || !user.email) return;
    setChangingPw(true);
    try {
      // Re-authenticating with the OLD password both proves it's correct
      // (wrong-password rejects here, before anything changes) and covers
      // the "requires-recent-login" case updatePassword can otherwise hit
      // on a stale session.
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, oldPassword));
      await updatePassword(user, newPassword);
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPwEditing(false);
      Alert.alert("Success", "Password updated!");
    } catch (err: any) {
      if (err?.code === "auth/wrong-password" || err?.code === "auth/invalid-credential") {
        setOldPwError("Current password is incorrect.");
      } else if (err?.code === "auth/requires-recent-login") {
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

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Confirmation gate before Save changes / Update Password actually run --
  // "profile" or "password" picks which one Continue should trigger, null
  // means the modal is closed.
  const [confirmTarget, setConfirmTarget] = useState<"profile" | "password" | null>(null);

  async function handleSignOut() {
    setLoggingOut(true);
    try {
      await logoutUser();
      await setRememberMe(false);
      router.replace("/login");
    } finally {
      setLoggingOut(false);
      setShowLogoutConfirm(false);
    }
  }

  function handleCancelEditProfile() {
    setFirstName(original.firstName);
    setLastName(original.lastName);
    setContact(original.contact);
    setCategory(original.category);
    setIsEditing(false);
  }

  async function saveProfile() {
    if (!(await requireOnlineAction("Saving your profile"))) return;
    const fn = firstName.trim();
    const ln = lastName.trim();
    const cn = contact.trim();

    if (!fn || !ln || !cn) {
      Alert.alert("Missing Information", "Name and contact no. are required.");
      return;
    }
    if (!/^9\d{9}$/.test(cn)) {
      Alert.alert("Invalid Contact Number", "Enter a valid 10-digit number starting with 9.");
      return;
    }

    try {
      const user = auth.currentUser;
      if (!user) return;

      const profileUpdates: Record<string, any> = { firstName: fn, lastName: ln, contactNo: cn };
      if (category !== original.category) {
        // Tenant's own doc is the source of truth; the stall doc keeps a
        // denormalized copy purely so the guest app's public listing stays
        // accurate for this space.
        profileUpdates.category = category;
      }
      await updateTenantProfile(user.uid, profileUpdates);

      if (category !== original.category && stallId) {
        await updateDoc(doc(db, "stalls", stallId), { category });
      }

      setFirstName(fn);
      setLastName(ln);
      setContact(cn);
      setOriginal({ firstName: fn, lastName: ln, contact: cn, username, category });
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
        colors={[colors.parchment, colors.parchment]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
          <Text style={styles.headerTitle}>Profile</Text>
          <View ref={helpRef} collapsable={false}>
            <Pressable onPress={() => setTourVisible(true)} hitSlop={8} style={styles.helpBtn}>
              <HelpCircle size={20} color={colors.ink} />
            </Pressable>
          </View>
        </View>
      </LinearGradient>

      {/* Body */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
      <ScrollView
        ref={scrollRef}
        style={styles.body}
        contentContainerStyle={[styles.bodyContent, { paddingBottom: insets.bottom + 20 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!scrollLocked}
      >
        {/* Identity card */}
        <View style={styles.identityCard} ref={identityRef} collapsable={false}>
          <View style={styles.identityMainRow}>
            <View style={styles.avatarWrap}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {`${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase() || "?"}
                </Text>
              </View>
              <View style={styles.avatarBadge}>
                <ShieldCheck size={10} color={colors.emerald} />
              </View>
            </View>

            <View style={styles.identityInfo}>
              <Text style={styles.identityName}>{firstName} {lastName}</Text>
              <Text style={styles.identitySubtitle}>
                Tenant{memberSince ? ` · Member since ${memberSince}` : ""}
              </Text>
            </View>

            <View style={styles.spaceIdChip}>
              <Text style={styles.spaceIdText}>Space ID: {stallId || "—"}</Text>
            </View>
          </View>
        </View>

        {/* Market category card */}
        <View style={styles.categoryCard} ref={categoryRef} collapsable={false}>
          <View style={styles.labelRow}>
            <Tag size={13} color={colors.emerald} />
            <Text style={styles.label}>Market category</Text>
          </View>
          <View style={[styles.categoryRow, !isEditing && styles.categoryRowReadOnly]}>
            {MARKET_CATEGORIES.map((c) => {
              const CategoryIcon = c === "Wet Market" ? Droplet : c === "Dry Market" ? Archive : Store;
              const isActive = category === c;
              return (
                <Pressable
                  key={c}
                  style={[styles.categoryTab, isActive && styles.categoryTabActive]}
                  onPress={() => setCategory(c)}
                  disabled={!isEditing}
                >
                  <CategoryIcon size={13} color={isActive ? colors.white : colors.emerald} strokeWidth={2} />
                  <Text
                    numberOfLines={1}
                    style={[styles.categoryTabText, isActive && styles.categoryTabTextActive]}
                  >
                    {c}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Form card */}
        <View style={styles.formCard} ref={formRef} collapsable={false}>
          <Text style={styles.personalInfoTitle}>Personal Information</Text>
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
            onFocus={() => { setFirstNameFocused(true); scrollFieldIntoView(formRef); }}
            onBlur={() => setFirstNameFocused(false)}
          />

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
            onFocus={() => { setLastNameFocused(true); scrollFieldIntoView(formRef); }}
            onBlur={() => setLastNameFocused(false)}
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
              onFocus={() => { setContactFocused(true); scrollFieldIntoView(formRef); }}
              onBlur={() => setContactFocused(false)}
            />
          </View>

          {/* The Firebase email identifier stays internal. The assigned
              username is the only credential identifier shown to tenants. */}
          <View ref={emailSectionRef} collapsable={false}>
            <View style={styles.labelRow}>
              <User size={13} color={colors.emerald} />
              <Text style={styles.label}>Username</Text>
            </View>
            <TextInput
              style={[
                styles.input,
                styles.inputReadOnly,
              ]}
              value={username}
              placeholder="Assigned by RentWise"
              placeholderTextColor={colors.textMuted}
              editable={false}
            />
          </View>

          {/* Edit / Save button */}
          {(() => {
            const hasChanges =
              firstName !== original.firstName ||
              lastName !== original.lastName ||
              contact !== original.contact ||
              category !== original.category;
            const hasEmptyField = !firstName.trim() || !lastName.trim() || !contact.trim();
            const disabled = isEditing && (!hasChanges || hasEmptyField);
            return isEditing ? (
              <View style={styles.pwActionsRow}>
                <Pressable
                  style={({ pressed }) => [
                    styles.pwCancelBtn,
                    pressed && { backgroundColor: colors.error, borderColor: colors.error, transform: [{ scale: 0.97 }] },
                  ]}
                  onPress={handleCancelEditProfile}
                >
                  {({ pressed }) => (
                    <Text style={[styles.pwCancelBtnText, pressed && styles.pwCancelBtnTextPressed]}>Cancel</Text>
                  )}
                </Pressable>
                <Pressable
                  ref={saveBtnRef}
                  style={({ pressed }) => [
                    styles.saveButton,
                    styles.pwUpdateBtn,
                    disabled && styles.saveButtonDisabled,
                    pressed && !disabled && { backgroundColor: colors.white, transform: [{ scale: 0.97 }] },
                  ]}
                  onPress={() => setConfirmTarget("profile")}
                  disabled={disabled}
                >
                  {({ pressed }) => (
                    <Text
                      style={[
                        styles.saveText,
                        styles.pwUpdateBtnText,
                        pressed && !disabled && styles.pwUpdateBtnTextPressed,
                      ]}
                    >
                      Save changes
                    </Text>
                  )}
                </Pressable>
              </View>
            ) : (
              <Pressable
                ref={saveBtnRef}
                style={({ pressed }) => [
                  styles.saveButton,
                  styles.profileEditButton,
                  pressed && { backgroundColor: colors.white, transform: [{ scale: 0.97 }] },
                ]}
                onPress={handleStartEditProfile}
              >
                {({ pressed }) => (
                  <>
                    <Pencil size={13} color={colors.ink} style={{ marginRight: 6 }} />
                    <Text style={styles.profileEditText}>Edit Profile</Text>
                  </>
                )}
              </Pressable>
            );
          })()}
        </View>

        {/* Change password */}
        <View ref={pwSectionRef} collapsable={false} style={styles.formCard}>
          <View style={styles.passwordTitleRow}>
            <RotateCcw size={18} color={colors.emerald} strokeWidth={2.2} />
            <Text style={styles.sectionTitle}>Change Password</Text>
          </View>

          <View style={styles.labelRow}>
            <Text style={styles.label}>Current password</Text>
          </View>
          <View style={[styles.pwField, !pwEditing && styles.inputReadOnly, !!oldPwError && styles.pwFieldError]}>
            <TextInput
              style={styles.pwInput}
              value={oldPassword}
              onChangeText={(t) => {
                setOldPassword(t);
                setOldPwError("");
              }}
              secureTextEntry={!showOldPass}
              placeholder="Current password"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              onFocus={() => scrollFieldIntoView(pwSectionRef)}
              editable={pwEditing}
            />
            <Pressable onPress={() => setShowOldPass((v) => !v)} hitSlop={8}>
              {showOldPass ? <Eye size={18} color={colors.ink} /> : <EyeOff size={18} color={colors.ink} />}
            </Pressable>
          </View>
          {!!oldPwError && <Text style={styles.pwFieldErrorText}>{oldPwError}</Text>}

          <View style={styles.labelRow}>
            <Text style={styles.label}>New password</Text>
          </View>
          <View style={[styles.pwField, !pwEditing && styles.inputReadOnly, !!pwError && styles.pwFieldError]}>
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
              onFocus={() => scrollFieldIntoView(pwSectionRef)}
              editable={pwEditing}
            />
            <Pressable onPress={() => setShowNewPass((v) => !v)} hitSlop={8}>
              {showNewPass ? <Eye size={18} color={colors.ink} /> : <EyeOff size={18} color={colors.ink} />}
            </Pressable>
          </View>
          {!!pwError && <Text style={styles.pwFieldErrorText}>{pwError}</Text>}

          <View style={styles.labelRow}>
            <Text style={styles.label}>Confirm password</Text>
          </View>
          <View style={[styles.pwField, !pwEditing && styles.inputReadOnly, !!confirmError && styles.pwFieldError]}>
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
              onFocus={() => scrollFieldIntoView(pwSectionRef)}
              editable={pwEditing}
            />
            <Pressable onPress={() => setShowConfirmPass((v) => !v)} hitSlop={8}>
              {showConfirmPass ? <Eye size={18} color={colors.ink} /> : <EyeOff size={18} color={colors.ink} />}
            </Pressable>
          </View>
          {!!confirmError && <Text style={styles.pwFieldErrorText}>{confirmError}</Text>}

          <View style={styles.passwordHintBox}>
            <Info size={15} color={colors.emerald} />
            <Text style={styles.emailHint}>Minimum 8 characters with a capital letter, a number, and a special character</Text>
          </View>

          {pwEditing ? (
            <View style={styles.pwActionsRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.pwCancelBtn,
                  pressed && { backgroundColor: colors.error, borderColor: colors.error, transform: [{ scale: 0.97 }] },
                ]}
                onPress={handleCancelPasswordEdit}
                disabled={changingPw}
              >
                {({ pressed }) => (
                  <Text style={[styles.pwCancelBtnText, pressed && styles.pwCancelBtnTextPressed]}>Cancel</Text>
                )}
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.saveButton,
                  styles.pwUpdateBtn,
                  styles.passwordPrimaryButton,
                  (changingPw || !oldPassword || newPassword.length < 8 || confirmPassword.length < 8) &&
                    styles.saveButtonDisabled,
                  pressed && !changingPw && { backgroundColor: colors.white, transform: [{ scale: 0.97 }] },
                ]}
                onPress={() => setConfirmTarget("password")}
                disabled={changingPw || !oldPassword || newPassword.length < 8 || confirmPassword.length < 8}
              >
                {({ pressed }) => (
                  <Text
                    style={[
                      styles.saveText,
                      styles.pwUpdateBtnText,
                      pressed && !changingPw && styles.pwUpdateBtnTextPressed,
                    ]}
                  >
                    {changingPw ? "Updating…" : "Update Password"}
                  </Text>
                )}
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [
                styles.saveButton,
                styles.passwordPrimaryButton,
                pressed && { backgroundColor: colors.white, transform: [{ scale: 0.97 }] },
              ]}
              onPress={handleStartEditPassword}
            >
              {({ pressed }) => (
                <>
                  <KeyRound size={16} color={pressed ? colors.ink : colors.white} style={{ marginRight: 8 }} />
                  <Text style={[styles.saveText, pressed && styles.pwUpdateBtnTextPressed]}>Change Password</Text>
                </>
              )}
            </Pressable>
          )}
        </View>

        <Pressable
          ref={signOutRef}
          style={({ pressed }) => [
            styles.signOutButton,
            pressed && { backgroundColor: colors.error, borderColor: colors.error, transform: [{ scale: 0.97 }] },
          ]}
          onPress={() => setShowLogoutConfirm(true)}
        >
          {({ pressed }) => (
            <>
              <LogOut size={16} color={pressed ? colors.white : colors.error} />
              <Text style={[styles.signOutText, pressed && styles.signOutTextPressed]}>Sign out</Text>
            </>
          )}
        </Pressable>

      </ScrollView>
      </KeyboardAvoidingView>

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

      {/* LOGOUT CONFIRMATION MODAL */}
      <Modal
        visible={showLogoutConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!loggingOut) setShowLogoutConfirm(false); }}
      >
        <View style={styles.alertOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => { if (!loggingOut) setShowLogoutConfirm(false); }}
          />
          <View style={styles.alertCard}>
            <View style={styles.alertBody}>
              <Text style={styles.alertTitle}>Logout</Text>
              <Text style={styles.alertMessage}>Are you sure you want to logout?</Text>
            </View>
            <View style={styles.alertDivider} />
            <View style={styles.alertBtnRow}>
              <Pressable
                style={({ pressed }) => [styles.alertBtn, pressed && styles.alertBtnCancelPressed]}
                onPress={() => setShowLogoutConfirm(false)}
                disabled={loggingOut}
              >
                {({ pressed }) => (
                  <Text style={[styles.alertBtnCancelText, pressed && styles.alertBtnCancelTextPressed]}>
                    Cancel
                  </Text>
                )}
              </Pressable>
              <View style={styles.alertBtnDivider} />
              <Pressable
                style={({ pressed }) => [styles.alertBtn, pressed && styles.alertBtnConfirmPressed]}
                onPress={handleSignOut}
                disabled={loggingOut}
              >
                {({ pressed }) =>
                  loggingOut ? (
                    <ActivityIndicator color={colors.emerald} size="small" />
                  ) : (
                    <Text style={[styles.alertBtnConfirmText, pressed && styles.alertBtnConfirmTextPressed]}>
                      Confirm
                    </Text>
                  )
                }
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* SAVE CHANGES / UPDATE PASSWORD CONFIRMATION MODAL */}
      <Modal
        visible={confirmTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmTarget(null)}
      >
        <View style={styles.alertOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setConfirmTarget(null)} />
          <View style={styles.alertCard}>
            <View style={styles.alertBody}>
              <Text style={styles.alertTitleNeutral}>
                {confirmTarget === "password" ? "Update password?" : "Save changes?"}
              </Text>
              <Text style={styles.alertMessage}>
                {confirmTarget === "password"
                  ? "Are you sure you want to change your password? You'll need to use the new password the next time you log in."
                  : "Are you sure you want to update your profile information?"}
              </Text>
            </View>
            <View style={styles.alertDivider} />
            <View style={styles.alertBtnRow}>
              <Pressable
                style={({ pressed }) => [styles.alertBtn, pressed && styles.alertBtnCancelPressed]}
                onPress={() => setConfirmTarget(null)}
              >
                {({ pressed }) => (
                  <Text style={[styles.alertBtnCancelText, pressed && styles.alertBtnCancelTextPressed]}>
                    Cancel
                  </Text>
                )}
              </Pressable>
              <View style={styles.alertBtnDivider} />
              <Pressable
                style={({ pressed }) => [styles.alertBtn, pressed && styles.alertBtnConfirmPressed]}
                onPress={() => {
                  const target = confirmTarget;
                  setConfirmTarget(null);
                  if (target === "password") handleChangePassword();
                  else if (target === "profile") saveProfile();
                }}
              >
                {({ pressed }) => (
                  <Text style={[styles.alertBtnConfirmText, pressed && styles.alertBtnConfirmTextPressed]}>
                    Continue
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

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
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    justifyContent: "space-between",
    paddingBottom: spacing.sm,
  },

  headerTitle: {
    color: colors.ink,
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
  },

  headerSpacer: {
    width: 40,
  },

  helpBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.mist,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Body ────────────────────────────────────────
  body: {
    flex: 1,
    backgroundColor: colors.parchment,
  },

  bodyContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
  },

  // ── Identity card ─────────────────────────────────
  identityCard: {
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadow.card,
  },

  identityMainRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  avatarWrap: {
    marginRight: spacing.md,
  },

  avatar: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: "#063D31",
    alignItems: "center",
    justifyContent: "center",
  },

  avatarText: {
    color: colors.white,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.extrabold,
  },

  avatarBadge: {
    position: "absolute",
    bottom: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.emeraldSoft,
    borderWidth: 1,
    borderColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },

  identityInfo: {
    flex: 1,
  },

  identityName: {
    color: colors.white,
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
  },

  identitySubtitle: {
    fontSize: 10,
    fontFamily: fontFamily.regular,
    color: colors.emeraldSoft,
    marginTop: 3,
  },

  // ── Space ID chip ────────────────────────────────
  spaceIdChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.emeraldSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },

  spaceIdText: {
    fontSize: 9,
    color: colors.emerald,
    fontFamily: fontFamily.semibold,
  },

  // ── Market category card ─────────────────────────
  categoryCard: {
    paddingHorizontal: 2,
  },

  categoryRow: {
    flexDirection: "row",
    flexWrap: "nowrap",
    justifyContent: "space-between",
    gap: 3,
    marginTop: 2,
    width: "100%",
  },

  categoryRowReadOnly: {
    opacity: 0.6,
  },

  categoryTab: {
    flexDirection: "row",
    width: "32.5%",
    minWidth: 0,
    paddingVertical: 5,
    paddingHorizontal: 3,
    borderRadius: radius.sm,
    justifyContent: "center",
    alignItems: "center",
    gap: 2,
    overflow: "hidden",
    backgroundColor: colors.mist,
  },

  categoryTabActive: {
    backgroundColor: colors.emerald,
  },

  categoryTabText: {
    fontSize: 9,
    flexShrink: 1,
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
    padding: spacing.md,
    ...shadow.card,
  },

  // ── Change password card ─────────────────────────
  sectionTitle: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginBottom: 0,
  },

  passwordTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },

  personalInfoTitle: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginBottom: spacing.lg,
  },

  profileEditButton: {
    position: "absolute",
    top: spacing.md,
    right: spacing.md,
    width: "auto",
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.sm,
    backgroundColor: colors.mist,
  },

  profileEditText: {
    color: colors.ink,
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
  },

  pwField: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.mist,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.mist,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm - 2,
  },

  pwFieldError: {
    borderColor: colors.error,
  },

  pwInput: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    fontSize: fontSize.sm,
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
    fontSize: 9,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.35,
  },

  input: {
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    color: colors.ink,
    marginBottom: spacing.md,
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
    flex: 1,
    fontSize: fontSize.xs,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    marginTop: 0,
    marginBottom: 0,
    lineHeight: 16,
  },

  passwordHintBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: colors.mist,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
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
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
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
    paddingVertical: spacing.sm + 2,
    borderRightWidth: 1,
    borderRightColor: colors.emeraldSoft,
  },

  phonePrefixText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },

  phoneInput: {
    flex: 1,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm + 2,
    fontSize: fontSize.sm,
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

  // ── Change Password: Cancel / Update row ─────────
  pwActionsRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.md,
  },

  pwCancelBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: 10,
    backgroundColor: colors.white,
    ...shadow.card,
  },

  pwCancelBtnText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.bold,
    color: colors.textSecondary,
  },

  pwCancelBtnTextPressed: {
    color: colors.white,
  },

  pwUpdateBtn: {
    flex: 1,
    marginTop: 0,
    paddingVertical: 10,
  },

  pwUpdateBtnText: {
    fontSize: fontSize.sm,
  },

  pwUpdateBtnTextPressed: {
    color: colors.emerald,
  },

  passwordPrimaryButton: {
    backgroundColor: colors.ink,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
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
    borderRadius: radius.sm,
    borderWidth: 0,
    borderColor: colors.errorSoft,
    backgroundColor: colors.errorSoft,
    paddingVertical: spacing.md,
  },

  signOutText: {
    color: colors.error,
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
  },

  signOutTextPressed: {
    color: colors.white,
  },

  // ── Logout confirmation alert ────────────────────────────────────────────

  alertOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xxl,
  },

  alertCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    width: 270,
    overflow: "hidden",
    ...shadow.raised,
  },

  alertBody: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    alignItems: "center",
  },

  alertTitle: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    color: colors.error,
    textAlign: "center",
  },

  alertTitleNeutral: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    textAlign: "center",
  },

  alertMessage: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    color: colors.ink,
    textAlign: "center",
    marginTop: spacing.sm,
    lineHeight: 19,
  },

  alertDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },

  alertBtnRow: {
    flexDirection: "row",
  },

  alertBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },

  alertBtnDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },

  alertBtnCancelPressed: {
    backgroundColor: colors.error,
  },

  alertBtnCancelText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.regular,
    color: colors.textMuted,
  },

  alertBtnCancelTextPressed: {
    color: colors.white,
  },

  alertBtnConfirmPressed: {
    backgroundColor: colors.emerald,
  },

  alertBtnConfirmText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },

  alertBtnConfirmTextPressed: {
    color: colors.white,
  },
});
