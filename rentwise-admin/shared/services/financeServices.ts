import type { QueryDocumentSnapshot, DocumentData } from "firebase/firestore";

type TimestampLike = { toDate?: () => Date; seconds?: number } | Date | string | number | null | undefined;

export function isTenantCaughtUp(nextDueValue: TimestampLike, now: Date = new Date()): boolean {
  if (!nextDueValue) return false;
  const due = nextDueValue instanceof Date
    ? nextDueValue
    : typeof nextDueValue === "object" && typeof nextDueValue.toDate === "function"
      ? nextDueValue.toDate()
      : typeof nextDueValue === "object" && typeof nextDueValue.seconds === "number"
        ? new Date(nextDueValue.seconds * 1000)
        : new Date(nextDueValue as string | number);
  return !Number.isNaN(due.getTime()) && due.getTime() > now.getTime();
}

const RENTAL_CYCLE_DAYS = 30;
function localDayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}
function addLocalDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() + days);
  return result;
}
export function rentalCycleProgress(dailyRate: number, billingStartedAt: Date | null, nextDueAt: Date | null, now: Date) {
  const safeRate = Number.isFinite(dailyRate) ? Math.max(0, dailyRate) : 0;
  const leaseStart = addLocalDays(billingStartedAt && !Number.isNaN(billingStartedAt.getTime()) ? billingStartedAt : now, 0);
  const today = addLocalDays(now, 0);
  const cycleIndex = Math.floor(Math.max(0, localDayNumber(today) - localDayNumber(leaseStart)) / RENTAL_CYCLE_DAYS);
  const cycleStart = addLocalDays(leaseStart, cycleIndex * RENTAL_CYCLE_DAYS);
  const cycleEndExclusive = addLocalDays(cycleStart, RENTAL_CYCLE_DAYS);
  const coverageEnd = addLocalDays(nextDueAt && !Number.isNaN(nextDueAt.getTime()) ? nextDueAt : leaseStart, 0);
  const coveredDays = Math.max(0, Math.min(RENTAL_CYCLE_DAYS, localDayNumber(coverageEnd) - localDayNumber(cycleStart)));
  const totalBill = safeRate * RENTAL_CYCLE_DAYS;
  const settled = Math.min(totalBill, safeRate * coveredDays);
  return { cycleStart, cycleEndExclusive, totalBill, settled, remaining: Math.max(0, totalBill - settled), percent: totalBill > 0 ? settled / totalBill * 100 : 0 };
}

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
