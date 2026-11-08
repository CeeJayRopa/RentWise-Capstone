import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import {
  collection,
  doc,
  getDoc,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, HelpCircle, ArrowRight, ShieldCheck, LockKeyhole, CheckCircle2, Banknote, Store, UserRound, CalendarDays } from "lucide-react-native";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import { firebaseApp } from "../shared/firebaseConfig";
import HelpTour, { HelpStep } from "./components/HelpTour";
import HelpSupportModal from "./components/HelpSupportModal";
import { hasSeenPageTour, markPageTourSeen } from "../shared/services/onboardingTour";
import { requireOnlineAction } from "../shared/services/networkStatus";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../shared/theme";
const cloudFunctions = getFunctions(firebaseApp);

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
  const days = schedule === "daily" ? 1 : schedule === "weekly" ? 7 : schedule === "semi-monthly" ? 15 : 30;
  return dailyRate * days;
}

function periodUnitLabel(schedule: string, count: number): string {
  const days = schedule === "daily" ? 1 : schedule === "weekly" ? 7 : schedule === "semi-monthly" ? 15 : 30;
  return `${days}-day interval${count === 1 ? "" : "s"}`;
}

function categoryLabel(cat: string): string {
  if (cat === "building") return "Stall Management Update";
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

export default function UpdateConfirmation() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string; source?: string }>();
  const [update, setUpdate] = useState<UpdateDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Only populated for payment-related updates — lets the Amount line
  // explain itself ("5 days x P120") the same way admin's Financials does.
  const [periodCharge, setPeriodCharge] = useState(0);
  const [periodsOwed, setPeriodsOwed] = useState(0);
  const [schedule, setSchedule] = useState("monthly");
  const [tourVisible, setTourVisible] = useState(false);
  const [helpSupportVisible, setHelpSupportVisible] = useState(false);
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
          if (userSnap.exists()) {
            const tenant = userSnap.data();
            // Tenant price is the authoritative combined daily rate for all
            // assigned stalls. Reading only the primary stall understates a
            // multi-stall tenant's payment breakdown.
            const dailyRate = Number(tenant.price ?? 0);
            const sched = String(tenant.paymentSchedule ?? "monthly");
            const charge = computePeriodCharge(dailyRate, sched, new Date());
            setSchedule(sched);
            setPeriodCharge(charge);
            setPeriodsOwed(charge > 0 ? Math.max(1, Math.round(Number(data.paymentAmount) / charge)) : 1);
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
    if (!(await requireOnlineAction("Acknowledging a report"))) return;
    setSaving(true);
    try {
      const acknowledge = httpsCallable(cloudFunctions, "ownerAcknowledgeUpdates");
      await acknowledge({updateIds: [update.id]});
      Alert.alert("Acknowledged", "Update has been acknowledged.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "Failed to acknowledge. Please try again.");
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
        <Pressable onPress={() => router.back()}>
          {({ pressed }) => (
            <Text style={[styles.backLink, pressed && styles.backLinkPressed]}>Go back</Text>
          )}
        </Pressable>
      </View>
    );
  }

  const isAcknowledged =
    update.approvalStatus === "approved" ||
    update.approvalStatus === "acknowledged";
  const isAlreadyDecided = isAcknowledged;

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
    tourSteps.push({ key: "beforeafter", ref: beforeAfterRef, title: "Previous vs. Updated", description: "Compares what the field used to be against the admin's new change, side by side.", edgeInset: "top" });
  }
  if (hasAmount) {
    tourSteps.push({ key: "amount", ref: amountRef, title: "Amount", description: "The payment amount, with a breakdown of how it was calculated (e.g. number of days × the daily rate) so you can see why it's that price.", edgeInset: "top" });
  }
  if (!isAlreadyDecided) {
    tourSteps.push({ key: "approve", ref: approveRef, title: "Acknowledge", description: "Confirms you've reviewed this update. It'll then show as acknowledged and appear in Daily Reports.", edgeInset: "top" });
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
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.headerIconBtn}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={22} color={colors.emeraldSoft} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Update Reports</Text>
          {tourSteps.length > 0 ? (
            <TouchableOpacity onPress={() => setHelpSupportVisible(true)} style={styles.headerIconBtn} activeOpacity={0.7}>
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
        <View style={styles.statusCard}>
          <View style={styles.statusCardHeader}>
            <Text style={styles.sectionEyebrow}>Acknowledgment Status</Text>
            <View
              style={[
                styles.statusChip,
                isAcknowledged ? styles.chipApproved : styles.chipPending,
              ]}
            >
              {isAcknowledged ? <CheckCircle2 size={12} color={colors.emerald} /> : <View style={[styles.chipDot, styles.chipDotPending]} />}
              <Text
                style={[
                  styles.chipText,
                  isAcknowledged ? styles.chipTextApproved : styles.chipTextPending,
                ]}
              >
                {isAcknowledged ? "Acknowledged" : "Pending Review"}
              </Text>
            </View>
          </View>
          <View style={styles.statusDescriptionRow}>
            <ShieldCheck size={14} color={colors.emerald} />
            <Text style={styles.statusDescription}>Administrative update recorded • {isAcknowledged ? "Reviewed by owner" : "Awaiting owner review"}</Text>
          </View>
        </View>

        {hasAmount && (
          <View style={styles.amountCard} ref={amountRef} collapsable={false}>
            <View style={styles.amountDecoration} />
            <Text style={styles.amountLabel}>Amount</Text>
            <Text style={styles.amountValue}>₱{Number(update.paymentAmount).toLocaleString()}</Text>
            {periodsOwed > 1 && (
              <View style={styles.amountBreakdownPill}>
                <Banknote size={12} color={colors.emerald} />
                <Text style={styles.amountBreakdown}>{periodsOwed} {periodUnitLabel(schedule, periodsOwed)} × ₱{periodCharge.toLocaleString()}</Text>
              </View>
            )}
          </View>
        )}

        {hasBeforeAfter && (
          <View style={styles.auditCard} ref={beforeAfterRef} collapsable={false}>
            <View style={styles.auditHeader}>
              <Text style={styles.sectionEyebrow}>Status Transition Audit</Text>
              <View style={styles.ledgerBadge}>
                <LockKeyhole size={11} color={colors.textSecondary} />
                <Text style={styles.ledgerBadgeText}>Ledger Record</Text>
              </View>
            </View>
            <View style={styles.beforeAfterRow}>
              <View style={[styles.beforeAfterCard, styles.beforeCard]}>
                <Text style={styles.beforeAfterLabel}>Previous</Text>
                <Text style={[styles.beforeAfterValue, styles.previousValue]}>● {update.oldValue || "—"}</Text>
              </View>
              <View style={styles.beforeAfterArrowButton}><ArrowRight size={15} color={colors.textSecondary} /></View>
              <View style={[styles.beforeAfterCard, styles.afterCard]}>
                <Text style={[styles.beforeAfterLabel, styles.afterLabel]}>Updated</Text>
                <Text style={[styles.beforeAfterValue, styles.afterValue]}>✓ {update.newValue || "—"}</Text>
              </View>
            </View>
          </View>
        )}

        <View style={styles.detailsCard}>
          <View style={styles.detailsHeader}>
            <Text style={styles.detailsHeaderTitle}>Transaction Details</Text>
            <Text style={styles.detailsHeaderBadge}>Audited Entry</Text>
          </View>
          {details.map((row) => (
            <View key={row.label} style={styles.detailRow}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <View style={[
                styles.detailValueWrap,
                row.label === "Type" && styles.typeValueWrap,
                row.label === "Space" && styles.spaceValueWrap,
                row.label === "Changed By" && styles.adminValueWrap,
              ]}>
                {row.label === "Type" && <Banknote size={12} color={colors.emerald} />}
                {row.label === "Space" && <Store size={12} color={colors.white} />}
                {row.label === "Payment Method" && <Banknote size={12} color={colors.emerald} />}
                {row.label === "Changed By" && <UserRound size={12} color={colors.ink} />}
                {row.label === "Date" && <CalendarDays size={12} color={colors.ink} />}
                <Text style={[styles.rowValue, row.label === "Space" && styles.spaceValueText]}>{row.value}</Text>
              </View>
            </View>
          ))}
        </View>

        {!isAlreadyDecided && (
          <View style={styles.actionRow} ref={approveRef} collapsable={false}>
            <Pressable
              style={({ pressed }) => [
                styles.actionBtn,
                styles.approveBtn,
                saving && styles.btnDisabled,
                pressed && !saving && styles.approveBtnPressed,
              ]}
              onPress={approveOne}
              disabled={saving}
            >
              {({ pressed }) =>
                saving ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <View style={styles.acknowledgeContent}>
                    <CheckCircle2 size={17} color={pressed ? colors.emerald : colors.white} />
                    <Text style={[styles.actionBtnText, pressed && styles.actionBtnTextPressed]}>Acknowledge</Text>
                  </View>
                )
              }
            </Pressable>
            <Text style={styles.actionHint}>Acknowledging confirms review of this administrative transaction update.</Text>
          </View>
        )}

      </ScrollView>
      <HelpTour visible={tourVisible} steps={tourSteps} onClose={() => setTourVisible(false)} />
      <HelpSupportModal visible={helpSupportVisible} steps={tourSteps} onClose={() => setHelpSupportVisible(false)} onReplayTour={() => setTourVisible(true)} />
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

  statusCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  statusCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  sectionEyebrow: {
    fontSize: 10,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
    textTransform: "uppercase",
    letterSpacing: 0.45,
  },
  statusDescriptionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  statusDescription: {
    flex: 1,
    fontSize: fontSize.xs,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    lineHeight: 16,
  },

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
  chipPending: { backgroundColor: colors.warningSoft },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipDotApproved: { backgroundColor: colors.emerald },
  chipDotPending: { backgroundColor: colors.warning },
  chipText: { fontSize: fontSize.xs, fontFamily: fontFamily.bold },
  chipTextApproved: { color: colors.emerald },
  chipTextPending: { color: colors.warning },

  auditCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  auditHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  ledgerBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  ledgerBadgeText: { fontSize: 9, fontFamily: fontFamily.medium, color: colors.textSecondary },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 11,
  },
  rowLabel: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    fontFamily: fontFamily.medium,
    width: 92,
  },
  rowValue: {
    fontSize: fontSize.xs,
    color: colors.ink,
    fontFamily: fontFamily.semibold,
    flexShrink: 1,
    textAlign: "left",
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },

  beforeAfterRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 0,
    gap: spacing.sm,
  },
  beforeAfterCard: {
    flex: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  beforeCard: {
    backgroundColor: colors.errorSoft,
  },
  afterCard: {
    backgroundColor: colors.successSoft,
    borderColor: colors.emeraldSoft,
  },
  beforeAfterArrowButton: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.mist,
    alignItems: "center",
    justifyContent: "center",
  },
  beforeAfterLabel: {
    fontSize: 9,
    fontFamily: fontFamily.bold,
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  afterLabel: { color: colors.emerald },
  beforeAfterValue: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.bold,
    color: colors.textSecondary,
  },
  previousValue: { color: colors.error },
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
    padding: spacing.xl,
    marginBottom: spacing.md,
    alignItems: "center",
    overflow: "hidden",
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
    fontSize: 31,
    fontFamily: fontFamily.extrabold,
    color: colors.ink,
  },
  amountBreakdown: {
    fontSize: fontSize.xs,
    color: colors.ink,
    fontFamily: fontFamily.medium,
  },
  amountBreakdownPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.mist,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    marginTop: spacing.sm,
  },
  amountDecoration: {
    position: "absolute",
    right: -22,
    top: -22,
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "#D9FAEF",
  },

  detailsCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    overflow: "hidden",
    marginBottom: spacing.md,
    ...shadow.card,
  },
  detailsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.mist,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  detailsHeaderTitle: { fontSize: 9, fontFamily: fontFamily.semibold, color: colors.ink },
  detailsHeaderBadge: { fontSize: 8, fontFamily: fontFamily.medium, color: colors.ink, textTransform: "uppercase" },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 34,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  detailValueWrap: {
    maxWidth: "72%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 5,
    marginLeft: "auto",
  },
  typeValueWrap: {
    backgroundColor: colors.mist,
    borderRadius: radius.sm,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  spaceValueWrap: {
    backgroundColor: colors.ink,
    borderRadius: radius.sm,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  adminValueWrap: {
    backgroundColor: colors.mist,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  spaceValueText: {
    color: colors.white,
  },

  actionRow: {
    flexDirection: "column",
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
  approveBtn: { backgroundColor: colors.ink, ...shadow.button },
  approveBtnPressed: { backgroundColor: colors.white },
  actionBtnText: { color: colors.white, fontSize: fontSize.base, fontFamily: fontFamily.semibold },
  actionBtnTextPressed: { color: colors.emerald },
  acknowledgeContent: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  actionHint: {
    fontSize: 9,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 14,
  },

  btnDisabled: { opacity: 0.5 },
  errorText: { fontSize: fontSize.md, color: colors.textSecondary, fontFamily: fontFamily.regular, marginBottom: spacing.md },
  backLink: { fontSize: fontSize.sm, color: colors.emeraldBright, fontFamily: fontFamily.semibold },
  backLinkPressed: { color: colors.ink },
});
