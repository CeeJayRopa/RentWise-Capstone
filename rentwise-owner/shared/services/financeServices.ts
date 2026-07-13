import type { QueryDocumentSnapshot, DocumentData } from "firebase/firestore";

export const getPaidTenantUserIds = (
  paymentDocs: QueryDocumentSnapshot<DocumentData, DocumentData>[]
): Set<string> => {
  return new Set(paymentDocs.map((d) => d.data().userId as string));
};

// Advances `d` to the start of the next billing period for `schedule`.
// Mirrors rentwise-admin/app/financials.tsx's nextPeriodStart exactly — kept
// in sync there since financials.tsx owns the canonical per-tenant status
// logic and isn't wired to this shared copy (too risky to touch that screen
// just to dedupe).
function nextPeriodStart(schedule: string, d: Date): Date {
  const n = new Date(d);
  if (schedule === "daily") {
    n.setDate(n.getDate() + 1);
    return n;
  }
  if (schedule === "weekly") {
    n.setDate(n.getDate() + 7);
    return n;
  }
  if (schedule === "semi-monthly") {
    if (n.getDate() <= 15) {
      n.setDate(16);
      return n;
    }
    return new Date(n.getFullYear(), n.getMonth() + 1, 1);
  }
  return new Date(n.getFullYear(), n.getMonth() + 1, 1); // monthly
}

// Sums each billing period's charge for every period from day 1 of the
// month through today's period, inclusive. Mirrors financials.tsx's
// chargedSinceMonthStart exactly.
function chargedSinceMonthStart(dailyRate: number, schedule: string, today: Date): number {
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEndExclusive = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  let total = 0;
  let cursor = monthStart;
  let guard = 0;
  while (cursor <= today && guard < 31) {
    const periodEnd = nextPeriodStart(schedule, cursor);
    const cappedEnd = periodEnd < monthEndExclusive ? periodEnd : monthEndExclusive;
    const daysInChunk = Math.round((cappedEnd.getTime() - cursor.getTime()) / 86400000);
    total += dailyRate * daysInChunk;
    cursor = periodEnd;
    guard++;
  }
  return total;
}

// Whether a tenant is caught up through today's billing period — i.e. what
// they've actually paid this month covers what's accrued so far, the same
// day-by-day accrual check financials.tsx uses per tenant. A tenant who has
// made SOME payment this month but not enough to cover what's due is still
// "unpaid" here, unlike the looser getPaidTenantUserIds check above (which
// only checks whether ANY approved payment exists this month).
export function isTenantPaidThisMonth(
  dailyRate: number,
  schedule: string,
  paidThisMonth: number,
  today: Date = new Date(),
): boolean {
  const chargedToDate = chargedSinceMonthStart(dailyRate, schedule, today);
  return chargedToDate - paidThisMonth <= 0;
}
