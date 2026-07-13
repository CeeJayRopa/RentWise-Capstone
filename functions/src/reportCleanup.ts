import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';

// ─────────────────────────────────────────────────────────────────────────────
// DAILY REPORT CLEANUP
//
// The Owner's Daily Reports screen lists every `updates` doc with
// approvalStatus == "approved". Reports should not accumulate forever —
// once the calendar rolls into a new month, any report created before the
// start of the current month is permanently deleted. E.g. on Aug 1, every
// report from July (or earlier) is removed.
//
// Runs daily at 12:10 AM Asia/Manila — cheap no-op on days that aren't the
// 1st of the month for any report, since the cutoff is always "start of
// the current month" regardless of what day it runs.
// ─────────────────────────────────────────────────────────────────────────────
export const cleanupOldDailyReports = onSchedule(
  {
    schedule: '10 0 * * *',
    timeZone: 'Asia/Manila',
    maxInstances: 1,
  },
  async () => {
    try {
      const db = getFirestore();
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      // Filtered in-memory (rather than a second `where` on createdAt) so this
      // doesn't depend on a composite Firestore index being provisioned.
      const snap = await db
        .collection('updates')
        .where('approvalStatus', '==', 'approved')
        .get();

      const stale = snap.docs.filter((d) => {
        const createdAt = d.get('createdAt');
        const date: Date | null = createdAt?.toDate ? createdAt.toDate() : null;
        return date != null && date < startOfMonth;
      });

      if (stale.length === 0) {
        console.log('[REPORT CLEANUP] No reports older than the current month.');
        return;
      }

      const batch = db.batch();
      stale.forEach((d) => batch.delete(d.ref));
      await batch.commit();

      console.log(`[REPORT CLEANUP] Deleted ${stale.length} report(s) older than ${startOfMonth.toDateString()}.`);
    } catch (error) {
      console.log(error);
    }
  },
);
