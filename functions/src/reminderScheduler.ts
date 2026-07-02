import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { sendSMSWithRetry } from './smsService';
import { isPaymentDue, hasReminderBeenSent } from './paymentChecker';

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT REMINDER SCHEDULER
//
// Runs daily at 3:00 PM Asia/Manila (Philippine Time).
// Firebase Cloud Scheduler resolves the cron in the given timezone natively —
// no manual UTC offset calculation is needed.
//
// Cron: "0 15 * * *"  →  minute=0, hour=15 (3 PM), every day
// ─────────────────────────────────────────────────────────────────────────────
export const sendPaymentReminders = onSchedule(
  {
    schedule: '0 15 * * *',
    timeZone: 'Asia/Manila',
    maxInstances: 1,
  },
  async () => {
    // ── Top-level guard ───────────────────────────────────────────────────────
    try {
      const db = getFirestore();
      const tenantsSnap = await db
        .collection('users')
        .where('role', '==', 'tenant')
        .where('status', '==', 'active')
        .get();

      console.log(
        `[SCHEDULER] Running reminder check for ${tenantsSnap.size} active tenant(s)`,
      );

      // ── Per-tenant loop ─────────────────────────────────────────────────────
      for (const tenantDoc of tenantsSnap.docs) {
        try {
          const tenant = tenantDoc.data();
          const tenantId = tenantDoc.id;

          // ── Skip: no phone number ─────────────────────────────────────────
          if (!tenant.contactNo) {
            console.log(`[SKIP] No phone for tenant: ${tenantId}`);
            continue;
          }

          // ── Skip: no stall reference ──────────────────────────────────────
          if (!tenant.stallId) {
            console.log(`[SKIP] No stall found for tenant: ${tenantId}`);
            continue;
          }

          const stallDoc = await db
            .collection('stalls')
            .doc(tenant.stallId)
            .get();

          if (!stallDoc.exists) {
            console.log(`[SKIP] No stall found for tenant: ${tenantId}`);
            continue;
          }

          const stall = stallDoc.data()!;
          const schedule: string = stall.paymentSchedule ?? 'monthly';

          // ── Skip: already paid for this period ────────────────────────────
          const due = await isPaymentDue(tenantId, schedule);
          if (!due) continue;

          // ── Skip: reminder already sent this period ───────────────────────
          const alreadySent = await hasReminderBeenSent(tenantId, schedule);
          if (alreadySent) continue;

          // ── Build SMS message ─────────────────────────────────────────────
          const fullName =
            `${tenant.firstName ?? ''} ${tenant.lastName ?? ''}`.trim();

          const message = [
            'RentWise Reminder:',
            '',
            `Hello ${fullName},`,
            '',
            `Your stall rental payment for Space ${stall.spaceId} is currently unpaid.`,
            '',
            'Please settle your payment at Ka Domeng Talipapa Wet and Dry Market.',
            '',
            'Thank you.',
          ].join('\n');

          // ── Send with retry ───────────────────────────────────────────────
          try {
            await sendSMSWithRetry(tenant.contactNo, message, tenantId);

            // Record that a reminder was sent so duplicates are blocked
            await db.collection('reminder_logs').add({
              tenantId,
              schedule,
              sentAt: FieldValue.serverTimestamp(),
            });

            // Push in-app notification to Firestore
            await db.collection('notifications').add({
              userId: tenantId,
              message: `Hi ${fullName}, your ${schedule} rent for Space ${stall.spaceId} is due today. Please settle your payment at Ka Domeng Talipapa Wet and Dry Market.`,
              read: false,
              createdAt: FieldValue.serverTimestamp(),
            });

            console.log(
              `[SUCCESS] Reminder sent to ${fullName} at ${tenant.contactNo}`,
            );
          } catch {
            // [FAILED] is already logged inside sendSMSWithRetry
            // Do not rethrow — continue processing remaining tenants
          }
        } catch (tenantError) {
          // One tenant failing must not stop the rest
          console.log(tenantError);
        }
      }
    } catch (error) {
      // Top-level failure (e.g. Firestore query failed)
      console.log(error);
    }
  },
);
