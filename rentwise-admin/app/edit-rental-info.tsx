import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  ScrollView,
  Animated,
  Easing,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import { logDetailedUpdate } from "../shared/services/updatesService";

type Schedule = "daily" | "weekly" | "semi-monthly" | "monthly";

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

  // Editable fields (string so TextInput stays controlled)
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [rentalRate, setRentalRate] = useState("");
  const [paymentSchedule, setPaymentSchedule] = useState<Schedule>("monthly");

  const originalRef = useRef<{
    length: string;
    width: string;
    rentalRate: string;
    paymentSchedule: Schedule;
  } | null>(null);

  // Per-field validation errors
  const [lengthError, setLengthError] = useState("");
  const [widthError, setWidthError] = useState("");
  const [rateError, setRateError] = useState("");
  const [scheduleError, setScheduleError] = useState("");

  // Submit state
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  // UI-only: focused field & toast animation
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(20)).current;

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
      originalRef.current = {
        length: String(data.length ?? ""),
        width: String(data.width ?? ""),
        rentalRate: String(data.price ?? ""),
        paymentSchedule: ((data.paymentSchedule as string) || "monthly") as Schedule,
      };
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
        <Text style={styles.headerTitle}>Edit rental info</Text>
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
          showsVerticalScrollIndicator={false}
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
              <View style={styles.stallPill}>
                <Ionicons
                  name="storefront-outline"
                  size={16}
                  color="#0C2D6B"
                  style={{ marginRight: 10 }}
                />
                <Text style={styles.stallPillText}>
                  Building {buildingNumber} {"·"} Space ID: {spaceId}
                </Text>
              </View>

              {/* LENGTH */}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Length (m)</Text>
                <TextInput
                  style={[
                    styles.input,
                    !isEditing && styles.inputReadOnly,
                    focusedField === "length" && styles.inputFocused,
                    lengthError ? styles.inputError : null,
                  ]}
                  keyboardType="numeric"
                  placeholder="e.g. 3"
                  placeholderTextColor="#B4B2A9"
                  value={length}
                  onChangeText={(t) => {
                    setLength(t);
                    if (lengthError) setLengthError("");
                  }}
                  onFocus={() => setFocusedField("length")}
                  onBlur={() => setFocusedField(null)}
                  editable={isEditing && !saving && !saved}
                />
                {lengthError ? <Text style={styles.fieldError}>{lengthError}</Text> : null}
              </View>

              {/* WIDTH */}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Width (m)</Text>
                <TextInput
                  style={[
                    styles.input,
                    !isEditing && styles.inputReadOnly,
                    focusedField === "width" && styles.inputFocused,
                    widthError ? styles.inputError : null,
                  ]}
                  keyboardType="numeric"
                  placeholder="e.g. 2"
                  placeholderTextColor="#B4B2A9"
                  value={width}
                  onChangeText={(t) => {
                    setWidth(t);
                    if (widthError) setWidthError("");
                  }}
                  onFocus={() => setFocusedField("width")}
                  onBlur={() => setFocusedField(null)}
                  editable={isEditing && !saving && !saved}
                />
                {widthError ? <Text style={styles.fieldError}>{widthError}</Text> : null}
              </View>

              {/* RENTAL RATE */}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Rental rate</Text>
                <View
                  style={[
                    styles.currencyRow,
                    !isEditing && styles.currencyRowReadOnly,
                    focusedField === "rate" && styles.currencyRowFocused,
                    rateError ? styles.inputError : null,
                  ]}
                >
                  <View style={styles.currencyPrefix}>
                    <Text style={styles.currencySymbol}>₱</Text>
                  </View>
                  <TextInput
                    style={[styles.currencyInput, !isEditing && styles.inputReadOnly]}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor="#B4B2A9"
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
              <View style={[styles.field, { marginTop: 4, marginBottom: 24 }]}>
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
              <Pressable
                style={({ pressed }) => [
                  styles.saveBtn,
                  (saving || saved) && styles.saveBtnDisabled,
                  pressed && !saving && !saved && styles.saveBtnPressed,
                ]}
                onPress={isEditing ? handleSave : () => setIsEditing(true)}
                disabled={saving || saved}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.saveBtnText}>
                    {isEditing ? "Save changes" : "Modify Rental Info"}
                  </Text>
                )}
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* SUCCESS TOAST */}
      {saved && (
        <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
          <Animated.View style={[styles.toast, { transform: [{ translateY: toastTranslateY }] }]}>
            <Ionicons name="checkmark-circle" size={22} color="#7AAEF0" />
            <Text style={styles.toastText}>Rental Info Updated</Text>
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}

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
    marginBottom: 24,
    flexDirection: "row",
    alignItems: "center",
  },

  stallPillText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#0C2D6B",
  },

  // ── Fields ────────────────────────────────────────────────────────────────────

  field: {
    marginBottom: 16,
  },

  fieldLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: "#1A4DA0",
    marginBottom: 6,
  },

  input: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#B5D4F4",
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 15,
    color: "#0C2D6B",
  },

  inputFocused: {
    borderColor: "#2E6FD9",
  },

  inputReadOnly: {
    backgroundColor: "#EEF2FA",
    color: "#6B87B8",
  },

  inputError: {
    borderColor: "#A32D2D",
  },

  fieldError: {
    fontSize: 12,
    color: "#A32D2D",
    marginTop: 4,
  },

  // ── Rental Rate ───────────────────────────────────────────────────────────────

  currencyRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#B5D4F4",
    overflow: "hidden",
  },

  currencyRowFocused: {
    borderColor: "#2E6FD9",
  },

  currencyRowReadOnly: {
    backgroundColor: "#EEF2FA",
  },

  currencyPrefix: {
    backgroundColor: "#E6F1FB",
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRightWidth: 1,
    borderRightColor: "#B5D4F4",
  },

  currencySymbol: {
    fontSize: 15,
    fontWeight: "500",
    color: "#0C2D6B",
  },

  currencyInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: "#0C2D6B",
  },

  // ── Payment schedule tabs ─────────────────────────────────────────────────────

  scheduleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 2,
  },

  scheduleRowReadOnly: {
    opacity: 0.6,
  },

  scheduleTab: {
    flexBasis: "47%",
    flexGrow: 1,
    paddingVertical: 11,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: "#B5D4F4",
  },

  scheduleTabActive: {
    backgroundColor: "#0C2D6B",
    borderColor: "#0C2D6B",
  },

  scheduleTabText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#888780",
    textAlign: "center",
  },

  scheduleTabTextActive: {
    color: "#fff",
  },

  // ── Save button ───────────────────────────────────────────────────────────────

  saveBtn: {
    width: "100%",
    backgroundColor: "#0C2D6B",
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ scale: 1 }],
  },

  saveBtnPressed: {
    backgroundColor: "#091f4a",
    transform: [{ scale: 0.97 }],
  },

  saveBtnDisabled: {
    backgroundColor: "#B5D4F4",
  },

  saveBtnText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#fff",
    textAlign: "center",
  },

  // ── Save error ────────────────────────────────────────────────────────────────

  saveError: {
    fontSize: 13,
    color: "#A32D2D",
    textAlign: "center",
    marginBottom: 12,
  },

  // ── Success toast ─────────────────────────────────────────────────────────────

  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },

  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  toastText: {
    color: "#B5D4F4",
    fontSize: 18,
    fontWeight: "500",
  },
});
