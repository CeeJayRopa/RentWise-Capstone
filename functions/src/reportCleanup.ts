import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';

// Firestore caps a single batch write at 500 operations -- chunk deletes so
// a month with more than 500 stale reports doesn't silently fail on commit.
const BATCH_LIMIT = 500;

// ─────────────────────────────────────────────────────────────────────────────
// DAILY REPORT CLEANUP
//
// The Owner's Daily Reports screen lists every `updates` doc with
// approvalStatus == "approved". Reports should not accumulate forever --
// once a report is more than 30 days old (a true rolling window, not a
// calendar-month cutoff), it's permanently deleted.
//
// Runs daily at 12:10 AM Asia/Manila, deleting whatever has newly crossed
// the 30-day threshold since the previous run.
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
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // Filtered in-memory (rather than a second `where` on createdAt) so this
      // doesn't depend on a composite Firestore index being provisioned.
      const snap = await db
        .collection('updates')
        .where('approvalStatus', '==', 'approved')
        .get();

      const stale = snap.docs.filter((d) => {
        const createdAt = d.get('createdAt');
        const date: Date | null = createdAt?.toDate ? createdAt.toDate() : null;
        return date != null && date < cutoff;
      });

      if (stale.length === 0) {
        console.log('[REPORT CLEANUP] No reports older than 30 days.');
        return;
      }

      for (let i = 0; i < stale.length; i += BATCH_LIMIT) {
        const chunk: QueryDocumentSnapshot[] = stale.slice(i, i + BATCH_LIMIT);
        const batch = db.batch();
        chunk.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }

      console.log(`[REPORT CLEANUP] Deleted ${stale.length} report(s) older than ${cutoff.toDateString()}.`);
    } catch (error) {
      console.log(error);
    }
  },
);
