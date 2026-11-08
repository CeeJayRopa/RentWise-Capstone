import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  Animated,
  Easing,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, House, Ruler, CheckCircle2, Circle, HelpCircle, Store, Archive, Waves } from "lucide-react-native";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import { logDetailedUpdate } from "../shared/services/updatesService";
import HelpTour, { HelpStep } from "./components/HelpTour";
import HelpSupportModal from "./components/HelpSupportModal";
import { hasSeenPageTour, markPageTourSeen } from "../shared/services/onboardingTour";
import { requireOnlineAction } from "../shared/services/networkStatus";
import { updateStallRentalTermsSafely } from "../shared/services/accountServices";
import { Button } from "../shared/components/ui";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../shared/theme";

type Schedule = "daily" | "weekly" | "semi-monthly" | "monthly";
const SCHEDULE_DAYS: Record<Schedule, number> = {
  daily: 1,
  weekly: 7,
  "semi-monthly": 15,
  monthly: 30,
};
const scheduleDayLabel = (schedule: Schedule) =>
  SCHEDULE_DAYS[schedule] === 1 ? "Daily" : `${SCHEDULE_DAYS[schedule]} days`;
type MarketCategory = "Wet Market" | "Dry Market" | "Home Essential";

// The "Rental Rate" field on this screen is monthly-first (what the admin
// actually enters/sees), but `price` in Firestore has always been -- and
// everywhere else in the codebase still is -- a DAILY rate (tenant billing,
// admin financials, the reminder Cloud Function, the public guest listing,
// etc). This flat 30/15/7-day model converts at exactly the two boundaries
// (load and save) so nothing downstream has to change; it deliberately
// doesn't use the real day-count for the current month the way the actual
// billing math elsewhere does, since it's just a live estimate while typing.
const DAYS_PER_MONTH = 30;
const DAYS_PER_HALF_MONTH = 15;
const DAYS_PER_WEEK = 7;

export default function EditRentalInfo() {
  const insets = useSafeAreaInsets();
  const { stallId } = useLocalSearchParams<{ stallId: string }>();
  const mountedRef = useRef(true);

  // Auth / load
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Read-only context display
  const [spaceId, setSpaceId] = useState("");
  const [buildingNumber, setBuildingNumber] = useState("");
  const [tenantName, setTenantName] = useState("");
  // Billing terms (price/paymentSchedule/category) belong to whoever is
  // CURRENTLY renting this stall, not the stall itself -- empty when
  // vacant, in which case this screen just edits the stall's own listing
  // defaults instead of a specific tenant's terms.
  const [tenantId, setTenantId] = useState("");

  // Editable fields (string so TextInput stays controlled)
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [rentalRate, setRentalRate] = useState("");
  const [paymentSchedule, setPaymentSchedule] = useState<Schedule>("monthly");
  const [category, setCategory] = useState<MarketCategory | "">("");

  const originalRef = useRef<{
    length: string;
    width: string;
    rentalRate: string;
    paymentSchedule: Schedule;
    category: MarketCategory | "";
  } | null>(null);

  // Per-field validation errors
  const [lengthError, setLengthError] = useState("");
  const [widthError, setWidthError] = useState("");
  const [rateError, setRateError] = useState("");
  const [scheduleError, setScheduleError] = useState("");
  const [categoryError, setCategoryError] = useState("");

  // Submit state
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  // UI-only: focused field & toast animation
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(20)).current;

  const isEditingRef = useRef(isEditing);
  useEffect(() => {
    isEditingRef.current = isEditing;
  }, [isEditing]);

  const [tourVisible, setTourVisible] = useState(false);
  const [helpSupportVisible, setHelpSupportVisible] = useState(false);
  const helpRef = useRef<View>(null);
  const stallPillRef = useRef<View>(null);
  const categoryRef = useRef<View>(null);
  const dimensionsRef = useRef<View>(null);
  const rateRef = useRef<View>(null);
  const scheduleRef = useRef<View>(null);
  const modifyBtnRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Scrolls a given section into view -- reused both for the HelpTour (see
  // onBeforeMeasure below) and for keyboard-aware scrolling on field focus,
  // same pattern as the other screens in this app.
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

  // Called from a field's onFocus -- scrolls that field's section up so it
  // isn't hidden behind the keyboard while typing.
  function scrollFieldIntoView(sectionRef: React.RefObject<View | null>) {
    focusedSectionRef.current = sectionRef;
    scrollSectionIntoView(sectionRef);
  }

  useEffect(() => {
    // onFocus fires before the keyboard has finished animating in, so a
    // fixed delay can land short if the OS is still resizing the window --
    // scroll again once the keyboard is confirmed fully shown.
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      if (focusedSectionRef.current) scrollSectionIntoView(focusedSectionRef.current);
    });
    return () => sub.remove();
  }, []);

  const tourSteps: HelpStep[] = [
    { key: "stall", ref: stallPillRef, title: "Stall", description: "The stall whose rental info you're editing.", edgeInset: "top" },
    { key: "category", ref: categoryRef, title: "Market category", description: "The kind of goods sold at this stall.", edgeInset: "top" },
    { key: "dimensions", ref: dimensionsRef, title: "Length & width", description: "The stall's physical dimensions, in meters.", edgeInset: "top" },
    { key: "rate", ref: rateRef, title: "Rental rate", description: "The stall's charge per billing period.", edgeInset: "top" },
    { key: "schedule", ref: scheduleRef, title: "Payment interval", description: "Choose whether rent is due every 1, 7, 15, or 30 days.", edgeInset: "top" },
    { key: "modify", ref: modifyBtnRef, title: "Modify Rental Info", description: "Unlocks the fields above so you can update them, then saves your changes.", edgeInset: "top" },
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
        fetchStall(stallId);
      } else {
        setLoadError("No stall ID provided.");
        setLoading(false);
      }
    });
    return unsubscribe;
  }, [stallId]);

  // Live-syncs market category with the stall doc — the tenant can change
  // it from their own profile and it shows up here (and vice versa)
  // without needing to reopen the page. Skipped while actively editing so
  // an incoming update can't clobber a selection that hasn't been saved yet.
  useEffect(() => {
    if (!stallId) return;
    const unsub = onSnapshot(doc(db, "stalls", stallId), (snap) => {
      if (!snap.exists() || isEditingRef.current) return;
      const liveCategory = ((snap.data().category as string) || "") as MarketCategory | "";
      setCategory(liveCategory);
      if (originalRef.current) originalRef.current.category = liveCategory;
    });
    return unsub;
  }, [stallId]);

  // Auto-opens the guided tour the first time the admin ever lands on this
  // page — never again after that, since it flips a persisted per-device
  // flag. Can still be replayed anytime via the Help button.
  useEffect(() => {
    if (checking) return;
    (async () => {
      const seen = await hasSeenPageTour("edit-rental-info");
      if (!seen) {
        setTourVisible(true);
        await markPageTourSeen("edit-rental-info");
      }
    })();
  }, [checking]);

  // Trigger toast animation when save succeeds
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
    ]).start();
  }, [saved]);

  const fetchStall = async (id: string) => {
    setLoading(true);
    setLoadError("");
    try {
      const stallSnap = await getDoc(doc(db, "stalls", id));
      if (!stallSnap.exists()) {
        setLoadError("Stall not found. It may have been deleted.");
        return;
      }
      const data = stallSnap.data();
      setBuildingNumber((data.buildingNumber as string) ?? "");
      setSpaceId((data.spaceId as string) ?? "");
      setLength(String(data.length ?? ""));
      setWidth(String(data.width ?? ""));
      setRentalRate(String((data.price ?? 0) * DAYS_PER_MONTH));
      setPaymentSchedule(
        ((data.paymentSchedule as string) || "monthly") as Schedule,
      );
      const loadedCategory = ((data.category as string) || "") as MarketCategory | "";
      setCategory(loadedCategory);
      originalRef.current = {
        length: String(data.length ?? ""),
        width: String(data.width ?? ""),
        rentalRate: String((data.price ?? 0) * DAYS_PER_MONTH),
        paymentSchedule: ((data.paymentSchedule as string) || "monthly") as Schedule,
        category: loadedCategory,
      };

      const currentTenantId = (data.tenantId as string) ?? "";
      setTenantId(currentTenantId);
      if (currentTenantId) {
        const tenantSnap = await getDoc(doc(db, "users", currentTenantId));
        if (tenantSnap.exists()) {
          const td = tenantSnap.data();
          setTenantName([td.firstName, td.middleName, td.lastName].filter(Boolean).join(" "));
          // Rental rate is a property of THIS stall. `td.price` is the
          // tenant's combined rate across as many as three stalls and must
          // never be loaded into one stall's editor.
          setRentalRate(String((data.price ?? 0) * DAYS_PER_MONTH));
          setPaymentSchedule(((td.paymentSchedule as string) || (data.paymentSchedule as string) || "monthly") as Schedule);
          const tenantCategory = ((td.category as string) || loadedCategory) as MarketCategory | "";
          setCategory(tenantCategory);
          originalRef.current = {
            ...originalRef.current!,
            rentalRate: String((data.price ?? 0) * DAYS_PER_MONTH),
            paymentSchedule: ((td.paymentSchedule as string) || (data.paymentSchedule as string) || "monthly") as Schedule,
            category: tenantCategory,
          };
        }
      } else {
        setTenantName("");
      }
    } catch (err) {
      console.error("EDIT RENTAL INFO FETCH ERROR:", err);
      setLoadError("Failed to load stall data. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const validate = (): boolean => {
    let valid = true;

    const len = parseFloat(length);
    if (!length.trim() || isNaN(len) || len <= 0) {
      setLengthError("Must be a positive number.");
      valid = false;
    } else {
      setLengthError("");
    }

    const wid = parseFloat(width);
    if (!width.trim() || isNaN(wid) || wid <= 0) {
      setWidthError("Must be a positive number.");
      valid = false;
    } else {
      setWidthError("");
    }

    const rate = parseFloat(rentalRate);
    if (!rentalRate.trim() || isNaN(rate) || rate <= 0) {
      setRateError("Must be a positive number.");
      valid = false;
    } else {
      setRateError("");
    }

    if (!paymentSchedule) {
      setScheduleError("Please select a payment schedule.");
      valid = false;
    } else {
      setScheduleError("");
    }

    if (!category) {
      setCategoryError("Please select a market category.");
      valid = false;
    } else {
      setCategoryError("");
    }

    return valid;
  };

  const handleSave = async () => {
    if (!validate() || !stallId) return;
    if (!(await requireOnlineAction("Saving stall information"))) return;

    setSaving(true);
    setSaveError("");
    try {
      // Dimensions are always the stall's own attribute. price/
      // paymentSchedule/category are also written here as a denormalized
      // display copy (the guest app reads a stall's price/category
      // regardless of who's renting it) -- but when occupied, the TENANT's
      // own doc below is the real source of truth for billing.
      // rentalRate is the MONTHLY figure the admin sees/typed -- convert
      // back to the daily rate `price` has always stored, so every other
      // screen/function reading it keeps working unchanged.
      const dailyPrice = parseFloat(rentalRate) / DAYS_PER_MONTH;

      await updateStallRentalTermsSafely({
        stallId,
        length: parseFloat(length),
        width: parseFloat(width),
        dailyRate: dailyPrice,
        paymentSchedule,
        category,
      });

      const orig = originalRef.current;
      if (orig) {
        const adminId = auth.currentUser?.uid ?? "";
        const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
        const changes: Array<{ field: string; old: string; newV: string }> = [];
        if (parseFloat(length) !== parseFloat(orig.length)) {
          changes.push({ field: "Length", old: `${orig.length} m`, newV: `${length} m` });
        }
        if (parseFloat(width) !== parseFloat(orig.width)) {
          changes.push({ field: "Width", old: `${orig.width} m`, newV: `${width} m` });
        }
        if (parseFloat(rentalRate) !== parseFloat(orig.rentalRate)) {
          changes.push({ field: "Rental Rate", old: `₱${orig.rentalRate}`, newV: `₱${rentalRate}` });
        }
        if (paymentSchedule !== orig.paymentSchedule) {
          changes.push({
            field: "Payment Schedule",
            old: scheduleDayLabel(orig.paymentSchedule),
            newV: scheduleDayLabel(paymentSchedule),
          });
        }
        if (category !== orig.category) {
          changes.push({
            field: "Market Category",
            old: orig.category || "—",
            newV: category || "—",
          });
        }
        for (const c of changes) {
          void logDetailedUpdate({
            module: "Stall Management",
            type: "Rental Information Update",
            targetId: stallId!,
            spaceNo: spaceId,
            buildingNo: buildingNumber,
            fieldChanged: c.field,
            oldValue: c.old,
            newValue: c.newV,
            changedBy: adminId,
            approvalStatus: "pending",
          });
        }
      }

      setSaved(true);
      setIsEditing(false);
      // Brief success display, then return to Building Management
      setTimeout(() => {
        if (mountedRef.current) router.back();
      }, 1200);
    } catch (err) {
      console.error("EDIT RENTAL INFO SAVE ERROR:", err);
      setSaveError("Failed to save changes. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Live per-schedule preview shown inside the Payment Schedule buttons --
  // recomputes on every keystroke since it's derived straight from the
  // (monthly) rentalRate state. Same flat 30/15/7-day model as the
  // load/save conversion above, not the real day-count for the current
  // month (see DAYS_PER_MONTH comment).
  const monthlyRateForPreview = parseFloat(rentalRate) || 0;
  const dailyRateForPreview = monthlyRateForPreview / DAYS_PER_MONTH;
  const scheduleAmounts: Record<Schedule, number> = {
    daily: dailyRateForPreview,
    weekly: dailyRateForPreview * DAYS_PER_WEEK,
    "semi-monthly": dailyRateForPreview * DAYS_PER_HALF_MONTH,
    monthly: monthlyRateForPreview,
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
      {/* HEADER */}
      <LinearGradient
        colors={[colors.emerald, colors.ink]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + 14 }]}
      >
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} hitSlop={8}>
          <ArrowLeft size={22} color={colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit rental info</Text>
        <View ref={helpRef} collapsable={false}>
          <TouchableOpacity style={styles.headerIconBtn} onPress={() => setHelpSupportVisible(true)} activeOpacity={0.7} hitSlop={8}>
            <HelpCircle size={22} color={colors.white} />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 32 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
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
                  <Text style={[styles.backLinkText, pressed && styles.backLinkTextPressed]}>← Go Back</Text>
                )}
              </Pressable>
            </View>
          ) : (
            <>
              {/* STALL ID PILL */}
              <View style={styles.stallPill} ref={stallPillRef} collapsable={false}>
                <House size={16} color={colors.emerald} style={{ marginRight: 10 }} />
                <Text style={styles.stallPillText}>
                  Building {buildingNumber} {"·"} Space ID: {spaceId}
                </Text>
              </View>

              {/* TENANT NAME */}
              <View style={styles.field}>
                <Text style={styles.tenantLabel}>Tenant</Text>
                <Text style={styles.tenantNameText}>{tenantName || "— No tenant assigned —"}</Text>
              </View>

              {/* MARKET CATEGORY */}
              <View style={styles.field} ref={categoryRef} collapsable={false}>
                <Text style={styles.sectionLabel}>MARKET CLASSIFICATION</Text>
                <View style={[styles.categoryGrid, !isEditing && styles.scheduleRowReadOnly]}>
                  {(["Wet Market", "Dry Market", "Home Essential"] as const).map((c) => (
                    <TouchableOpacity
                      key={c}
                      style={[
                        styles.categoryTab,
                        c === "Home Essential" && styles.categoryTabWide,
                        category === c && styles.categoryTabActive,
                      ]}
                      onPress={() => {
                        setCategory(c);
                        if (categoryError) setCategoryError("");
                      }}
                      activeOpacity={0.7}
                      disabled={!isEditing || saving || saved}
                    >
                      {c === "Wet Market" ? <Waves size={14} color={category === c ? colors.white : colors.ink} /> : c === "Dry Market" ? <Archive size={14} color={category === c ? colors.white : colors.ink} /> : <Store size={14} color={category === c ? colors.white : colors.ink} />}
                      <Text
                        style={[
                          styles.categoryTabText,
                          category === c && styles.categoryTabTextActive,
                        ]}
                      >
                        {c}
                      </Text>
                      {category === c ? <CheckCircle2 size={13} color={colors.white} style={styles.categoryCheck} /> : null}
                    </TouchableOpacity>
                  ))}
                </View>
                {categoryError ? <Text style={styles.fieldError}>{categoryError}</Text> : null}
              </View>

              {/* LENGTH & WIDTH */}
              <Text style={styles.sectionLabel}>SPACE MEASUREMENTS</Text>
              <View style={styles.dimensionsRow} ref={dimensionsRef} collapsable={false}>
                <View style={[styles.field, styles.dimensionField]}>
                  <Text style={styles.measureLabel}>LENGTH</Text>
                  <View
                    style={[
                      styles.inputWrapper,
                      !isEditing && styles.inputWrapperReadOnly,
                      focusedField === "length" && styles.inputWrapperFocused,
                      lengthError ? styles.inputWrapperError : null,
                    ]}
                  >
                    <Ruler size={16} color={colors.textSecondary} style={styles.leftIcon} />
                    <TextInput
                      style={[styles.textInput, !isEditing && styles.textInputReadOnly]}
                      keyboardType="numeric"
                      placeholder="e.g. 3"
                      placeholderTextColor={colors.textMuted}
                      value={length}
                      onChangeText={(t) => {
                        setLength(t);
                        if (lengthError) setLengthError("");
                      }}
                      onFocus={() => { setFocusedField("length"); scrollFieldIntoView(dimensionsRef); }}
                      onBlur={() => setFocusedField(null)}
                      editable={isEditing && !saving && !saved}
                    />
                    <Text style={styles.unitBadge}>m</Text>
                  </View>
                  {lengthError ? <Text style={styles.fieldError}>{lengthError}</Text> : null}
                </View>

                <View style={[styles.field, styles.dimensionField]}>
                  <Text style={styles.measureLabel}>WIDTH</Text>
                  <View
                    style={[
                      styles.inputWrapper,
                      !isEditing && styles.inputWrapperReadOnly,
                      focusedField === "width" && styles.inputWrapperFocused,
                      widthError ? styles.inputWrapperError : null,
                    ]}
                  >
                    <Ruler size={16} color={colors.textSecondary} style={styles.leftIcon} />
                    <TextInput
                      style={[styles.textInput, !isEditing && styles.textInputReadOnly]}
                      keyboardType="numeric"
                      placeholder="e.g. 2"
                      placeholderTextColor={colors.textMuted}
                      value={width}
                      onChangeText={(t) => {
                        setWidth(t);
                        if (widthError) setWidthError("");
                      }}
                      onFocus={() => { setFocusedField("width"); scrollFieldIntoView(dimensionsRef); }}
                      onBlur={() => setFocusedField(null)}
                      editable={isEditing && !saving && !saved}
                    />
                    <Text style={styles.unitBadge}>m</Text>
                  </View>
                  {widthError ? <Text style={styles.fieldError}>{widthError}</Text> : null}
                </View>
              </View>

              {/* RENTAL RATE */}
              <View style={styles.field} ref={rateRef} collapsable={false}>
                <Text style={styles.fieldLabel}>Rental rate</Text>
                <View
                  style={[
                    styles.inputWrapper,
                    !isEditing && styles.inputWrapperReadOnly,
                    focusedField === "rate" && styles.inputWrapperFocused,
                    rateError ? styles.inputWrapperError : null,
                  ]}
                >
                  <Text style={[styles.leftIcon, styles.currencySymbol]}>₱</Text>
                  <TextInput
                    style={[styles.textInput, !isEditing && styles.textInputReadOnly]}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={colors.textMuted}
                    value={rentalRate}
                    onChangeText={(t) => {
                      setRentalRate(t);
                      if (rateError) setRateError("");
                    }}
                    onFocus={() => { setFocusedField("rate"); scrollFieldIntoView(rateRef); }}
                    onBlur={() => setFocusedField(null)}
                    editable={isEditing && !saving && !saved}
                  />
                </View>
                {rateError ? <Text style={styles.fieldError}>{rateError}</Text> : null}
              </View>

              {/* PAYMENT SCHEDULE */}
              <View style={[styles.field, { marginTop: 4, marginBottom: 24 }]} ref={scheduleRef} collapsable={false}>
                <Text style={styles.sectionLabel}>PAYMENT SCHEDULE &amp; CADENCE</Text>
                <View style={[styles.scheduleRow, !isEditing && styles.scheduleRowReadOnly]}>
                  {(["daily", "weekly", "semi-monthly", "monthly"] as const).map((s) => (
                    <TouchableOpacity
                      key={s}
                      style={[
                        styles.scheduleTab,
                        paymentSchedule === s && styles.scheduleTabActive,
                      ]}
                      onPress={() => {
                        setPaymentSchedule(s);
                        if (scheduleError) setScheduleError("");
                      }}
                      activeOpacity={0.7}
                      disabled={!isEditing || saving || saved}
                    >
                      <View style={styles.scheduleTabHeader}>
                      <Text
                        style={[
                          styles.scheduleTabText,
                          paymentSchedule === s && styles.scheduleTabTextActive,
                        ]}
                      >
                        {scheduleDayLabel(s)}
                      </Text>
                      {paymentSchedule === s ? <CheckCircle2 size={13} color={colors.emerald} /> : <Circle size={13} color={colors.textMuted} />}
                      </View>
                      <Text
                        style={[
                          styles.scheduleTabAmount,
                          paymentSchedule === s && styles.scheduleTabAmountActive,
                        ]}
                      >
                        ₱{scheduleAmounts[s].toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {scheduleError ? <Text style={styles.fieldError}>{scheduleError}</Text> : null}
              </View>

              {/* SAVE ERROR */}
              {saveError ? <Text style={styles.saveError}>{saveError}</Text> : null}

              {/* EDIT / SAVE BUTTON */}
              <View ref={modifyBtnRef} collapsable={false}>
                <Button
                  label={isEditing ? "Save changes" : "Modify Rental Info"}
                  onPress={isEditing ? handleSave : () => setIsEditing(true)}
                  loading={saving}
                  disabled={saving || saved}
                  style={styles.modifyBtn}
                />
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* SUCCESS TOAST */}
      {saved && (
        <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
          <Animated.View style={[styles.toast, { transform: [{ translateY: toastTranslateY }] }]}>
            <CheckCircle2 size={22} color={colors.emeraldBright} />
            <Text style={styles.toastText}>Rental Info Updated</Text>
          </Animated.View>
        </Animated.View>
      )}

      <HelpTour visible={tourVisible} steps={tourSteps} onClose={() => setTourVisible(false)} />
      <HelpSupportModal visible={helpSupportVisible} steps={tourSteps} onClose={() => setHelpSupportVisible(false)} onReplayTour={() => setTourVisible(true)} />
    </View>
  );
}

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

  // ── Header ────────────────────────────────────────────────────────────────────

  header: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg - 2,
    flexDirection: "row",
    alignItems: "center",
    borderBottomLeftRadius: radius.xl + 4,
    borderBottomRightRadius: radius.xl + 4,
  },

  headerTitle: {
    color: colors.white,
    fontSize: fontSize.lg,
    fontFamily: fontFamily.semibold,
    flex: 1,
    textAlign: "center",
  },

  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
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

  backLink: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  backLinkText: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.emerald },
  backLinkTextPressed: { color: colors.ink },

  // ── Stall ID pill ─────────────────────────────────────────────────────────────

  stallPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.mist,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xxl,
  },

  stallPillText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.medium,
    color: colors.ink,
    flexShrink: 1,
  },

  // ── Fields ────────────────────────────────────────────────────────────────────

  field: {
    marginBottom: spacing.lg,
  },

  fieldLabel: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
    marginBottom: spacing.xs + 2,
  },

  sectionLabel: {
    fontSize: 9,
    fontFamily: fontFamily.medium,
    color: colors.ink,
    marginBottom: 8,
  },

  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  categoryTab: {
    position: "relative",
    flexBasis: "47%",
    flexGrow: 1,
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: "#F0F1EF",
  },
  categoryTabWide: {
    flexBasis: "100%",
  },
  categoryTabActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  categoryTabText: {
    fontSize: 11,
    fontFamily: fontFamily.medium,
    color: colors.ink,
  },
  categoryTabTextActive: {
    color: colors.white,
    fontFamily: fontFamily.semibold,
  },
  categoryCheck: {
    position: "absolute",
    right: 9,
  },

  tenantLabel: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: spacing.xs + 2,
  },

  tenantNameText: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  dimensionsRow: {
    flexDirection: "row",
    gap: spacing.md,
  },

  measureLabel: {
    fontSize: 8,
    fontFamily: fontFamily.medium,
    color: colors.ink,
    marginBottom: 4,
  },

  dimensionField: {
    flex: 1,
  },

  inputWrapper: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#F0F1EF",
  },

  inputWrapperFocused: {
    borderColor: colors.emerald,
  },

  inputWrapperReadOnly: {
    opacity: 1,
  },

  inputWrapperError: {
    borderColor: colors.error,
  },

  leftIcon: {
    position: "absolute",
    left: spacing.md + 1,
    zIndex: 1,
  },

  textInput: {
    flex: 1,
    paddingVertical: 13,
    paddingLeft: 40,
    paddingRight: 32,
    fontSize: 13,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
  },

  unitBadge: {
    position: "absolute",
    right: 8,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
    backgroundColor: colors.mist,
    fontSize: 8,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
  },

  textInputReadOnly: {
    color: colors.textMuted,
  },

  fieldError: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.medium,
    color: colors.error,
    marginTop: spacing.xs,
  },

  // ── Rental Rate ───────────────────────────────────────────────────────────────

  currencySymbol: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    color: colors.textSecondary,
  },

  // ── Payment schedule / category tabs ──────────────────────────────────────────

  scheduleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm + 2,
    marginTop: 2,
  },

  scheduleRowReadOnly: {
    opacity: 1,
  },

  scheduleTab: {
    flexBasis: "47%",
    flexGrow: 1,
    minHeight: 80,
    paddingVertical: 12,
    paddingHorizontal: 11,
    borderRadius: 9,
    alignItems: "flex-start",
    justifyContent: "space-between",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: "#F0F1EF",
  },

  scheduleTabActive: {
    backgroundColor: "#DDF8EE",
    borderColor: "#DDF8EE",
  },

  scheduleTabHeader: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  scheduleTabText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
    textAlign: "left",
  },

  scheduleTabTextActive: {
    color: colors.ink,
    fontFamily: fontFamily.bold,
  },

  scheduleTabAmount: {
    fontSize: 15,
    fontFamily: fontFamily.semibold,
    color: colors.textMuted,
    textAlign: "left",
    marginTop: 6,
  },

  scheduleTabAmountActive: {
    color: colors.ink,
  },

  modifyBtn: {
    minHeight: 40,
    borderRadius: 8,
    backgroundColor: colors.ink,
  },

  // ── Save error ────────────────────────────────────────────────────────────────

  saveError: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    color: colors.error,
    textAlign: "center",
    marginBottom: spacing.md,
  },

  // ── Success toast ─────────────────────────────────────────────────────────────

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
    borderRadius: radius.lg,
    ...shadow.raised,
  },

  toastText: {
    color: colors.ink,
    fontSize: fontSize.md,
    fontFamily: fontFamily.semibold,
  },
});
