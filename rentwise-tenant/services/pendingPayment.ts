let pendingCheckoutSessionId: string | null = null;
let pendingPaymentMethod: string | null = null;

export function setPendingCheckoutSession(id: string): void {
  pendingCheckoutSessionId = id;
}

export function getPendingCheckoutSession(): string | null {
  return pendingCheckoutSessionId;
}

export function clearPendingCheckoutSession(): void {
  pendingCheckoutSessionId = null;
}

// Remembers which wallet (GCash/Maya) the tenant picked before handing off
// to the WebView checkout, so the payment record created afterward can show
// the actual method instead of a generic "GCash/Maya" label.
export function setPendingPaymentMethod(method: string): void {
  pendingPaymentMethod = method;
}

export function getPendingPaymentMethod(): string | null {
  return pendingPaymentMethod;
}

export function clearPendingPaymentMethod(): void {
  pendingPaymentMethod = null;
}
