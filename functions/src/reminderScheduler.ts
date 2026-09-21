import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { semaphoreApiKey, sendSMSWithRetry } from './smsService';
import {
  getOutstandingBalance,
  isPaymentDue,
  hasReminderBeenSent,
} from './paymentChecker';

// The admin-configurable send time (rentwise-admin/app/(tabs)/financials.tsx
// writes this doc). Cloud Scheduler's cron is fixed at deploy time -- there's
// no API for the app to change it live -- so instead this function runs every
// minute and immediately exits unless the current Manila time matches the
// configured hour/minute. Falls back to the original default (2:30 PM) if
// the admin has never set one.
const DEFAULT_REMINDER_HOUR = 14;
const DEFAULT_REMINDER_MINUTE = 30;

function getReminderPeriodKey(schedule: string, now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = now.getDate();
  if (schedule === 'daily') return `${year}-${month}-${String(day).padStart(2, '0')}`;
  if (schedule === 'weekly') return `${year}-${month}-w${Math.floor((day - 1) / 7) + 1}`;
  if (schedule === 'semi-monthly') return `${year}-${month}-h${day <= 15 ? 1 : 2}`;
  return `${year}-${month}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT REMINDER SCHEDULER
//
// Ticks every minute, Asia/Manila (Philippine Time), but only actually sends
// reminders once a day, during the single minute that matches the admin's
// configured time (see settings/reminderSchedule below).
// ─────────────────────────────────────────────────────────────────────────────
export const sendPaymentReminders = onSchedule(
  {
    schedule: '* * * * *',
    timeZone: 'Asia/Manila',
    maxInstances: 1,
    secrets: [semaphoreApiKey],
  },
  async () => {
    // ── Top-level guard ───────────────────────────────────────────────────────
    try {
      const db = getFirestore();

      // ── Gate: only proceed during the admin's configured minute ─────────────
      const configSnap = await db.doc('settings/reminderSchedule').get();
      const configuredHour = configSnap.data()?.hour ?? DEFAULT_REMINDER_HOUR;
      const configuredMinute = configSnap.data()?.minute ?? DEFAULT_REMINDER_MINUTE;

      const nowManila = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }),
      );
      if (
        nowManila.getHours() !== configuredHour ||
        nowManila.getMinutes() !== configuredMinute
      ) {
        return;
      }

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
          // Billing terms live on the TENANT, not the stall -- otherwise a
          // relocated tenant gets checked against whoever rented this stall
          // before them. The stall doc is still fetched for its spaceId,
          // used in the SMS message below.
          const schedule: string = tenant.paymentSchedule ?? 'monthly';

          // ── Skip: already paid for this period ────────────────────────────
          // nowManila (not `new Date()`) -- see paymentChecker.ts's comment
          // on isPaymentDue for why passing raw server/UTC time here broke
          // every reminder scheduled between 12:00-7:59 AM Manila time.
          const due = await isPaymentDue(tenantId, schedule, tenant.price ?? 0, nowManila);
          if (!due) continue;

          // ── Skip: reminder already sent this period ───────────────────────
          const alreadySent = await hasReminderBeenSent(tenantId, schedule, nowManila);
          if (alreadySent) continue;

          // ── Build SMS message ─────────────────────────────────────────────
          const fullName =
            `${tenant.firstName ?? ''} ${tenant.lastName ?? ''}`.trim();
          const outstandingBalance = await getOutstandingBalance(
            tenantId,
            schedule,
            tenant.price ?? 0,
            nowManila,
          );

          const message = [
            'Mahalagang Paalala Ukol sa Bayad sa Pwesto sa Palengke',
            '',
            `Magandang araw, ${fullName}! Nais lamang naming ipaalala ang iyong natitirang balanse para sa iyong upa sa palengke, na nagkakahalaga ng ₱${outstandingBalance.toLocaleString('en-PH', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}.`,
            '',
            'Maaari po itong bayaran sa pamamagitan ng ating online payment channels sa app, o magtungo sa opisina ng admin sa oras ng trabaho. Kung nakapagbayad na po, maaari na lamang balewalain ang abisong ito. Maraming salamat po!',
          ].join('\n');

          // ── Send SMS (best-effort) ─────────────────────────────────────────
          const reminderRef = db.collection('reminder_logs').doc(
            `${tenantId}_${schedule}_${getReminderPeriodKey(schedule, nowManila)}`,
          );
          const claimed = await db.runTransaction(async (transaction) => {
            const existing = await transaction.get(reminderRef);
            if (existing.exists) return false;
            transaction.create(reminderRef, {
              tenantId,
              schedule,
              status: 'sending',
              sentAt: FieldValue.serverTimestamp(),
            });
            return true;
          });
          if (!claimed) continue;

          try {
            const smsResult = await sendSMSWithRetry(
              tenant.contactNo,
              message,
              tenantId,
              'payment-reminder',
            );

            await reminderRef.update({
              status: 'accepted',
              providerMessageId: smsResult.providerMessageId,
              providerStatus: smsResult.providerStatus,
              attempts: smsResult.attempts,
            });

            console.log(
              `[SUCCESS] Reminder accepted for tenant ${tenantId}`,
            );
          } catch (smsError) {
            await reminderRef.delete().catch(() => undefined);
            console.error('[SMS FAILED] Reminder was not accepted', {
              tenantId,
              error: smsError instanceof Error ? smsError.message : 'Unknown error',
            });
            // Do not rethrow — continue processing remaining tenants
          }

          // ── Push in-app notification (independent of SMS outcome) ──────────
          // SMS and the in-app notification are two separate delivery
          // channels for the same reminder -- the SMS provider failing
          // (bad number, provider outage, quota) shouldn't silently take
          // the in-app notification down with it. This used to live inside
          // the SMS try block above, so any SMS failure meant the tenant
          // never saw the reminder in-app either.
          try {
            await db.collection('notifications').add({
              userId: tenantId,
              message: `Hi ${fullName}, your ${schedule} rent for Stall ${stall.spaceId} is due today. Please settle your payment with the admin at the Admin Office.`,
              read: false,
              createdAt: FieldValue.serverTimestamp(),
            });
          } catch (notifError) {
            console.log(`[NOTIF FAILED] Could not create in-app notification for ${tenantId}`, notifError);
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
