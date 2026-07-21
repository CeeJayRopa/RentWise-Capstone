import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Animated,
  Easing,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, onSnapshot, updateDoc } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, House, Ruler, CheckCircle2, HelpCircle } from "lucide-react-native";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import { logDetailedUpdate } from "../shared/services/updatesService";
import HelpTour, { HelpStep } from "./components/HelpTour";
import { hasSeenPageTour, markPageTourSeen } from "../shared/services/onboardingTour";
import { Button } from "../shared/components/ui";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../shared/theme";

type Schedule = "daily" | "weekly" | "semi-monthly" | "monthly";
type MarketCategory = "Wet Market" | "Dry Market" | "Home Essential";

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
  const helpRef = useRef<View>(null);
  const stallPillRef = useRef<View>(null);
  const categoryRef = useRef<View>(null);
  const dimensionsRef = useRef<View>(null);
  const rateRef = useRef<View>(null);
  const scheduleRef = useRef<View>(null);
  const modifyBtnRef = useRef<View>(null);

  const tourSteps: HelpStep[] = [
    { key: "stall", ref: stallPillRef, title: "Stall", description: "The stall whose rental info you're editing.", edgeInset: "top" },
    { key: "category", ref: categoryRef, title: "Market category", description: "The kind of goods sold at this stall.", edgeInset: "top" },
    { key: "dimensions", ref: dimensionsRef, title: "Length & width", description: "The stall's physical dimensions, in meters.", edgeInset: "top" },
    { key: "rate", ref: rateRef, title: "Rental rate", description: "The stall's charge per billing period.", edgeInset: "top" },
    { key: "schedule", ref: scheduleRef, title: "Payment schedule", description: "How often rent is due — daily, weekly, semi-monthly, or monthly.", edgeInset: "top" },
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
      setRentalRate(String(data.price ?? ""));
      setPaymentSchedule(
        ((data.paymentSchedule as string) || "monthly") as Schedule,
      );
      const loadedCategory = ((data.category as string) || "") as MarketCategory | "";
      setCategory(loadedCategory);
      originalRef.current = {
        length: String(data.length ?? ""),
        width: String(data.width ?? ""),
        rentalRate: String(data.price ?? ""),
        paymentSchedule: ((data.paymentSchedule as string) || "monthly") as Schedule,
        category: loadedCategory,
      };

      const tenantId = (data.tenantId as string) ?? "";
      if (tenantId) {
        const tenantSnap = await getDoc(doc(db, "users", tenantId));
        if (tenantSnap.exists()) {
          const td = tenantSnap.data();
          setTenantName(`${td.firstName ?? ""} ${td.lastName ?? ""}`.trim());
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

    setSaving(true);
    setSaveError("");
    try {
      await updateDoc(doc(db, "stalls", stallId), {
        length: parseFloat(length),
        width: parseFloat(width),
        price: parseFloat(rentalRate), // field in Firestore is `price`, not `rentalRate`
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
            old: cap(orig.paymentSchedule),
            newV: cap(paymentSchedule),
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
            module: "Building Management",
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
          <TouchableOpacity style={styles.headerIconBtn} onPress={() => setTourVisible(true)} activeOpacity={0.7} hitSlop={8}>
            <HelpCircle size={22} color={colors.white} />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View
          style={[
            styles.scrollContent,
            { flex: 1, paddingBottom: insets.bottom + 32 },
          ]}
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
                <Text style={styles.backLinkText}>← Go Back</Text>
              </TouchableOpacity>
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
                <Text style={styles.fieldLabel}>Market category</Text>
                <View style={[styles.scheduleRow, !isEditing && styles.scheduleRowReadOnly]}>
                  {(["Wet Market", "Dry Market", "Home Essential"] as const).map((c) => (
                    <TouchableOpacity
                      key={c}
                      style={[
                        styles.scheduleTab,
                        category === c && styles.scheduleTabActive,
                      ]}
                      onPress={() => {
                        setCategory(c);
                        if (categoryError) setCategoryError("");
                      }}
                      activeOpacity={0.7}
                      disabled={!isEditing || saving || saved}
                    >
                      <Text
                        style={[
                          styles.scheduleTabText,
                          category === c && styles.scheduleTabTextActive,
                        ]}
                      >
                        {c}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {categoryError ? <Text style={styles.fieldError}>{categoryError}</Text> : null}
              </View>

              {/* LENGTH & WIDTH */}
              <View style={styles.dimensionsRow} ref={dimensionsRef} collapsable={false}>
                <View style={[styles.field, styles.dimensionField]}>
                  <Text style={styles.fieldLabel}>Length (m)</Text>
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
                      onFocus={() => setFocusedField("length")}
                      onBlur={() => setFocusedField(null)}
                      editable={isEditing && !saving && !saved}
                    />
                  </View>
                  {lengthError ? <Text style={styles.fieldError}>{lengthError}</Text> : null}
                </View>

                <View style={[styles.field, styles.dimensionField]}>
                  <Text style={styles.fieldLabel}>Width (m)</Text>
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
                      onFocus={() => setFocusedField("width")}
                      onBlur={() => setFocusedField(null)}
                      editable={isEditing && !saving && !saved}
                    />
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
                    onFocus={() => setFocusedField("rate")}
                    onBlur={() => setFocusedField(null)}
                    editable={isEditing && !saving && !saved}
                  />
                </View>
                {rateError ? <Text style={styles.fieldError}>{rateError}</Text> : null}
              </View>

              {/* PAYMENT SCHEDULE */}
              <View style={[styles.field, { marginTop: 4, marginBottom: 24 }]} ref={scheduleRef} collapsable={false}>
                <Text style={styles.fieldLabel}>Payment schedule</Text>
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
                      <Text
                        style={[
                          styles.scheduleTabText,
                          paymentSchedule === s && styles.scheduleTabTextActive,
                        ]}
                      >
                        {s.charAt(0).toUpperCase() + s.slice(1)}
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
        </View>
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

  dimensionField: {
    flex: 1,
  },

  inputWrapper: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    ...shadow.subtle,
  },

  inputWrapperFocused: {
    borderWidth: 1.5,
    borderColor: colors.emerald,
  },

  inputWrapperReadOnly: {
    opacity: 0.65,
  },

  inputWrapperError: {
    borderWidth: 1.5,
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
    paddingRight: spacing.md,
    fontSize: fontSize.base,
    fontFamily: fontFamily.medium,
    color: colors.ink,
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
    opacity: 0.6,
  },

  scheduleTab: {
    flexBasis: "47%",
    flexGrow: 1,
    paddingVertical: spacing.md - 1,
    paddingHorizontal: spacing.sm - 2,
    borderRadius: radius.pill,
    alignItems: "center",
    backgroundColor: colors.mist,
  },

  scheduleTabActive: {
    backgroundColor: colors.ink,
  },

  scheduleTabText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
    textAlign: "center",
  },

  scheduleTabTextActive: {
    color: colors.white,
    fontFamily: fontFamily.bold,
  },

  modifyBtn: {
    borderRadius: radius.pill,
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
