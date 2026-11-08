import { getFirestore } from 'firebase-admin/firestore';

// ─────────────────────────────────────────────────────────────────────────────
// PERIOD HELPERS
// Mirrors rentwise-tenant/app/dashboard.tsx exactly, so a reminder only
// fires when the tenant's own dashboard would still show them as owing.
// ─────────────────────────────────────────────────────────────────────────────

// Advances `d` to the start of the next billing period for `schedule`.
function nextPeriodStart(schedule: string, d: Date): Date {
  const n = new Date(d);
  if (schedule === 'daily') {
    n.setDate(n.getDate() + 1);
    return n;
  }
  if (schedule === 'weekly') {
    n.setDate(n.getDate() + 7);
    return n;
  }
  if (schedule === 'semi-monthly') {
    if (n.getDate() <= 15) {
      n.setDate(16);
      return n;
    }
    return new Date(n.getFullYear(), n.getMonth() + 1, 1);
  }
  return new Date(n.getFullYear(), n.getMonth() + 1, 1); // monthly
}

function scheduleIntervalDays(schedule: string): number {
  if (schedule === 'daily') return 1;
  if (schedule === 'weekly') return 7;
  if (schedule === 'semi-monthly') return 15;
  return 30;
}

function rollingAmountDue(
  dailyRate: number,
  schedule: string,
  nextDueAt: Date | null | undefined,
  now: Date,
): number {
  if (!nextDueAt || Number.isNaN(nextDueAt.getTime()) || now < nextDueAt) return 0;
  const days = scheduleIntervalDays(schedule);
  const periodsDue = Math.floor((now.getTime() - nextDueAt.getTime()) / (days * 86400000)) + 1;
  return Math.max(0, dailyRate) * days * periodsDue;
}

type PaymentCoverageRecord = Record<string, unknown>;

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value && typeof (value as {toDate?: unknown}).toDate === 'function') {
    const converted = (value as {toDate: () => Date}).toDate();
    return Number.isNaN(converted.getTime()) ? null : converted;
  }
  return null;
}

// Payment approval and tenant billing updates normally happen in one
// transaction. Legacy/manual records can still contain correct payment
// coverage while the tenant's nextDueAt is stale, though. Reminders must use
// the furthest authoritative approved coverage instead of treating that paid
// tenant as overdue. Taking the maximum date also avoids subtracting old
// approved amounts from a newer billing period a second time.
export function effectiveNextDueFromApprovedPayments(
  storedNextDue: Date | null | undefined,
  payments: PaymentCoverageRecord[],
): Date | null {
  let effective = storedNextDue && !Number.isNaN(storedNextDue.getTime()) ? storedNextDue : null;
  for (const payment of payments) {
    if (payment.status !== 'approved') continue;
    const coverageEnd = asDate(payment.paidThroughAt) ?? asDate(payment.nextDueAt);
    if (coverageEnd && (!effective || coverageEnd > effective)) effective = coverageEnd;
  }
  return effective;
}

// Sums each billing period's charge for every period from day 1 of the
// month through today's period, inclusive — a period counts in full the
// moment it starts (not prorated by day), and the trailing period is capped
// at the month's last day so the total never overshoots the month's full
// charge (dailyRate × daysInMonth).
function chargeableStartForMonth(today: Date, billingStartedAt?: Date | null): Date {
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  if (!billingStartedAt || Number.isNaN(billingStartedAt.getTime())) return monthStart;
  const started = new Date(
    billingStartedAt.getFullYear(),
    billingStartedAt.getMonth(),
    billingStartedAt.getDate(),
  );
  return started > monthStart ? started : monthStart;
}

function chargedSinceMonthStart(
  dailyRate: number,
  schedule: string,
  today: Date,
  billingStartedAt?: Date | null,
): number {
  const monthEndExclusive = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  let total = 0;
  let cursor = chargeableStartForMonth(today, billingStartedAt);
  if (cursor > today) return 0;
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

export async function getOutstandingBalance(
  tenantId: string,
  schedule: string,
  dailyRate: number,
  now: Date,
  nextDueAt?: Date | null,
): Promise<number> {
  let effectiveNextDue = nextDueAt;
  if (effectiveNextDue === undefined) {
    const tenantSnap = await getFirestore().collection('users').doc(tenantId).get();
    const tenant = tenantSnap.data();
    const storedDue = tenant?.nextDueAt ?? tenant?.billingStartedAt ?? tenant?.createdAt;
    effectiveNextDue = storedDue?.toDate ? storedDue.toDate() : null;
  }
  return rollingAmountDue(dailyRate, schedule, effectiveNextDue, now);
}

// True if `a` and `b` fall within the same billing period for `schedule` —
// used only to detect a payment made specifically for today's period, so a
// tenant isn't nagged again the same day they already paid (even partially).
function isSamePeriod(schedule: string, a: Date, b: Date): boolean {
  if (schedule === 'daily') {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }
  if (schedule === 'weekly') {
    // Must match chargedSinceMonthStart/nextPeriodStart's week boundaries —
    // 7-day chunks counted from the 1st of the month (due on the 1st, 8th,
    // 15th, 22nd, 29th), NOT real Sunday-starting calendar weeks.
    const periodIndexOf = (d: Date) => Math.floor((d.getDate() - 1) / 7);
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      periodIndexOf(a) === periodIndexOf(b)
    );
  }
  if (schedule === 'semi-monthly') {
    const halfOf = (d: Date) => (d.getDate() <= 15 ? 0 : 1);
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      halfOf(a) === halfOf(b)
    );
  }
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth(); // monthly
}

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT DUE CHECK
// Returns true  → the current month's running balance is not yet settled
//         false → the tenant is paid up through today (or ahead)
//
// `now` MUST be the caller's Manila-adjusted Date (reminderScheduler.ts's
// `nowManila`), never `new Date()` computed in here -- Cloud Functions run
// in UTC, and Manila is UTC+8, so any local `new Date()` is on the WRONG
// calendar day for roughly a third of the day (00:00-07:59 Manila time).
// That silently broke every calculation below (month totals, period
// matching, semi-monthly gating) whenever a reminder was scheduled in that
// window -- e.g. a 7:35 AM Manila run saw a `now` of 23:35 the previous day.
// ─────────────────────────────────────────────────────────────────────────────
export async function isPaymentDue(
  tenantId: string,
  schedule: string,
  dailyRate: number,
  now: Date,
  nextDueAt?: Date | null,
): Promise<boolean> {
  // Composite index required in Firestore: userId ASC, status ASC
  const snap = await getFirestore()
    .collection('payments')
    .where('userId', '==', tenantId)
    .where('status', 'in', ['approved', 'pending'])
    .get();

  let pendingAmount = 0;
  const payments: PaymentCoverageRecord[] = [];

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    payments.push(data);
    if (data.status === 'pending') {
      const amount = Number(data.amount ?? 0);
      if (Number.isFinite(amount) && amount > 0) pendingAmount += amount;
    }
  }

  // Semi-monthly tenants aren't due until the 15th (first half) or the
  // last day of the month (second half) — the charge starts accruing on
  // the 1st/16th internally, but a reminder shouldn't fire before the
  // actual due date arrives. Mirrors the same gate in dashboard.tsx.
  const effectiveNextDue = effectiveNextDueFromApprovedPayments(nextDueAt, payments);
  const balance = rollingAmountDue(dailyRate, schedule, effectiveNextDue, now);
  const hasPendingCoverage = balance > 0 && pendingAmount >= balance;
  const hasPaidCurrentPeriod = balance <= 0 || hasPendingCoverage;

  return !hasPaidCurrentPeriod;
}

// ─────────────────────────────────────────────────────────────────────────────
// DUPLICATE REMINDER CHECK
// Returns true → a reminder was already sent within the current period
//
// `now` MUST be the caller's Manila-adjusted Date -- see the comment on
// isPaymentDue above for why.
// ─────────────────────────────────────────────────────────────────────────────
export async function hasReminderBeenSent(
  tenantId: string,
  schedule: string,
  now: Date,
): Promise<boolean> {
  let periodStart: Date;

  if (schedule === 'daily') {
    periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (schedule === 'weekly') {
    // Month-relative 7-day chunks (1st, 8th, 15th, 22nd, 29th) — matches
    // isSamePeriod/chargedSinceMonthStart, not real calendar weeks.
    const periodIndex = Math.floor((now.getDate() - 1) / 7);
    periodStart = new Date(now.getFullYear(), now.getMonth(), periodIndex * 7 + 1);
  } else if (schedule === 'semi-monthly') {
    periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() <= 15 ? 1 : 16);
  } else {
    // monthly
    periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  // Composite index required: tenantId ASC, schedule ASC, sentAt ASC
  const snap = await getFirestore()
    .collection('reminder_logs')
    .where('tenantId', '==', tenantId)
    .where('schedule', '==', schedule)
    .where('sentAt', '>=', periodStart)
    .limit(1)
    .get();

  return !snap.empty;
}
