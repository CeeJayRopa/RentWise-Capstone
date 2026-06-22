import { getFirestore } from 'firebase-admin/firestore';

const db = getFirestore();

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
  const snap = await db
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
  } else {
    // monthly
    periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  // Composite index required: tenantId ASC, schedule ASC, sentAt ASC
  const snap = await db
    .collection('reminder_logs')
    .where('tenantId', '==', tenantId)
    .where('schedule', '==', schedule)
    .where('sentAt', '>=', periodStart)
    .limit(1)
    .get();

  return !snap.empty;
}
