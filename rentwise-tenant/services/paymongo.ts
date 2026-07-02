const PAYMONGO_API_URL =
  "https://rentwise-paymongo-api.vercel.app/api/create-payment-intent";
const API_KEY = "rwpay_RentWise2025Capstone";

export type PaymentMethodType = "gcash" | "paymaya";

interface PaymentIntentResult {
  redirectUrl: string;
  paymentIntentId: string;
}

interface CustomerInfo {
  name: string;
  email: string;
}

export async function createPaymongoPaymentIntent(
  amount: number,
  paymentMethod: PaymentMethodType,
  customer?: CustomerInfo,
): Promise<PaymentIntentResult> {
  const response = await fetch(PAYMONGO_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify({
      amount,
      paymentMethod,
      customerName: customer?.name ?? "",
      customerEmail: customer?.email ?? "",
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    console.error("PayMongo API error:", err);
    throw new Error("Failed to start payment");
  }

  return response.json() as Promise<PaymentIntentResult>;
}
