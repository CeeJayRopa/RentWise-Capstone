export type PaymentAttemptStatus =
  | "pending"
  | "processing"
  | "paid"
  | "expired"
  | "failed"
  | "cancelled";

export type PaymongoIntentAttributes = {
  status?: string;
  last_payment_error?: unknown;
  amount?: number;
  currency?: string;
};

export function classifyPaymentAttempt(
  attributes: PaymongoIntentAttributes,
  localExpired: boolean,
  priorStatus?: PaymentAttemptStatus,
): PaymentAttemptStatus {
  const providerStatus = String(attributes.status ?? "");
  if (providerStatus === "succeeded") return "paid";
  if (providerStatus === "processing") return "processing";
  if (providerStatus === "cancelled") return "cancelled";
  // PayMongo can briefly expose a last_payment_error while an e-wallet
  // authorization is still settling. During the active session this is not
  // terminal: keep polling so a later provider success or webhook can win.
  if (localExpired && providerStatus === "awaiting_payment_method") {
    return attributes.last_payment_error ? "failed" : "expired";
  }
  // Preserve a terminal unsuccessful result only after the local session is
  // also over. This repairs older sessions that were prematurely marked
  // failed by a transient PayMongo response.
  if (localExpired && (priorStatus === "expired" || priorStatus === "failed" || priorStatus === "cancelled")) {
    return priorStatus;
  }
  // An awaiting_next_action intent remains uncertain even past the local
  // deadline because the provider has not confirmed failure or expiry.
  return "pending";
}

export function isRetryableAttempt(status: PaymentAttemptStatus): boolean {
  return status === "expired" || status === "failed" || status === "cancelled";
}
