const PAYMONGO_API_URL =
  "https://rentwise-paymongo-api.vercel.app/api/create-checkout";
const API_KEY = "rwpay_RentWise2025Capstone";

interface CheckoutResult {
  checkoutSessionId: string;
  checkoutUrl: string;
}

interface CustomerInfo {
  name: string;
  email: string;
}

export async function createPaymongoCheckout(
  amount: number,
  customer?: CustomerInfo,
): Promise<CheckoutResult> {
  const response = await fetch(PAYMONGO_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify({
      amount,
      customerName: customer?.name ?? "",
      customerEmail: customer?.email ?? "",
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    console.error("PayMongo API error:", err);
    throw new Error("Failed to create checkout session");
  }

  return response.json() as Promise<CheckoutResult>;
}
