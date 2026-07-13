import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HelpCircle, ArrowRight } from "lucide-react-native";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import HelpTour, { HelpStep } from "./components/HelpTour";
import { hasSeenPageTour, markPageTourSeen } from "../shared/services/onboardingTour";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../shared/theme";

type UpdateDoc = {
  id: string;
  // Legacy schema
  category?: "building" | "finance" | "archive";
  status?: string;
  change?: string;
  // New schema
  module?: string;
  type?: string;
  fieldChanged?: string;
  targetId?: string;
  tenantId?: string;
  paymentMethod?: string;
  paymentAmount?: number;
  oldValue?: string;
  newValue?: string;
  // Common
  spaceNo?: string;
  buildingNo?: string;
  tenantName?: string;
  adminId?: string;
  adminName?: string;
  changedBy?: string;
  approvalStatus?: string;
  createdAt?: any;
};

// The admin always enters the stall's DAILY rate. Every schedule's period
// charge is derived by multiplying that daily rate by however many days
// fall in the period containing `date`. Mirrors rentwise-admin/app/financials.tsx.
function computePeriodCharge(dailyRate: number, schedule: string, date: Date): number {
  if (schedule === "daily") return dailyRate;
  if (schedule === "weekly") return dailyRate * 7;
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  if (schedule === "semi-monthly") {
    const daysInHalf = date.getDate() <= 15 ? 15 : daysInMonth - 15;
    return dailyRate * daysInHalf;
  }
  return dailyRate * daysInMonth; // monthly
}

function periodUnitLabel(schedule: string, count: number): string {
  const plural = count !== 1;
  if (schedule === "daily") return plural ? "days" : "day";
  if (schedule === "weekly") return plural ? "weeks" : "week";
  if (schedule === "semi-monthly") return plural ? "cutoffs" : "cutoff";
  return plural ? "months" : "month";
}

function categoryLabel(cat: string): string {
  if (cat === "building") return "Building Management Update";
  if (cat === "finance") return "Finance Update";
  return "Account Archive Update";
}

function formatDate(ts: any): string {
  if (!ts) return "—";
  const d: Date = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

async function markLinkedNotifications(
  updateId: string,
  status: "Acknowledged" | "Rejected",
) {
  const snap = await getDocs(
    query(collection(db, "notifications"), where("updateId", "==", updateId)),
  );
  const batch = writeBatch(db);
  snap.docs.forEach((d) =>
    batch.update(doc(db, "notifications", d.id), { status }),
  );
  await batch.commit();
}

export default function UpdateConfirmation() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [update, setUpdate] = useState<UpdateDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Only populated for payment-related updates — lets the Amount line
  // explain itself ("5 days x P120") the same way admin's Financials does.
  const [periodCharge, setPeriodCharge] = useState(0);
  const [periodsOwed, setPeriodsOwed] = useState(0);
  const [schedule, setSchedule] = useState("monthly");
  const [tourVisible, setTourVisible] = useState(false);
  const beforeAfterRef = useRef<View>(null);
  const amountRef = useRef<View>(null);
  const approveRef = useRef<View>(null);

  useEffect(() => {
    if (!id) return;
    fetchUpdate(id);
  }, [id]);

  // Auto-opens the guided tour the first time the owner ever lands on this
  // page — never again after that, since it flips a persisted per-device
  // flag. Can still be replayed anytime via the Help button.
  useEffect(() => {
    if (loading || !update) return;
    (async () => {
      const seen = await hasSeenPageTour("owner-update-confirmation");
      if (!seen) {
        setTourVisible(true);
        await markPageTourSeen("owner-update-confirmation");
      }
    })();
  }, [loading, update]);

  const fetchUpdate = async (docId: string) => {
    try {
      const snap = await getDoc(doc(db, "updates", docId));
      if (!snap.exists()) return;
      const data = { id: snap.id, ...snap.data() } as UpdateDoc;
      setUpdate(data);

      if (data.paymentAmount != null && data.tenantId) {
        try {
          const userSnap = await getDoc(doc(db, "users", data.tenantId));
          const stallId = userSnap.exists() ? (userSnap.data().stallId as string) : null;
          if (stallId) {
            const stallSnap = await getDoc(doc(db, "stalls", stallId));
            if (stallSnap.exists()) {
              const sd = stallSnap.data();
              const dailyRate = Number(sd.price ?? 0);
              const sched = String(sd.paymentSchedule ?? "monthly");
              const charge = computePeriodCharge(dailyRate, sched, new Date());
              setSchedule(sched);
              setPeriodCharge(charge);
              setPeriodsOwed(charge > 0 ? Math.max(1, Math.round(Number(data.paymentAmount) / charge)) : 1);
            }
          }
        } catch {
          // Non-fatal — the Amount just shows without a breakdown.
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const approveOne = async () => {
    if (!update || !auth.currentUser) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "updates", update.id), {
        approvalStatus: "approved",
      });
      await markLinkedNotifications(update.id, "Acknowledged");
      if (update.changedBy) {
        const label =
          update.type ?? update.module ?? categoryLabel(update.category ?? "archive");
        await addDoc(collection(db, "notifications"), {
          userId: update.changedBy,
          message: `Your "${label}" update was acknowledged by the owner.`,
          read: false,
          fromOwner: true,
          createdAt: serverTimestamp(),
        });
      }
      await addDoc(collection(db, "dailyReports"), {
        type: update.module
          ? (update.type ?? update.module ?? "Update")
          : categoryLabel(update.category ?? "archive"),
        updateId: update.id,
        spaceNo: update.spaceNo ?? null,
        tenantName: update.tenantName ?? null,
        approvedBy: "Owner",
        date: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      Alert.alert("Acknowledged", "Update has been acknowledged.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "Failed to approve. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator color={colors.emerald} size="large" />
      </View>
    );
  }

  if (!update) {
    return (
      <View style={styles.fullCenter}>
        <Text style={styles.errorText}>Update not found.</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backLink}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isAlreadyDecided =
    update.approvalStatus === "approved" ||
    update.approvalStatus === "rejected";

  const isNewSchema = !!update.module;
  const updateTitle = isNewSchema
    ? (update.type ?? update.module ?? "Update")
    : categoryLabel(update.category ?? "archive");

  // Build detail rows
  const details: { label: string; value: string }[] = [];
  details.push({ label: "Type", value: updateTitle });

  if (isNewSchema) {
    if (update.tenantName) details.push({ label: "Tenant", value: update.tenantName });
    if (update.spaceNo) details.push({ label: "Space", value: update.spaceNo });
    if (update.buildingNo) details.push({ label: "Building", value: update.buildingNo });
    if (update.paymentMethod) {
      details.push({
        label: "Payment Method",
        value: update.paymentMethod.charAt(0).toUpperCase() + update.paymentMethod.slice(1),
      });
    }
    // Amount / Previous / New Value are rendered as their own before/after
    // section below, not as flat rows — see hasBeforeAfter.
  } else if (update.category === "building") {
    if (update.spaceNo) details.push({ label: "Space", value: update.spaceNo });
    if (update.buildingNo) details.push({ label: "Building", value: update.buildingNo });
    details.push({ label: "Change", value: update.change ?? "—" });
    details.push({ label: "Result", value: update.status ?? "—" });
  } else if (update.category === "finance") {
    if (update.tenantName) details.push({ label: "Tenant", value: update.tenantName });
    if (update.spaceNo) details.push({ label: "Space", value: update.spaceNo });
    details.push({ label: "Change", value: update.change ?? "—" });
    details.push({ label: "Status", value: update.status ?? "—" });
  } else {
    if (update.tenantName) details.push({ label: "Tenant", value: update.tenantName });
    details.push({ label: "Change", value: update.change ?? "—" });
    details.push({ label: "Status", value: update.status ?? "—" });
  }

  details.push({ label: "Changed By", value: update.adminName ?? "Admin" });
  details.push({ label: "Date", value: formatDate(update.createdAt) });

  const hasBeforeAfter = isNewSchema && !!(update.oldValue || update.newValue);
  const hasAmount = isNewSchema && update.paymentAmount != null;

  const tourSteps: HelpStep[] = [];
  if (hasBeforeAfter) {
    tourSteps.push({ key: "beforeafter", ref: beforeAfterRef, title: "Previous vs. Updated", description: "Compares what the field used to be against the admin's new change, side by side.", offsetY: 41 });
  }
  if (hasAmount) {
    tourSteps.push({ key: "amount", ref: amountRef, title: "Amount", description: "The payment amount, with a breakdown of how it was calculated (e.g. number of days × the daily rate) so you can see why it's that price.", offsetY: 41 });
  }
  if (!isAlreadyDecided) {
    tourSteps.push({ key: "approve", ref: approveRef, title: "Acknowledge", description: "Confirms you've reviewed this update. It'll then show as acknowledged and appear in Daily Reports.", offsetY: 41 });
  }

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={[colors.emerald, colors.ink]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
          <View style={styles.backBtn} />
          <Text style={styles.headerTitle}>Update Reports</Text>
          {tourSteps.length > 0 ? (
            <TouchableOpacity onPress={() => setTourVisible(true)} style={styles.headerIconBtn} activeOpacity={0.7}>
              <HelpCircle size={22} color={colors.emeraldSoft} />
            </TouchableOpacity>
          ) : (
            <View style={styles.backBtn} />
          )}
        </View>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32 },
        ]}
      >
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <View>
              <Text style={styles.statusCaption}>Status</Text>
              <Text style={styles.statusHeading}>
                {update.approvalStatus === "approved"
                  ? "Acknowledged"
                  : update.approvalStatus === "rejected"
                    ? "Rejected"
                    : "Pending"}
              </Text>
            </View>
            <View
              style={[
                styles.statusChip,
                update.approvalStatus === "approved"
                  ? styles.chipApproved
                  : update.approvalStatus === "rejected"
                    ? styles.chipRejected
                    : styles.chipPending,
              ]}
            >
              <View
                style={[
                  styles.chipDot,
                  update.approvalStatus === "approved"
                    ? styles.chipDotApproved
                    : update.approvalStatus === "rejected"
                      ? styles.chipDotRejected
                      : styles.chipDotPending,
                ]}
              />
              <Text
                style={[
                  styles.chipText,
                  update.approvalStatus === "approved"
                    ? styles.chipTextApproved
                    : update.approvalStatus === "rejected"
                      ? styles.chipTextRejected
                      : styles.chipTextPending,
                ]}
              >
                {update.approvalStatus === "approved"
                  ? "Confirmed"
                  : update.approvalStatus === "rejected"
                    ? "Declined"
                    : "Pending"}
              </Text>
            </View>
          </View>

          {details.map((row, i) => (
            <View key={row.label}>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>{row.label}</Text>
                <Text style={styles.rowValue}>{row.value}</Text>
              </View>
              {i < details.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>

        {hasBeforeAfter && (
          <View style={styles.beforeAfterRow} ref={beforeAfterRef} collapsable={false}>
            <View style={[styles.beforeAfterCard, styles.beforeCard]}>
              <Text style={styles.beforeAfterLabel}>Previous</Text>
              <Text style={styles.beforeAfterValue}>{update.oldValue || "—"}</Text>
              {!!update.fieldChanged && (
                <Text style={styles.beforeAfterSubtext}>{update.fieldChanged}</Text>
              )}
            </View>
            <View style={styles.beforeAfterArrowButton}>
              <ArrowRight size={16} color={colors.white} />
            </View>
            <View style={[styles.beforeAfterCard, styles.afterCard]}>
              <Text style={[styles.beforeAfterLabel, styles.afterLabel]}>Updated</Text>
              <Text style={[styles.beforeAfterValue, styles.afterValue]}>{update.newValue || "—"}</Text>
              {!!update.fieldChanged && (
                <Text style={[styles.beforeAfterSubtext, styles.afterSubtext]}>{update.fieldChanged}</Text>
              )}
            </View>
          </View>
        )}

        {hasAmount && (
          <View style={styles.amountCard} ref={amountRef} collapsable={false}>
            <Text style={styles.amountLabel}>Amount</Text>
            <Text style={styles.amountValue}>
              ₱{Number(update.paymentAmount).toLocaleString()}
            </Text>
            {periodsOwed > 1 && (
              <Text style={styles.amountBreakdown}>
                {periodsOwed} {periodUnitLabel(schedule, periodsOwed)} × ₱{periodCharge.toLocaleString()}
              </Text>
            )}
          </View>
        )}

        {!isAlreadyDecided && (
          <View style={styles.actionRow} ref={approveRef} collapsable={false}>
            <TouchableOpacity
              style={[
                styles.actionBtn,
                styles.approveBtn,
                saving && styles.btnDisabled,
              ]}
              onPress={approveOne}
              disabled={saving}
              activeOpacity={0.8}
            >
              {saving ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Text style={styles.actionBtnText}>Acknowledge</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {isAlreadyDecided && (
          <TouchableOpacity
            style={styles.backBtnBottom}
            onPress={() => router.back()}
            activeOpacity={0.8}
          >
            <Text style={styles.backBtnBottomText}>Go Back</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
      <HelpTour visible={tourVisible} steps={tourSteps} onClose={() => setTourVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.parchment },
  fullCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.parchment,
  },
  headerGradient: {
    borderBottomLeftRadius: radius.xl + 4,
    borderBottomRightRadius: radius.xl + 4,
    overflow: "hidden",
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md + 2,
    flexDirection: "row",
    alignItems: "center",
  },
  backBtn: { width: 40, alignItems: "center", justifyContent: "center" },
  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: colors.white,
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
  },

  content: { padding: spacing.lg, paddingTop: spacing.xl },

  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.xxl,
    ...shadow.card,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  statusCaption: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.bold,
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  statusHeading: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  chipApproved: { backgroundColor: colors.successSoft },
  chipRejected: { backgroundColor: colors.errorSoft },
  chipPending: { backgroundColor: colors.mist },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipDotApproved: { backgroundColor: colors.emerald },
  chipDotRejected: { backgroundColor: colors.error },
  chipDotPending: { backgroundColor: colors.textSecondary },
  chipText: { fontSize: fontSize.xs, fontFamily: fontFamily.bold },
  chipTextApproved: { color: colors.emerald },
  chipTextRejected: { color: colors.error },
  chipTextPending: { color: colors.textSecondary },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 11,
  },
  rowLabel: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontFamily: fontFamily.medium,
    flex: 1,
  },
  rowValue: {
    fontSize: fontSize.sm,
    color: colors.ink,
    fontFamily: fontFamily.semibold,
    flex: 2,
    textAlign: "right",
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },

  beforeAfterRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.xxl,
    gap: spacing.sm,
  },
  beforeAfterCard: {
    flex: 1,
    borderRadius: radius.lg,
    padding: spacing.md + 2,
    borderWidth: 0.5,
  },
  beforeCard: {
    backgroundColor: colors.mist,
    borderColor: colors.border,
  },
  afterCard: {
    backgroundColor: colors.successSoft,
    borderColor: colors.emeraldSoft,
  },
  beforeAfterArrowButton: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.emerald,
    alignItems: "center",
    justifyContent: "center",
  },
  beforeAfterLabel: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.bold,
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  afterLabel: { color: colors.emerald },
  beforeAfterValue: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    color: colors.textSecondary,
  },
  afterValue: { color: colors.emerald },
  beforeAfterSubtext: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
    marginTop: 4,
  },
  afterSubtext: { color: colors.emerald },

  amountCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.xxl,
    alignItems: "center",
    ...shadow.card,
  },
  amountLabel: {
    fontSize: fontSize.xs + 1,
    fontFamily: fontFamily.semibold,
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  amountValue: {
    fontSize: fontSize.xxl + 2,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },
  amountBreakdown: {
    fontSize: fontSize.sm,
    color: colors.emeraldBright,
    fontFamily: fontFamily.medium,
    marginTop: 6,
  },

  actionRow: {
    flexDirection: "row",
    gap: spacing.sm + 2,
    marginBottom: spacing.sm + 2,
  },
  actionBtn: {
    flex: 1,
    borderRadius: radius.sm,
    paddingVertical: spacing.md + 2,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  approveBtn: { backgroundColor: colors.emerald, ...shadow.button },
  actionBtnText: { color: colors.white, fontSize: fontSize.base, fontFamily: fontFamily.semibold },

  backBtnBottom: {
    backgroundColor: colors.emerald,
    borderRadius: radius.pill,
    paddingVertical: spacing.md + 2,
    alignItems: "center",
  },
  backBtnBottomText: {
    color: colors.white,
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
  },

  btnDisabled: { opacity: 0.5 },
  errorText: { fontSize: fontSize.md, color: colors.textSecondary, fontFamily: fontFamily.regular, marginBottom: spacing.md },
  backLink: { fontSize: fontSize.sm, color: colors.emeraldBright, fontFamily: fontFamily.semibold },
});
