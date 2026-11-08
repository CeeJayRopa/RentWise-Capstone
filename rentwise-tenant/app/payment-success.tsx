import { useEffect } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { auth } from "../shared/firebaseConfig";
import { colors, fontFamily, fontSize } from "../shared/theme";
import { createPayment } from "../services/paymentService";
import {
  clearPendingCheckoutSession,
  clearPendingPaymentMethod,
  getPendingCheckoutSession,
  getPendingPaymentMethod,
} from "../services/pendingPayment";

const HOME_ROUTE = "/(tabs)/dashboard" as const;

export default function PaymentSuccess() {
  const { amount } = useLocalSearchParams<{ amount?: string }>();

  useEffect(() => {
    void (async () => {
      try {
        const user = auth.currentUser;
        if (!user) {
          router.replace(HOME_ROUTE);
          return;
        }

        const sessionId = await getPendingCheckoutSession();
        if (!sessionId) {
          // The in-app WebView handler may already have recorded this return.
          router.replace(HOME_ROUTE);
          return;
        }

        const centavos = Number(amount ?? 0);
        if (!Number.isSafeInteger(centavos) || centavos <= 0) {
          throw new Error("The payment return amount is invalid.");
        }

        const pendingMethod = await getPendingPaymentMethod();
        if (pendingMethod !== "gcash" && pendingMethod !== "paymaya") {
          throw new Error("The pending payment method is unavailable.");
        }
        const paymentMethod = pendingMethod === "gcash" ? "GCash" : "Maya";

        // The Cloud Function validates this amount against the PayMongo
        // session and constructs the authoritative multi-stall receipt from
        // the server-side quote. This recovery route never rebuilds billing
        // data from a single current stall.
        const result = await createPayment({
          userId: user.uid,
          amount: centavos / 100,
          checkoutSessionId: sessionId,
          paymentMethod,
        });

        if (result.status === "recorded") {
          await clearPendingCheckoutSession();
          await clearPendingPaymentMethod();
        } else if (result.status === "processing") {
          Alert.alert(
            "Verification pending",
            "Your payment is being verified. RentWise will check it again from Payments.",
          );
        } else if (result.status === "expired") {
          await clearPendingCheckoutSession();
          await clearPendingPaymentMethod();
          Alert.alert("Payment expired", "Payment session expired. Please try again.");
        } else if (result.status === "failed" || result.status === "cancelled") {
          await clearPendingCheckoutSession();
          await clearPendingPaymentMethod();
          Alert.alert(
            "Payment not completed",
            result.status === "failed" ? "Payment failed. Please try again." : "Payment cancelled.",
          );
        }
      } catch (error) {
        console.log("[PaymentSuccess] error:", error);
        Alert.alert(
          "Verification pending",
          "RentWise could not confirm the final result yet. Your payment will continue to be checked securely.",
        );
      }

      router.replace(HOME_ROUTE);
    })();
  }, [amount]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.gold} />
      <Text style={styles.text}>Verifying payment...</Text>
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
