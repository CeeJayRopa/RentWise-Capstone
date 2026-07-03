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
  clearPendingCheckoutSession,
} from "../services/pendingPayment";

// The admin always enters the stall's DAILY rate. Every schedule's period
// charge is derived by multiplying that daily rate by however many days
// fall in the period containing `date`.
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

export default function PaymentSuccess() {
  const { amount } = useLocalSearchParams<{ amount: string }>();

  useEffect(() => {
    (async () => {
      try {
        const user = auth.currentUser;
        if (!user) {
          router.replace("/dashboard");
          return;
        }

        const centavos = Number(amount ?? 0);
        const paymentAmount = centavos / 100;

        const tenantData = await getTenantData(user.uid);
        if (!tenantData) {
          router.replace("/dashboard");
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
          router.replace("/dashboard");
          return;
        }
        clearPendingCheckoutSession();

        const receiptNo = "RW-ONLINE-" + Date.now().toString().slice(-8);
        const tenantName = `${tenantData.firstName} ${tenantData.lastName}`;

        const scheduleRent = computePeriodCharge(
          stallData?.price ?? 0,
          stallData?.paymentSchedule ?? "monthly",
          new Date(),
        );
        const periodsCovered =
          scheduleRent > 0 ? Math.max(1, Math.round(paymentAmount / scheduleRent)) : 1;

        const receiptData = {
          receiptNo,
          tenantName,
          buildingNumber: stallData?.buildingNumber ?? "",
          spaceId: stallData?.spaceId ?? "",
          paymentMethod: "GCash/Maya",
          date: new Date().toISOString(),
          rentAmount: scheduleRent,
          payment: paymentAmount,
          change: 0,
          status: "PENDING",
        };

        const newPayment: any = {
          userId: user.uid,
          amount: paymentAmount,
          rentAmount: scheduleRent,
          periodsCovered,
          method: "online",
          status: "pending",
          tenantName,
          buildingNumber: stallData?.buildingNumber ?? "",
          spaceId: stallData?.spaceId ?? "",
          stallId: tenantData.stallId ?? "",
          receiptNo,
          checkoutSessionId: sessionId ?? null,
          paymentMethod: "GCash/Maya",
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

      router.replace("/dashboard");
    })();
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#F5C518" />
      <Text style={styles.text}>Recording payment...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1A1A1A",
  },
  text: {
    color: "#fff",
    marginTop: 16,
    fontSize: 16,
  },
});
