import {PaymongoIntentAttributes} from "./paymentAttemptStatus";

export function providerPaymentMatches(
  provider: PaymongoIntentAttributes,
  expectedAmountCentavos: number,
): boolean {
  return provider.status === "succeeded" &&
    Math.round(Number(provider.amount ?? 0)) === expectedAmountCentavos &&
    String(provider.currency ?? "").toUpperCase() === "PHP";
}

export function ownsPaymentCreationLock(
  lock: Record<string, unknown> | undefined,
  creationToken: string,
): boolean {
  return lock?.state === "creating" && lock.creationToken === creationToken;
}

export function paymentApprovalBindingMatches(args: {
  payment: Record<string, unknown>;
  session: Record<string, unknown>;
  paymentId: string;
  checkoutSessionId: string;
  userId: string;
  amountCentavos: number;
}): boolean {
  const {payment, session, paymentId, checkoutSessionId, userId, amountCentavos} = args;
  return payment.status === "pending" &&
    payment.method === "online" &&
    String(payment.userId ?? "") === userId &&
    Math.round(Number(payment.amount ?? 0) * 100) === amountCentavos &&
    String(payment.checkoutSessionId ?? "") === checkoutSessionId &&
    String(session.userId ?? "") === userId &&
    String(session.paymentId ?? "") === paymentId &&
    Math.round(Number(session.amount ?? 0) * 100) === amountCentavos;
}

export function paymentIntervalDaysFor(schedule: string): number {
  if (schedule === "daily") return 1;
  if (schedule === "weekly") return 7;
  if (schedule === "semi-monthly") return 15;
  return 30;
}

export function advancePaymentLimitFor(schedule: string): number {
  if (schedule === "daily") return 365;
  if (schedule === "weekly") return 52;
  if (schedule === "semi-monthly") return 24;
  return 12;
}

export function billingPeriodsDueAt(coverageStart: Date, intervalDays: number, now: Date): number {
  if (coverageStart.getTime() > now.getTime()) return 0;
  return Math.floor((now.getTime() - coverageStart.getTime()) / (intervalDays * 24 * 60 * 60 * 1000)) + 1;
}
