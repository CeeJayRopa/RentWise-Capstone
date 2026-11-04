import { useEffect } from "react";
import { View, Text, ActivityIndicator, StyleSheet, Alert } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { doc, getDoc } from "firebase/firestore";
import { auth } from "../shared/firebaseConfig";
import { db } from "../shared/services/firestore";
import { getTenantData } from "../services/tenantService";
import { createPayment } from "../services/paymentService";
import {
  getPendingCheckoutSession,
  getPendingPaymentMethod,
  clearPendingCheckoutSession,
  clearPendingPaymentMethod,
} from "../services/pendingPayment";
import {
  computePeriodCharge,
  rollingAmountDue,
  nextPeriodStart,
  consecutivePeriodsEnding,
  periodLabel,
} from "../services/billingSchedule";
import { colors, fontFamily, fontSize } from "../shared/theme";

const HOME_ROUTE = "/(tabs)/dashboard" as const;

export default function PaymentSuccess() {
  const { amount } = useLocalSearchParams<{ amount: string }>();

  useEffect(() => {
    (async () => {
      try {
        const user = auth.currentUser;
        if (!user) {
          router.replace(HOME_ROUTE);
          return;
        }

        const centavos = Number(amount ?? 0);
        const paymentAmount = centavos / 100;

        const tenantData = await getTenantData(user.uid);
        if (!tenantData) {
          router.replace(HOME_ROUTE);
          return;
        }

        let stallData: any = null;
        if (tenantData.stallId) {
          const stallSnap = await getDoc(doc(db, "stalls", tenantData.stallId));
          if (stallSnap.exists()) {
            stallData = { id: stallSnap.id, ...stallSnap.data() };
          }
        }

        const sessionId = await getPendingCheckoutSession();
        if (!sessionId) {
          // Already recorded by the in-app WebView handler
          router.replace(HOME_ROUTE);
          return;
        }
        const pendingMethod = await getPendingPaymentMethod();
        const paymentMethodLabel = pendingMethod === "gcash" ? "GCash" : pendingMethod === "paymaya" ? "Maya" : "Online";

        const receiptNo = "RW-ONLINE-" + Date.now().toString().slice(-8);
        const tenantName = `${tenantData.firstName} ${tenantData.lastName}`;
        // Billing terms live on the tenant, not the stall -- travels with
        // them if they've relocated, instead of picking up whatever the
        // new stall's previous occupant was charged.
        const schedule = (tenantData as any).paymentSchedule ?? "monthly";
        const dailyRate = (tenantData as any).price ?? 0;

        const scheduleRent = computePeriodCharge(dailyRate, schedule, new Date());

        // Same split as dashboard.tsx: only the portion beyond what's
        // already owed (arrears + today) counts as genuine advance.
        const today = new Date();
        const billingStartedAt = tenantData.createdAt?.toDate?.()
          ?? (tenantData.createdAt ? new Date(tenantData.createdAt) : null);
        const storedNextDueAt = tenantData.nextDueAt?.toDate?.()
          ?? (tenantData.nextDueAt ? new Date(tenantData.nextDueAt) : billingStartedAt);
        const paymentDue = rollingAmountDue(dailyRate, schedule, storedNextDueAt, today);

        const owedAmount = Math.max(paymentDue, scheduleRent || 0);
        const periodsOwed =
          scheduleRent > 0 ? Math.max(1, Math.round(owedAmount / scheduleRent)) : 1;
        const advanceAmount = Math.max(0, paymentAmount - owedAmount);
        const periodsAdvance =
          scheduleRent > 0 ? Math.floor((advanceAmount + 0.000001) / scheduleRent) : 0;
        const periodsCovered = periodsOwed + periodsAdvance;
        const billingCredit = Math.max(0, Math.round((advanceAmount - periodsAdvance * scheduleRent) * 100) / 100);

        // Same itemization as the in-app WebView handler (payments.tsx) —
        // lists each specific unpaid period this payment covers.
        const owedBreakdown = consecutivePeriodsEnding(dailyRate, schedule, today, periodsOwed).map((p) => ({
          label: periodLabel(schedule, p.date),
          amount: p.amount,
        }));
        let advanceCursor = nextPeriodStart(schedule, today);
        const advanceBreakdown: { label: string; amount: number }[] = [];
        for (let i = 0; i < periodsAdvance; i++) {
          advanceBreakdown.push({
            label: `Advance – ${periodLabel(schedule, advanceCursor)}`,
            amount: computePeriodCharge(dailyRate, schedule, advanceCursor),
          });
          advanceCursor = nextPeriodStart(schedule, advanceCursor);
        }
        const breakdown = [...owedBreakdown, ...advanceBreakdown];
        if (billingCredit > 0) breakdown.push({ label: "Remaining billing credit", amount: billingCredit });

        const receiptData = {
          receiptNo,
          tenantName,
          buildingNumber: stallData?.buildingNumber ?? "",
          spaceId: stallData?.spaceId ?? "",
          paymentMethod: paymentMethodLabel,
          date: new Date().toISOString(),
          rentAmount: scheduleRent,
          payment: paymentAmount,
          change: 0,
          status: "PENDING",
          breakdown,
        };

        const newPayment: any = {
          userId: user.uid,
          amount: paymentAmount,
          rentAmount: scheduleRent,
          periodsCovered,
          periodsAdvance,
          method: "online",
          status: "pending",
          tenantName,
          buildingNumber: stallData?.buildingNumber ?? "",
          spaceId: stallData?.spaceId ?? "",
          stallId: tenantData.stallId ?? "",
          receiptNo,
          checkoutSessionId: sessionId ?? null,
          paymentMethod: paymentMethodLabel,
          receiptData,
          receipt: null,
          paymentId: null,
          cashReceived: null,
          change: 0,
        };

        const result = await createPayment(newPayment);
        if (result.status === "recorded") {
          await clearPendingCheckoutSession();
          await clearPendingPaymentMethod();
        } else if (result.status === "processing") {
          Alert.alert("Verification pending", "Your payment is being verified. RentWise will check it again from Payments.");
        } else if (result.status === "expired") {
          await clearPendingCheckoutSession();
          await clearPendingPaymentMethod();
          Alert.alert("Payment expired", "Payment session expired. Please try again.");
        } else if (result.status === "failed" || result.status === "cancelled") {
          await clearPendingCheckoutSession();
          await clearPendingPaymentMethod();
          Alert.alert("Payment not completed", result.status === "failed" ? "Payment failed. Please try again." : "Payment cancelled.");
        }
      } catch (err) {
        console.log("[PaymentSuccess] error:", err);
        Alert.alert(
          "Error",
          "Payment was received but could not be recorded. Contact support.",
        );
      }

      router.replace(HOME_ROUTE);
    })();
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.gold} />
      <Text style={styles.text}>Recording payment...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.ink,
  },
  text: {
    color: colors.parchment,
    marginTop: 16,
    fontSize: fontSize.md,
    fontFamily: fontFamily.medium,
  },
});
