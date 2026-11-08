export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function scheduleIntervalDays(schedule: string): number {
  if (schedule === "daily") return 1;
  if (schedule === "weekly") return 7;
  if (schedule === "semi-monthly") return 15;
  return 30;
}

export function scheduleDayLabel(schedule: string): string {
  const days = scheduleIntervalDays(schedule);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export const RENTAL_CYCLE_DAYS = 30;

function localDayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

export function addLocalDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() + days);
  return result;
}

export type RentalCycleProgress = {
  cycleStart: Date;
  cycleEndExclusive: Date;
  totalBill: number;
  settled: number;
  remaining: number;
  percent: number;
};

// RentWise stores the admin-entered monthly rent as a daily rate divided by
// 30. Keep that pricing contract by reporting progress in tenant-specific
// 30-day cycles anchored to the lease start, rather than calendar months.
// `nextDueAt` is the first uncovered day, so it is also the exclusive end of
// approved coverage. This makes advance payments count only inside the cycle
// being displayed and prevents a payment made this month for future rent from
// inflating the current cycle's Settled amount.
export function rentalCycleProgress(
  dailyRate: number,
  billingStartedAt: Date | null | undefined,
  nextDueAt: Date | null | undefined,
  now: Date,
): RentalCycleProgress {
  const safeRate = Number.isFinite(dailyRate) ? Math.max(0, dailyRate) : 0;
  const validStart = billingStartedAt && !Number.isNaN(billingStartedAt.getTime())
    ? billingStartedAt
    : now;
  const leaseStart = addLocalDays(validStart, 0);
  const today = addLocalDays(now, 0);
  const elapsedDays = Math.max(0, localDayNumber(today) - localDayNumber(leaseStart));
  const cycleIndex = Math.floor(elapsedDays / RENTAL_CYCLE_DAYS);
  const cycleStart = addLocalDays(leaseStart, cycleIndex * RENTAL_CYCLE_DAYS);
  const cycleEndExclusive = addLocalDays(cycleStart, RENTAL_CYCLE_DAYS);

  const validCoverageEnd = nextDueAt && !Number.isNaN(nextDueAt.getTime())
    ? addLocalDays(nextDueAt, 0)
    : leaseStart;
  const coveredDays = Math.max(
    0,
    Math.min(
      RENTAL_CYCLE_DAYS,
      localDayNumber(validCoverageEnd) - localDayNumber(cycleStart),
    ),
  );
  const totalBill = safeRate * RENTAL_CYCLE_DAYS;
  const settled = Math.min(totalBill, safeRate * coveredDays);
  const remaining = Math.max(0, totalBill - settled);
  const percent = totalBill > 0 ? Math.min(100, Math.max(0, (settled / totalBill) * 100)) : 0;

  return { cycleStart, cycleEndExclusive, totalBill, settled, remaining, percent };
}

export function rentalCycleLabel(progress: RentalCycleProgress): string {
  const endInclusive = addLocalDays(progress.cycleEndExclusive, -1);
  const start = progress.cycleStart.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
  const end = endInclusive.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
  return `${start}–${end}`.toUpperCase();
}

export function rollingAmountDue(
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

export type SchedulePeriodSummary = {
  amountDue: number;
  periodCharge: number;
  settled: number;
  percent: number;
  dueDate: Date;
  isOverdue: boolean;
};

// Read-only dashboard projection for the tenant's configured schedule. The
// persisted nextDueAt remains authoritative; this helper never advances or
// rewrites billing state. If multiple periods are overdue, amountDue includes
// all of them while periodCharge still describes one configured period.
export function schedulePeriodSummary(
  dailyRate: number,
  schedule: string,
  nextDueAt: Date | null | undefined,
  fallbackDueAt: Date | null | undefined,
  now: Date,
): SchedulePeriodSummary {
  const validNextDueAt = nextDueAt && !Number.isNaN(nextDueAt.getTime())
    ? addLocalDays(nextDueAt, 0)
    : fallbackDueAt && !Number.isNaN(fallbackDueAt.getTime())
      ? addLocalDays(fallbackDueAt, 0)
      : addLocalDays(now, 0);
  const today = addLocalDays(now, 0);
  const periodCharge = Math.max(0, computePeriodCharge(dailyRate, schedule, today));
  const amountDue = rollingAmountDue(dailyRate, schedule, validNextDueAt, today);
  const isOverdue = today >= validNextDueAt;
  const settled = amountDue > 0 ? 0 : periodCharge;
  const percent = periodCharge > 0 ? (settled / periodCharge) * 100 : 0;

  return { amountDue, periodCharge, settled, percent, dueDate: validNextDueAt, isOverdue };
}

export function nextDueAfterApproval(approvedAt: Date, schedule: string): Date {
  const next = new Date(approvedAt);
  next.setDate(next.getDate() + scheduleIntervalDays(schedule));
  return next;
}

// The admin always enters the stall's DAILY rate. Every schedule's period
// charge is derived by multiplying that daily rate by however many days
// fall in the period containing `date` (weekly is always 7 days; monthly
// and semi-monthly vary with the actual calendar, e.g. Feb vs. Jan).
export function computePeriodCharge(dailyRate: number, schedule: string, date: Date): number {
  return dailyRate * scheduleIntervalDays(schedule);
}

// How many days make up one billing period for `schedule`, as of `date` —
// used only to show the tenant the "X days × ₱rate" breakdown behind a
// charge, mirroring computePeriodCharge's own day-count logic.
export function periodDayCount(schedule: string, date: Date): number {
  return scheduleIntervalDays(schedule);
}

// Advances `d` to the start of the next billing period for `schedule`.
export function nextPeriodStart(schedule: string, d: Date): Date {
  const n = new Date(d);
  n.setDate(n.getDate() + scheduleIntervalDays(schedule));
  return n;
}

// Sums each billing period's charge for every period from day 1 of the
// month through today's period, inclusive. A period counts in full the
// moment it starts — it isn't prorated by how many days into it "today" is
// — so a weekly tenant on day 3 (still inside week 1) owes exactly one
// week's rent (₱1,169), not a 3-day fraction. For "daily" this naturally
// reduces to dailyRate × day-of-month, since each day is its own period.
// The trailing period is capped at the month's last day (e.g. a weekly
// tenant's 5th "week" of a 31-day month is really only 3 days) so the
// running total never overshoots — and stays equal to — the month's total
// charge (dailyRate × daysInMonth) once every period has started.
function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// The first chargeable day in the displayed month. New tenants must never
// inherit rent from days before their account/lease was created.
export function chargeableStartForMonth(today: Date, billingStartedAt?: Date | null): Date {
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  if (!billingStartedAt || Number.isNaN(billingStartedAt.getTime())) return monthStart;
  const started = startOfLocalDay(billingStartedAt);
  return started > monthStart ? started : monthStart;
}

export function chargeableMonthTotal(
  dailyRate: number,
  today: Date,
  billingStartedAt?: Date | null,
): number {
  const cursor = chargeableStartForMonth(today, billingStartedAt);
  const monthEndExclusive = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  if (cursor >= monthEndExclusive) return 0;
  const days = Math.round((monthEndExclusive.getTime() - cursor.getTime()) / 86400000);
  return dailyRate * Math.max(0, days);
}

export function chargedSinceMonthStart(
  dailyRate: number,
  schedule: string,
  today: Date,
  billingStartedAt?: Date | null,
): number {
  let cursor = chargeableStartForMonth(today, billingStartedAt);
  if (cursor > today) return 0;
  const monthEndExclusive = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  let total = 0;
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
// used to block a duplicate "Pay Now" submission for a period that's
// already been paid, separate from the month-wide running balance.
export function isSamePeriod(schedule: string, a: Date, b: Date): boolean {
  if (schedule === "daily") {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }
  if (schedule === "weekly") {
    // Must match chargedSinceMonthStart/nextPeriodStart's week boundaries —
    // 7-day chunks counted from the 1st of the month (due on the 1st, 8th,
    // 15th, 22nd, 29th), NOT real Sunday-starting calendar weeks. Using
    // calendar weeks here let the Pay Online button reopen mid-period even
    // after that period was already paid, whenever the 1st of the month
    // wasn't a Sunday.
    const periodIndexOf = (d: Date) => Math.floor((d.getDate() - 1) / 7);
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      periodIndexOf(a) === periodIndexOf(b)
    );
  }
  if (schedule === "semi-monthly") {
    const halfOf = (d: Date) => (d.getDate() <= 15 ? 0 : 1);
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      halfOf(a) === halfOf(b)
    );
  }
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth(); // monthly
}

// Steps `d` back to the start of the previous billing period for `schedule`
// — the inverse of nextPeriodStart.
export function previousPeriodStart(schedule: string, d: Date): Date {
  const n = new Date(d);
  n.setDate(n.getDate() - scheduleIntervalDays(schedule));
  return n;
}

// Returns the `count` consecutive billing periods ending with the one
// containing `endDate` (oldest first), each paired with that period's
// charge. Used to itemize exactly which day(s)/period(s) a payment is
// covering — e.g. a tenant who misses 3 daily payments and then pays on the
// 4th day sees all 4 days listed individually on the receipt, not one lump
// sum, so the total is self-explanatory.
export function consecutivePeriodsEnding(
  dailyRate: number,
  schedule: string,
  endDate: Date,
  count: number,
): { date: Date; amount: number }[] {
  const periods: { date: Date; amount: number }[] = [];
  let cursor = new Date(endDate);
  for (let i = 0; i < Math.max(count, 0); i++) {
    periods.push({ date: new Date(cursor), amount: computePeriodCharge(dailyRate, schedule, cursor) });
    cursor = previousPeriodStart(schedule, cursor);
  }
  return periods.reverse();
}

// Human-readable label for a single billing period's start date, used as a
// breakdown line item on the receipt.
export function periodLabel(schedule: string, date: Date): string {
  return `${scheduleDayLabel(schedule)} rent from ${date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
}
