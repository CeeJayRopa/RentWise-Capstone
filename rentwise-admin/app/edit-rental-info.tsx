import { useEffect, useRef, useState } from "react";
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
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import { Colors } from "../shared/constants/color";
import { logDetailedUpdate } from "../shared/services/updatesService";

type Schedule = "daily" | "weekly" | "monthly";

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
        <Text style={styles.headerTitle}>Edit Rental Info</Text>
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
          {/* ── Loading / error states ──────────────────────────────── */}

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
              {/* ── Read-only context ─────────────────────────────────── */}
              <View style={styles.contextBox}>
                <Text style={styles.contextText}>
                  Building {buildingNumber} · Space ID: {spaceId}
                </Text>
              </View>

              {/* ── Length ───────────────────────────────────────────── */}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Length (m)</Text>
                <TextInput
                  style={[
                    styles.input,
                    lengthError ? styles.inputErrorBorder : null,
                  ]}
                  keyboardType="numeric"
                  placeholder="e.g. 3"
                  placeholderTextColor={Colors.textMuted}
                  value={length}
                  onChangeText={(t) => {
                    setLength(t);
                    if (lengthError) setLengthError("");
                  }}
                  editable={!saving && !saved}
                />
                {lengthError ? (
                  <Text style={styles.fieldError}>{lengthError}</Text>
                ) : null}
              </View>

              {/* ── Width ────────────────────────────────────────────── */}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Width (m)</Text>
                <TextInput
                  style={[
                    styles.input,
                    widthError ? styles.inputErrorBorder : null,
                  ]}
                  keyboardType="numeric"
                  placeholder="e.g. 2"
                  placeholderTextColor={Colors.textMuted}
                  value={width}
                  onChangeText={(t) => {
                    setWidth(t);
                    if (widthError) setWidthError("");
                  }}
                  editable={!saving && !saved}
                />
                {widthError ? (
                  <Text style={styles.fieldError}>{widthError}</Text>
                ) : null}
              </View>

              {/* ── Rental Rate ───────────────────────────────────────── */}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Rental Rate</Text>
                <View
                  style={[
                    styles.currencyRow,
                    rateError ? styles.inputErrorBorder : null,
                  ]}
                >
                  <Text style={styles.currencySymbol}>₱</Text>
                  <TextInput
                    style={styles.currencyTextInput}
                    keyboardType="numeric"
                    placeholder="0.00"
                    placeholderTextColor={Colors.textMuted}
                    value={rentalRate}
                    onChangeText={(t) => {
                      setRentalRate(t);
                      if (rateError) setRateError("");
                    }}
                    editable={!saving && !saved}
                  />
                </View>
                {rateError ? (
                  <Text style={styles.fieldError}>{rateError}</Text>
                ) : null}
              </View>

              {/* ── Payment Schedule ──────────────────────────────────── */}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Payment Schedule</Text>
                <View style={styles.scheduleRow}>
                  {(["daily", "weekly", "monthly"] as const).map((s) => (
                    <TouchableOpacity
                      key={s}
                      style={[
                        styles.schedulePill,
                        paymentSchedule === s && styles.schedulePillActive,
                      ]}
                      onPress={() => {
                        setPaymentSchedule(s);
                        if (scheduleError) setScheduleError("");
                      }}
                      activeOpacity={0.7}
                      disabled={saving || saved}
                    >
                      <Text
                        style={[
                          styles.schedulePillText,
                          paymentSchedule === s &&
                            styles.schedulePillTextActive,
                        ]}
                      >
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {scheduleError ? (
                  <Text style={styles.fieldError}>{scheduleError}</Text>
                ) : null}
              </View>

              {/* ── Feedback ──────────────────────────────────────────── */}
              {saveError ? (
                <Text style={styles.saveError}>{saveError}</Text>
              ) : null}

              {saved ? (
                <View style={styles.successBox}>
                  <Text style={styles.successText}>
                    Changes saved successfully.
                  </Text>
                </View>
              ) : null}

              {/* ── Save button ───────────────────────────────────────── */}
              <TouchableOpacity
                style={[
                  styles.saveBtn,
                  (saving || saved) && styles.saveBtnDisabled,
                ]}
                onPress={handleSave}
                activeOpacity={0.8}
                disabled={saving || saved}
              >
                {saving ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.saveBtnText}>Save</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  fullCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.background,
  },

  // Header (mirrors financials.tsx)
  header: {
    backgroundColor: Colors.primary,
    paddingBottom: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navBtn: {
    width: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  navIcon: {
    fontSize: 22,
    color: "#FFFFFF",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // Scroll / layout
  scrollContent: {
    padding: 20,
  },
  centeredBox: {
    paddingVertical: 60,
    alignItems: "center",
  },

  // Load error
  loadErrorText: {
    fontSize: 15,
    color: Colors.error,
    textAlign: "center",
    marginBottom: 16,
  },
  backLink: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  backLinkText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.primary,
  },

  // Context badge
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
  contextText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.textPrimary,
  },

  // Fields
  field: {
    marginBottom: 18,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textSecondary,
    marginBottom: 6,
  },
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
  inputErrorBorder: {
    borderColor: Colors.error,
  },
  fieldError: {
    fontSize: 12,
    color: Colors.error,
    marginTop: 4,
  },

  // Currency row (₱ prefix + TextInput sharing one bordered container)
  currencyRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.inputBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
  },
  currencySymbol: {
    paddingLeft: 14,
    paddingRight: 4,
    fontSize: 15,
    color: Colors.textSecondary,
  },
  currencyTextInput: {
    flex: 1,
    paddingRight: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.textPrimary,
  },

  // Payment schedule segmented control
  scheduleRow: {
    flexDirection: "row",
    gap: 8,
  },
  schedulePill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  schedulePillActive: {
    backgroundColor: Colors.primary,
  },
  schedulePillText: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.primary,
  },
  schedulePillTextActive: {
    color: "#FFFFFF",
  },

  // Feedback
  saveError: {
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
  successText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#2D6A4F",
  },

  // Save button (mirrors index.tsx / financials.tsx primary button)
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    minHeight: 48,
  },
  saveBtnDisabled: {
    backgroundColor: Colors.disabled,
  },
  saveBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF",
  },
});
