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

// The admin always enters the stall's DAILY rate. Every schedule's period
// charge is derived by multiplying that daily rate by however many days
// fall in the period containing `date` (weekly is always 7 days; monthly
// and semi-monthly vary with the actual calendar, e.g. Feb vs. Jan).
export function computePeriodCharge(dailyRate: number, schedule: string, date: Date): number {
  if (schedule === "daily") return dailyRate;
  if (schedule === "weekly") return dailyRate * 7;
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  if (schedule === "semi-monthly") {
    const daysInHalf = date.getDate() <= 15 ? 15 : daysInMonth - 15;
    return dailyRate * daysInHalf;
  }
  return dailyRate * daysInMonth; // monthly
}

// How many days make up one billing period for `schedule`, as of `date` —
// used only to show the tenant the "X days × ₱rate" breakdown behind a
// charge, mirroring computePeriodCharge's own day-count logic.
export function periodDayCount(schedule: string, date: Date): number {
  if (schedule === "daily") return 1;
  if (schedule === "weekly") return 7;
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  if (schedule === "semi-monthly") {
    return date.getDate() <= 15 ? 15 : daysInMonth - 15;
  }
  return daysInMonth; // monthly
}

// Advances `d` to the start of the next billing period for `schedule`.
export function nextPeriodStart(schedule: string, d: Date): Date {
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
// month through today's period, inclusive. A period counts in full the
// moment it starts — it isn't prorated by how many days into it "today" is
// — so a weekly tenant on day 3 (still inside week 1) owes exactly one
// week's rent (₱1,169), not a 3-day fraction. For "daily" this naturally
// reduces to dailyRate × day-of-month, since each day is its own period.
// The trailing period is capped at the month's last day (e.g. a weekly
// tenant's 5th "week" of a 31-day month is really only 3 days) so the
// running total never overshoots — and stays equal to — the month's total
// charge (dailyRate × daysInMonth) once every period has started.
export function chargedSinceMonthStart(dailyRate: number, schedule: string, today: Date): number {
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
  if (schedule === "daily") {
    n.setDate(n.getDate() - 1);
    return n;
  }
  if (schedule === "weekly") {
    n.setDate(n.getDate() - 7);
    return n;
  }
  if (schedule === "semi-monthly") {
    if (n.getDate() > 15) {
      n.setDate(1);
      return n;
    }
    n.setMonth(n.getMonth() - 1);
    const daysInPrevMonth = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
    n.setDate(Math.min(16, daysInPrevMonth));
    return n;
  }
  n.setMonth(n.getMonth() - 1);
  n.setDate(1);
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
  if (schedule === "daily") {
    return `Daily Rent (${date.toLocaleDateString("en-US", { month: "long", day: "numeric" })})`;
  }
  if (schedule === "weekly") {
    return `Weekly Rent (week of ${date.toLocaleDateString("en-US", { month: "long", day: "numeric" })})`;
  }
  if (schedule === "semi-monthly") {
    const half = date.getDate() <= 15 ? "1st half" : "2nd half";
    return `Rent – ${half} of ${date.toLocaleDateString("en-US", { month: "long" })}`;
  }
  return `Monthly Rent (${date.toLocaleDateString("en-US", { month: "long", year: "numeric" })})`;
}
