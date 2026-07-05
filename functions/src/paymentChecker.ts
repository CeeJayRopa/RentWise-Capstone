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

// Sums each billing period's charge for every period from day 1 of the
// month through today's period, inclusive — a period counts in full the
// moment it starts (not prorated by day), and the trailing period is capped
// at the month's last day so the total never overshoots the month's full
// charge (dailyRate × daysInMonth).
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
// ─────────────────────────────────────────────────────────────────────────────
export async function isPaymentDue(
  tenantId: string,
  schedule: string,
  dailyRate: number,
): Promise<boolean> {
  // Composite index required in Firestore: userId ASC, status ASC
  const snap = await getFirestore()
    .collection('payments')
    .where('userId', '==', tenantId)
    .where('status', 'in', ['approved', 'pending'])
    .get();

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthTotalCharge = dailyRate * daysInMonth;

  let paidThisMonth = 0;
  let hasPendingThisMonth = false;
  let hasPaidForCurrentSpecificPeriod = false;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const paymentDate: Date = data.date?.toDate
      ? data.date.toDate()
      : new Date(data.date);

    if (data.status === 'approved') {
      if (paymentDate.getFullYear() === year && paymentDate.getMonth() === month) {
        paidThisMonth += Number(data.amount || 0);
      }
    } else {
      // pending
      if (paymentDate.getFullYear() === year && paymentDate.getMonth() === month) {
        hasPendingThisMonth = true;
      }
    }

    if (isSamePeriod(schedule, paymentDate, now)) {
      hasPaidForCurrentSpecificPeriod = true;
    }
  }

  // Semi-monthly tenants aren't due until the 15th (first half) or the
  // last day of the month (second half) — the charge starts accruing on
  // the 1st/16th internally, but a reminder shouldn't fire before the
  // actual due date arrives. Mirrors the same gate in dashboard.tsx.
  const beforeSemiMonthlyDueDate = schedule === 'semi-monthly' && now.getDate() < 15;

  const balance = monthTotalCharge - paidThisMonth;
  const hasPaidCurrentPeriod =
    balance <= 0 || hasPendingThisMonth || hasPaidForCurrentSpecificPeriod || beforeSemiMonthlyDueDate;

  return !hasPaidCurrentPeriod;
}

// ─────────────────────────────────────────────────────────────────────────────
// DUPLICATE REMINDER CHECK
// Returns true → a reminder was already sent within the current period
// ─────────────────────────────────────────────────────────────────────────────
export async function hasReminderBeenSent(
  tenantId: string,
  schedule: string,
): Promise<boolean> {
  const now = new Date();
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
