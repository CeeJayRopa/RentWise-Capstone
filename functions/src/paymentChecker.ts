import { getFirestore } from 'firebase-admin/firestore';

// ─────────────────────────────────────────────────────────────────────────────
// PERIOD HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isSameWeek(a: Date, b: Date): boolean {
  const weekStart = (d: Date): Date => {
    const n = new Date(d);
    n.setDate(n.getDate() - n.getDay());
    n.setHours(0, 0, 0, 0);
    return n;
  };
  return weekStart(a).getTime() === weekStart(b).getTime();
}

function isSameMonth(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
  );
}

// Semi-monthly periods split each calendar month into two halves: 1st–15th
// and 16th–end of month.
function isSameSemiMonth(a: Date, b: Date): boolean {
  const halfOf = (d: Date) => (d.getDate() <= 15 ? 0 : 1);
  return isSameMonth(a, b) && halfOf(a) === halfOf(b);
}

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT DUE CHECK
// Returns true  → no approved/pending payment found for the current period
//         false → payment already exists, skip reminder
// ─────────────────────────────────────────────────────────────────────────────
export async function isPaymentDue(
  tenantId: string,
  schedule: string,
): Promise<boolean> {
  // Composite index required in Firestore: userId ASC, status ASC
  const snap = await getFirestore()
    .collection('payments')
    .where('userId', '==', tenantId)
    .where('status', 'in', ['approved', 'pending'])
    .get();

  const now = new Date();

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const paymentDate: Date = data.date?.toDate
      ? data.date.toDate()
      : new Date(data.date);

    let coveredByThisPeriod = false;
    if (schedule === 'daily') coveredByThisPeriod = isSameDay(paymentDate, now);
    if (schedule === 'weekly') coveredByThisPeriod = isSameWeek(paymentDate, now);
    if (schedule === 'semi-monthly') coveredByThisPeriod = isSameSemiMonth(paymentDate, now);
    if (schedule === 'monthly') coveredByThisPeriod = isSameMonth(paymentDate, now);

    if (coveredByThisPeriod) return false; // payment exists → NOT due
  }

  return true; // no payment found for this period → IS due
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
    periodStart = new Date(now);
    periodStart.setDate(periodStart.getDate() - periodStart.getDay());
    periodStart.setHours(0, 0, 0, 0);
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
