import { useEffect } from "react";
import { View, Text, ActivityIndicator, StyleSheet, Alert } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { doc, getDoc, collection, getDocs, query, where } from "firebase/firestore";
import { auth } from "../shared/firebaseConfig";
import { db } from "../shared/services/firestore";
import { getTenantData } from "../services/tenantService";
import { createPayment } from "../services/paymentService";
import {
  getPendingCheckoutSession,
  clearPendingCheckoutSession,
  getPendingPaymentMethod,
  clearPendingPaymentMethod,
} from "../services/pendingPayment";
import {
  computePeriodCharge,
  chargedSinceMonthStart,
  nextPeriodStart,
  consecutivePeriodsEnding,
  periodLabel,
} from "../services/billingSchedule";
import { colors, fontFamily, fontSize } from "../shared/theme";

export default function PaymentSuccess() {
  const { amount } = useLocalSearchParams<{ amount: string }>();

  useEffect(() => {
    (async () => {
      try {
        const user = auth.currentUser;
        if (!user) {
          router.replace("/payments");
          return;
        }

        const centavos = Number(amount ?? 0);
        const paymentAmount = centavos / 100;

        const tenantData = await getTenantData(user.uid);
        if (!tenantData) {
          router.replace("/payments");
          return;
        }

        let stallData: any = null;
        if (tenantData.stallId) {
          const stallSnap = await getDoc(doc(db, "stalls", tenantData.stallId));
          if (stallSnap.exists()) {
            stallData = { id: stallSnap.id, ...stallSnap.data() };
          }
        }

        const sessionId = getPendingCheckoutSession();
        if (!sessionId) {
          // Already recorded by the in-app WebView handler
          router.replace("/payments");
          return;
        }
        clearPendingCheckoutSession();
        const pendingMethod = getPendingPaymentMethod();
        clearPendingPaymentMethod();
        const paymentMethodLabel = pendingMethod === "gcash" ? "GCash" : pendingMethod === "paymaya" ? "Maya" : "GCash/Maya";

        const receiptNo = "RW-ONLINE-" + Date.now().toString().slice(-8);
        const tenantName = `${tenantData.firstName} ${tenantData.lastName}`;
        const schedule = stallData?.paymentSchedule ?? "monthly";

        const scheduleRent = computePeriodCharge(stallData?.price ?? 0, schedule, new Date());

        // Same split as dashboard.tsx: only the portion beyond what's
        // already owed (arrears + today) counts as genuine advance.
        const today = new Date();
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const paymentsSnap = await getDocs(
          query(
            collection(db, "payments"),
            where("userId", "==", user.uid),
            where("status", "==", "approved"),
          ),
        );
        const paidThisMonth = paymentsSnap.docs.reduce((sum, d) => {
          const data = d.data();
          const pd = data.date?.toDate?.();
          if (!pd || pd < monthStart) return sum;
          return sum + Number(data.amount || 0);
        }, 0);
        const chargedToDate = chargedSinceMonthStart(stallData?.price ?? 0, schedule, today);
        const paymentDue = chargedToDate - paidThisMonth;

        const owedAmount = Math.max(paymentDue, scheduleRent || 0);
        const periodsOwed =
          scheduleRent > 0 ? Math.max(1, Math.round(owedAmount / scheduleRent)) : 1;
        const advanceAmount = Math.max(0, paymentAmount - owedAmount);
        const periodsAdvance =
          scheduleRent > 0 ? Math.round(advanceAmount / scheduleRent) : 0;
        const periodsCovered = periodsOwed + periodsAdvance;

        // Same itemization as the in-app WebView handler (payments.tsx) —
        // lists each specific unpaid period this payment covers.
        const owedBreakdown = consecutivePeriodsEnding(stallData?.price ?? 0, schedule, today, periodsOwed).map((p) => ({
          label: periodLabel(schedule, p.date),
          amount: p.amount,
        }));
        let advanceCursor = nextPeriodStart(schedule, today);
        const advanceBreakdown: { label: string; amount: number }[] = [];
        for (let i = 0; i < periodsAdvance; i++) {
          advanceBreakdown.push({
            label: `Advance – ${periodLabel(schedule, advanceCursor)}`,
            amount: computePeriodCharge(stallData?.price ?? 0, schedule, advanceCursor),
          });
          advanceCursor = nextPeriodStart(schedule, advanceCursor);
        }
        const breakdown = [...owedBreakdown, ...advanceBreakdown];

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

        await createPayment(newPayment);
      } catch (err) {
        console.log("[PaymentSuccess] error:", err);
        Alert.alert(
          "Error",
          "Payment was received but could not be recorded. Contact support.",
        );
      }

      router.replace("/payments");
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
