import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  ScrollView,
  StatusBar,
  Animated,
  Easing,
  RefreshControl,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import BellIcon from "../components/BellIcon";

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { updatePassword } from "firebase/auth";

import { db } from "../../shared/services/firestore";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback, useEffect, useRef, useState } from "react";

import { auth } from "../../shared/firebaseConfig";
import { getTenantData } from "../../services/tenantService";
import { MONTHS, chargedSinceMonthStart, computePeriodCharge, nextPeriodStart } from "../../services/billingSchedule";

import { setRememberMe } from "../../shared/services/rememberMe";
import { hasSeenTenantDashboardTour, markTenantDashboardTourSeen } from "../../shared/services/onboardingTour";

import { router, useFocusEffect } from "expo-router";
import {
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  CalendarClock,
  Wallet,
  HelpCircle,
} from "lucide-react-native";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";
import HelpTour, { HelpStep } from "../components/HelpTour";
import { bottomNavRefs } from "../components/bottomNavRefs";

export default function Dashboard() {
  const insets = useSafeAreaInsets();

  const topInset =
    insets.top > 0 ? insets.top : (StatusBar.currentHeight ?? 24);

  const [tenant, setTenant] = useState<any>(null);
  const [stall, setStall] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const [showToast, setShowToast] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;

  const [tourVisible, setTourVisible] = useState(false);
  const bellRef = useRef<View>(null);
  const helpRef = useRef<View>(null);
  const paymentCardRef = useRef<View>(null);
  const scheduleRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Scrolls a given section into view and gives the ScrollView time to
  // settle before HelpTour measures it — otherwise a section below the
  // fold (e.g. the schedule list once the bill card pushes it down) would
  // measure to its stale, off-screen position, and its spotlight would
  // bleed past the visible screen edge into the bottom nav bar.
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
    { key: "bell", ref: bellRef, title: "Notifications", description: "Updates from the admin, like payment confirmations and account changes.", offsetY: 41, round: true },
    { key: "help", ref: helpRef, title: "Help", description: "Come back here anytime for a guided tour of this page.", offsetY: 41, round: true },
    { key: "payment", ref: paymentCardRef, title: "Rental payment", description: "Your remaining bill this month, how much you've paid, and what's currently due.", offsetY: 41, onBeforeMeasure: () => scrollSectionIntoView(paymentCardRef) },
    { key: "schedule", ref: scheduleRef, title: "Upcoming schedule", description: "Your next rent installments and when they're due.", offsetY: 41, onBeforeMeasure: () => scrollSectionIntoView(scheduleRef) },
    { key: "navhome", ref: bottomNavRefs.home, title: "Home", description: "Your dashboard — rental payment status and upcoming schedule.", offsetY: 36 },
    { key: "navpayments", ref: bottomNavRefs.payments, title: "Payments", description: "Pay your rent online, and view your payment and receipt history.", offsetY: 36 },
    { key: "navprofile", ref: bottomNavRefs.profile, title: "Profile", description: "View and edit your account details, and sign out.", offsetY: 36 },
  ];

  // Auto-opens the guided tour the very first time this device ever lands
  // on the dashboard (fresh install) — never again after that, since it
  // flips a persisted per-device flag. Tenants can still replay it anytime
  // via the Help button.
  useEffect(() => {
    (async () => {
      const seen = await hasSeenTenantDashboardTour();
      if (!seen) {
        setTourVisible(true);
        await markTenantDashboardTourSeen();
      }
    })();
  }, []);

  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
  const [changePwError, setChangePwError] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  // The stall's rate for whatever schedule is currently selected (daily,
  // weekly, semi-monthly, or monthly) — admin enters this as the direct
  // per-period amount, not a monthly total to be divided down.
  const periodRate = Number(stall?.price || 0);

  useFocusEffect(
    useCallback(() => {
      const user = auth.currentUser;
      if (!user) return;

      loadTenantProfile(user.uid);

      const q = query(
        collection(db, "payments"),
        where("userId", "==", user.uid),
      );

      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const newPayments = snapshot.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }));
          setPayments(newPayments);
          setLoading(false);
        },
        (error) => {
          console.log("PAYMENTS LISTENER ERROR:", error);
          setLoading(false);
        },
      );

      return unsubscribe;
    }, [])
  );

  async function loadTenantProfile(uid: string) {
    try {
      const tenantData = await getTenantData(uid);
      if (!tenantData) return;
      setTenant(tenantData);
      setMustChangePassword(!!tenantData.mustChangePassword);
      if (tenantData.stallId) {
        const stallSnap = await getDoc(doc(db, "stalls", tenantData.stallId));
        if (stallSnap.exists()) {
          setStall({ id: stallSnap.id, ...stallSnap.data() });
        }
      }
    } catch (error) {
      console.log("PROFILE ERROR:", error);
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    const user = auth.currentUser;
    if (user) await loadTenantProfile(user.uid);
    setRefreshing(false);
  }

  function triggerToast(msg: string) {
    setToastMsg(msg);
    toastOpacity.setValue(0);
    setShowToast(true);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 350, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.delay(1800),
      Animated.timing(toastOpacity, { toValue: 0, duration: 350, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(() => setShowToast(false));
  }

  async function handleForcedPasswordChange() {
    const pwRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]).{8,12}$/;
    if (!pwRegex.test(newPassword)) {
      setChangePwError("8–12 characters with letters, numbers, and special characters.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setChangePwError("Passwords do not match.");
      return;
    }
    const user = auth.currentUser;
    if (!user) return;
    setChangingPassword(true);
    setChangePwError("");
    try {
      await updatePassword(user, newPassword);
      await updateDoc(doc(db, "users", user.uid), { mustChangePassword: false });
      setMustChangePassword(false);
      setNewPassword("");
      setConfirmNewPassword("");
      triggerToast("Password updated!");
    } catch (err: any) {
      if (err?.code === "auth/requires-recent-login") {
        setChangePwError("Please log out and log in again, then try changing your password.");
      } else {
        setChangePwError("Failed to update password. Please try again.");
      }
    } finally {
      setChangingPassword(false);
    }
  }

  const successfulPayments = payments.filter((p) => p.status === "approved");

  const paymentSchedule = stall?.paymentSchedule ?? "monthly";
  const today = new Date();

  // "Remaining Bill": the whole calendar month's total rent (daily rate ×
  // days in month, the same "₱167 × 31 = ₱5,177" total regardless of
  // schedule) minus everything actually paid (approved only) so far *this
  // month*. Resets to a fresh balance every new month.
  const year = today.getFullYear();
  const month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthTotalCharge = periodRate * daysInMonth;

  const paidThisMonth = successfulPayments.reduce((sum, p) => {
    const d = p.date?.toDate ? p.date.toDate() : p.date ? new Date(p.date) : null;
    if (!d || d.getFullYear() !== year || d.getMonth() !== month) return sum;
    return sum + Number(p.amount || 0);
  }, 0);

  const remainingBill = monthTotalCharge - paidThisMonth;
  const paidPercent = Math.max(0, Math.min(100, (paidThisMonth / Math.max(monthTotalCharge, 1)) * 100));

  useEffect(() => {
    progressAnim.setValue(0);
    Animated.timing(progressAnim, {
      toValue: paidPercent,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paidPercent]);

  // "Payment": pacing against the schedule's own periods, so it reflects
  // exactly where the tenant stands as of today — negative (credit) if
  // they're ahead, positive if behind. This is intentionally separate from
  // "Remaining Bill" (the month-total left): paying today immediately shows
  // a same-day credit here, which the month-total figure can't show since
  // it's always measured against the full month.
  const chargedToDate = chargedSinceMonthStart(periodRate, paymentSchedule, today);
  const paymentDue = chargedToDate - paidThisMonth;

  // How many whole billing periods the "Payment" figure above actually
  // represents — e.g. missing 2 straight daily dues and paying nothing in
  // between means paymentDue is worth 2 periods, not 1.
  const onePeriodCharge = computePeriodCharge(periodRate, paymentSchedule, today);
  const periodsOwed =
    paymentDue > 0 && onePeriodCharge > 0 ? Math.max(1, Math.round(paymentDue / onePeriodCharge)) : 0;
  const missedDuesText =
    periodsOwed > 0
      ? `Missed ${periodsOwed} ${paymentSchedule} due${periodsOwed !== 1 ? "s" : ""}`
      : "You're all caught up";

  // "Upcoming Schedule" — the next few billing periods after whatever's
  // currently due, so a tenant can see what's coming without it duplicating
  // the "Remaining Bill" figure above.
  const UPCOMING_COUNT = 4;
  const upcomingSchedule: { date: Date; amount: number }[] = [];
  {
    let cursor = nextPeriodStart(paymentSchedule, today);
    for (let i = 0; i < UPCOMING_COUNT; i++) {
      upcomingSchedule.push({
        date: new Date(cursor),
        amount: computePeriodCharge(periodRate, paymentSchedule, cursor),
      });
      cursor = nextPeriodStart(paymentSchedule, cursor);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.emerald} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar
        barStyle="light-content"
        backgroundColor="transparent"
        translucent
      />

      {/* HEADER + PROFILE BANNER */}
      <LinearGradient
        colors={[colors.emerald, colors.ink]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={[styles.header, { paddingTop: topInset + 14 }]}>
          <Image
            source={require("../../assets/RentWise Logo.png")}
            style={styles.headerLogo}
            resizeMode="contain"
          />

          <View style={styles.headerRight}>
            <View ref={bellRef} collapsable={false}>
              <BellIcon />
            </View>
            <View ref={helpRef} collapsable={false}>
              <TouchableOpacity onPress={() => setTourVisible(true)} activeOpacity={0.7} style={styles.helpBtn}>
                <HelpCircle size={24} color={colors.white} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={styles.banner}>
          <View style={styles.bannerInfo}>
            <Text style={styles.bannerWelcome}>Welcome back,</Text>
            <Text style={styles.bannerName}>
              {tenant?.firstName} {tenant?.lastName}
            </Text>
          </View>
        </View>
      </LinearGradient>

      {/* BODY */}
      <ScrollView
        ref={scrollRef}
        style={styles.body}
        contentContainerStyle={[
          styles.bodyContent,
          { paddingBottom: insets.bottom + 20 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />
        }
      >
        {/* CARD 1 — Rental payment information */}
        <View style={styles.card} ref={paymentCardRef} collapsable={false}>
          <View style={styles.paymentCardHeader}>
            <Text style={styles.cardTitle}>Rental Payment</Text>
            <View style={styles.monthBadge}>
              <Text style={styles.monthBadgeText}>{MONTHS[month]} {year}</Text>
            </View>
          </View>

          <View style={styles.billBox}>
            <View style={styles.billHeaderRow}>
              <AlertCircle size={13} color={colors.error} />
              <Text style={styles.billLabel}>Remaining Bill</Text>
            </View>
            <Text style={styles.billAmount}>₱{remainingBill.toLocaleString()}</Text>

            <View style={styles.progressTrack}>
              <Animated.View
                style={[
                  styles.progressFill,
                  {
                    width: progressAnim.interpolate({
                      inputRange: [0, 100],
                      outputRange: ["0%", "100%"],
                      extrapolate: "clamp",
                    }),
                  },
                ]}
              />
            </View>

            <View style={styles.billFooterRow}>
              <Text style={styles.billFooterText}>
                <Text style={styles.billFooterStrong}>₱{paidThisMonth.toLocaleString()}</Text> paid
              </Text>
              <Text style={styles.billFooterText}>of ₱{monthTotalCharge.toLocaleString()}</Text>
            </View>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <View style={styles.statHeaderRow}>
                <TrendingUp size={14} color={colors.emerald} />
                <Text style={styles.statLabel}>Payment</Text>
              </View>
              <Text style={styles.statValue}>
                {paymentDue < 0 ? "-" : ""}₱{Math.abs(paymentDue).toLocaleString()}
              </Text>
              <Text style={styles.statSub}>{missedDuesText}</Text>
            </View>

            <View style={styles.statCard}>
              <View style={styles.statHeaderRow}>
                <CalendarClock size={14} color={colors.emerald} />
                <Text style={styles.statLabel}>Schedule</Text>
              </View>
              <Text style={styles.statValue}>
                {stall?.paymentSchedule
                  ? stall.paymentSchedule.charAt(0).toUpperCase() + stall.paymentSchedule.slice(1)
                  : "—"}
              </Text>
              <Text style={styles.statSub}>₱{periodRate.toLocaleString()} / day</Text>
            </View>
          </View>
        </View>

        {/* Upcoming Schedule */}
        <View ref={scheduleRef} collapsable={false}>
          <Text style={styles.sectionTitle}>Upcoming Schedule</Text>

          {upcomingSchedule.map((item, index) => (
            <View key={index} style={styles.scheduleRow}>
              <View style={styles.scheduleIconCircle}>
                <Wallet size={18} color={colors.emerald} />
              </View>
              <View style={styles.scheduleInfo}>
                <Text style={styles.scheduleTitle}>Rent Installment</Text>
                <Text style={styles.scheduleDate}>
                  {item.date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </Text>
              </View>
              <View style={styles.scheduleRight}>
                <Text style={styles.scheduleAmount}>₱{item.amount.toLocaleString()}.00</Text>
                <View style={styles.scheduledBadge}>
                  <Text style={styles.scheduledBadgeText}>SCHEDULED</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* FORCED PASSWORD CHANGE MODAL */}
      <Modal visible={mustChangePassword} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={styles.payOverlay}>
          <View style={styles.payCard}>
            <Text style={styles.payTitle}>Set a new password</Text>
            <Text style={styles.payHint}>
              Your account is using the default password. Please set a new
              password to continue.
            </Text>

            <Text style={styles.payLabel}>New Password</Text>
            <View style={styles.pwRow}>
              <TextInput
                style={styles.pwRowInput}
                value={newPassword}
                onChangeText={(t) => { setNewPassword(t); setChangePwError(""); }}
                secureTextEntry={!showNewPassword}
                placeholder="New password"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                maxLength={12}
                editable={!changingPassword}
              />
              <TouchableOpacity onPress={() => setShowNewPassword((v) => !v)}>
                {showNewPassword ? (
                  <Eye size={18} color={colors.emeraldBright} />
                ) : (
                  <EyeOff size={18} color={colors.emeraldBright} />
                )}
              </TouchableOpacity>
            </View>

            <Text style={styles.payLabel}>Confirm Password</Text>
            <View style={styles.pwRow}>
              <TextInput
                style={styles.pwRowInput}
                value={confirmNewPassword}
                onChangeText={(t) => { setConfirmNewPassword(t); setChangePwError(""); }}
                secureTextEntry={!showConfirmNewPassword}
                placeholder="Confirm new password"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                maxLength={12}
                editable={!changingPassword}
              />
              <TouchableOpacity onPress={() => setShowConfirmNewPassword((v) => !v)}>
                {showConfirmNewPassword ? (
                  <Eye size={18} color={colors.emeraldBright} />
                ) : (
                  <EyeOff size={18} color={colors.emeraldBright} />
                )}
              </TouchableOpacity>
            </View>

            {changePwError ? (
              <Text style={styles.pwErrorText}>{changePwError}</Text>
            ) : null}

            <TouchableOpacity
              style={[styles.payNowBtn, changingPassword && styles.payNowBtnDisabled]}
              disabled={changingPassword}
              onPress={handleForcedPasswordChange}
            >
              {changingPassword ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.payNowText}>Change Password</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {showToast && (
        <Animated.View style={[styles.toastOverlay, { opacity: toastOpacity }]}>
          <View style={styles.toastBox}>
            <CheckCircle2 size={20} color={colors.emerald} style={{ marginRight: 8 }} />
            <Text style={styles.toastText}>{toastMsg}</Text>
          </View>
        </Animated.View>
      )}

      <HelpTour
        visible={tourVisible}
        steps={tourSteps}
        onClose={() => {
          setTourVisible(false);
          // The tour auto-scrolls down to reach later steps — scroll back
          // to the top once it's done so the tenant isn't left mid-page.
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

  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
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
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md + 2,
  },

  headerLogo: {
    width: 121,
    height: 56,
  },

  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
  },
  helpBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Profile banner ───────────────────────────────
  banner: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg + 2,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md + 2,
  },

  bannerInfo: {
    flex: 1,
  },

  bannerWelcome: {
    color: colors.emeraldSoft,
    fontSize: fontSize.xs + 1,
    fontFamily: fontFamily.regular,
  },

  bannerName: {
    color: colors.white,
    fontSize: fontSize.xl,
    fontFamily: fontFamily.extrabold,
    marginTop: 2,
  },

  // ── Body ────────────────────────────────────────
  body: {
    flex: 1,
    backgroundColor: colors.parchment,
  },

  bodyContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    gap: spacing.lg,
  },

  // ── Cards ────────────────────────────────────────
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg + 2,
    ...shadow.card,
  },

  cardTitle: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginBottom: spacing.md + 2,
  },

  // ── Rental payment card ─────────────────────────
  paymentCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md + 2,
  },

  monthBadge: {
    backgroundColor: colors.emeraldSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },

  monthBadgeText: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },

  billBox: {
    backgroundColor: colors.mist,
    borderRadius: radius.md,
    padding: spacing.lg,
  },

  billHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  billLabel: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },

  billAmount: {
    fontSize: fontSize.display,
    fontFamily: fontFamily.extrabold,
    color: colors.error,
    marginTop: 4,
    marginBottom: spacing.md,
  },

  progressTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    overflow: "hidden",
    marginBottom: spacing.sm,
  },

  progressFill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.emerald,
  },

  billFooterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },

  billFooterText: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
  },

  billFooterStrong: {
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  statsRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.lg,
  },

  statCard: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing.md + 2,
  },

  statHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: spacing.sm,
  },

  statLabel: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
  },

  statValue: {
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginBottom: 2,
  },

  statSub: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.regular,
    color: colors.textMuted,
  },

  // ── Upcoming schedule ────────────────────────────
  sectionTitle: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginBottom: spacing.md,
  },

  scheduleRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.md + 2,
    marginBottom: spacing.md,
    ...shadow.card,
  },

  scheduleIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.emeraldSoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },

  scheduleInfo: {
    flex: 1,
  },

  scheduleTitle: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  scheduleDate: {
    fontSize: fontSize.xs + 1,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    marginTop: 2,
  },

  scheduleRight: {
    alignItems: "flex-end",
  },

  scheduleAmount: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  scheduledBadge: {
    backgroundColor: colors.emeraldSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginTop: 4,
  },

  scheduledBadgeText: {
    fontSize: 9,
    fontFamily: fontFamily.bold,
    color: colors.emerald,
    letterSpacing: 0.3,
  },

  // ── Pay modal ────────────────────────────────────
  payOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    padding: spacing.xxl,
  },

  payCard: {
    backgroundColor: colors.white,
    padding: spacing.xxl,
    borderRadius: radius.lg,
    ...shadow.raised,
  },

  payTitle: {
    textAlign: "center",
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
    marginBottom: spacing.xl,
    color: colors.ink,
  },

  payLabel: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginBottom: 6,
    marginTop: spacing.md - 2,
    fontFamily: fontFamily.semibold,
  },

  payNowBtn: {
    backgroundColor: colors.emerald,
    padding: spacing.md + 2,
    borderRadius: radius.sm,
    marginTop: spacing.md,
    alignItems: "center",
    ...shadow.button,
  },

  payNowBtnDisabled: {
    opacity: 0.5,
  },

  payNowText: {
    color: colors.white,
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.base,
  },

  payHint: {
    fontSize: fontSize.xs + 1,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    lineHeight: 17,
  },

  pwRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: colors.emeraldSoft,
    borderRadius: radius.sm,
    backgroundColor: colors.mist,
    paddingHorizontal: spacing.md,
  },
  pwRowInput: {
    flex: 1,
    paddingVertical: spacing.md,
    color: colors.ink,
    fontSize: fontSize.base,
    fontFamily: fontFamily.medium,
  },
  pwErrorText: {
    color: colors.error,
    fontSize: fontSize.xs + 1,
    fontFamily: fontFamily.medium,
    marginTop: spacing.sm,
  },

  // ── Toast ─────────────────────────────────────────
  toastOverlay: {
    position: "absolute",
    bottom: 48,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  toastBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    ...shadow.raised,
  },
  toastText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
  },
});
