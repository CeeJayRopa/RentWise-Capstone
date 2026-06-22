let pendingCheckoutSessionId: string | null = null;

export function setPendingCheckoutSession(id: string): void {
  pendingCheckoutSessionId = id;
}

export function getPendingCheckoutSession(): string | null {
  return pendingCheckoutSessionId;
}

export function clearPendingCheckoutSession(): void {
  pendingCheckoutSessionId = null;
}
