import {onSchedule} from "firebase-functions/v2/scheduler";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {semaphoreApiKey, sendSMSWithRetry} from "./smsService";
import {getOutstandingBalance, isPaymentDue} from "./paymentChecker";

const DEFAULT_REMINDER_HOUR = 14;
const DEFAULT_REMINDER_MINUTE = 30;
const RETRY_LEASE_MS = 5 * 60_000;
const NOTIFICATION_RETENTION_MS = 180 * 24 * 60 * 60_000;

function normalizedReminderSlot(hourValue: unknown, minuteValue: unknown): {hour: number; minute: 0 | 30} {
  let hour = Number.isInteger(Number(hourValue)) ? Number(hourValue) : DEFAULT_REMINDER_HOUR;
  const minute = Number.isFinite(Number(minuteValue)) ? Number(minuteValue) : DEFAULT_REMINDER_MINUTE;
  hour = ((hour % 24) + 24) % 24;
  if (minute >= 45) return {hour: (hour + 1) % 24, minute: 0};
  return {hour, minute: minute >= 15 ? 30 : 0};
}

function scheduleDays(schedule: string): number {
  if (schedule === "daily") return 1;
  if (schedule === "weekly") return 7;
  if (schedule === "semi-monthly") return 15;
  return 30;
}

function localDayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

function reminderPeriodKey(schedule: string, nextDueAt: Date, now: Date): string {
  const intervalIndex = Math.max(
    0,
    Math.floor((localDayNumber(now) - localDayNumber(nextDueAt)) / scheduleDays(schedule)),
  );
  return `${localDayNumber(nextDueAt)}-${schedule}-${intervalIndex}`;
}

export const sendPaymentReminders = onSchedule(
  {
    schedule: "*/30 * * * *",
    timeZone: "Asia/Manila",
    maxInstances: 1,
    secrets: [semaphoreApiKey],
  },
  async () => {
    const db = getFirestore();
    try {
      const configSnap = await db.doc("settings/reminderSchedule").get();
      const configured = normalizedReminderSlot(configSnap.data()?.hour, configSnap.data()?.minute);
      const nowManila = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Manila"}));
      if (nowManila.getHours() !== configured.hour || nowManila.getMinutes() !== configured.minute) return;

      const tenantsSnap = await db.collection("users")
        .where("role", "==", "tenant")
        .where("status", "==", "active")
        .get();

      for (const tenantDoc of tenantsSnap.docs) {
        try {
          const tenant = tenantDoc.data();
          const tenantId = tenantDoc.id;
          const schedule = String(tenant.paymentSchedule ?? "monthly");
          const storedNextDue = tenant.nextDueAt ?? tenant.billingStartedAt ?? tenant.createdAt;
          const nextDueAt: Date | null = storedNextDue?.toDate ? storedNextDue.toDate() : null;
          if (!nextDueAt) continue;

          const due = await isPaymentDue(
            tenantId,
            schedule,
            Number(tenant.price ?? 0),
            nowManila,
            nextDueAt,
          );
          if (!due) continue;

          const stallSnap = tenant.stallId
            ? await db.collection("stalls").doc(String(tenant.stallId)).get()
            : null;
          const stall = stallSnap?.data() ?? {};
          const fullName = [tenant.firstName, tenant.middleName, tenant.lastName].filter(Boolean).join(" ");
          const outstandingBalance = await getOutstandingBalance(
            tenantId,
            schedule,
            Number(tenant.price ?? 0),
            nowManila,
            nextDueAt,
          );

          const logId = `${tenantId}_${reminderPeriodKey(schedule, nextDueAt, nowManila)}`;
          const reminderRef = db.collection("reminder_logs").doc(logId);
          const channelState = await db.runTransaction(async (transaction) => {
            const existing = await transaction.get(reminderRef);
            const data = existing.data() ?? {};
            const smsDone = data.smsStatus === "accepted" || data.smsStatus === "skipped";
            const notificationDone = data.notificationStatus === "created";
            if (smsDone && notificationDone) return {claimed: false, smsDone, notificationDone};
            if (data.status === "sending" && Number(data.leaseUntil ?? 0) > Date.now()) {
              return {claimed: false, smsDone, notificationDone};
            }
            transaction.set(reminderRef, {
              tenantId,
              schedule,
              dueAt: storedNextDue,
              status: "sending",
              leaseUntil: Date.now() + RETRY_LEASE_MS,
              lastAttemptAt: FieldValue.serverTimestamp(),
            }, {merge: true});
            return {claimed: true, smsDone, notificationDone};
          });
          if (!channelState.claimed) continue;

          let notificationDone = channelState.notificationDone;
          if (!notificationDone) {
            try {
              const notificationRef = db.collection("notifications").doc(`${logId}_inapp`);
              const notificationSnap = await notificationRef.get();
              const overdueDays = Math.max(0, localDayNumber(nowManila) - localDayNumber(nextDueAt));
              const duePhrase = overdueDays === 0
                ? "is due today"
                : `is ${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue`;
              if (!notificationSnap.exists) {
                await notificationRef.create({
                  userId: tenantId,
                  type: "payment_reminder",
                  category: "payment",
                  route: "/(tabs)/payments",
                  message: `Hi ${fullName}, your ${schedule} rent for ${stall.spaceId ? `Stall ${stall.spaceId}` : "your assigned space"} ${duePhrase}. Please settle your payment with the admin at the Admin Office.`,
                  read: false,
                  createdAt: FieldValue.serverTimestamp(),
                  expiresAt: Date.now() + NOTIFICATION_RETENTION_MS,
                  reminderLogId: logId,
                });
              }
              notificationDone = true;
              await reminderRef.set({notificationStatus: "created"}, {merge: true});
            } catch (error) {
              await reminderRef.set({notificationStatus: "failed"}, {merge: true});
              console.error("[NOTIFICATION FAILED]", {tenantId, error});
            }
          }

          const smsMessage = [
            "Mahalagang Paalala Ukol sa Bayad sa Pwesto sa Palengke",
            "",
            `Magandang araw, ${fullName}! Ang natitirang balanse mo ay ₱${outstandingBalance.toLocaleString("en-PH", {minimumFractionDigits: 2, maximumFractionDigits: 2})}.`,
            "",
            "Maaari itong bayaran sa RentWise app o sa Admin Office. Kung nakapagbayad na, maaari mong balewalain ang abisong ito. Salamat!",
          ].join("\n");

          let smsDone = channelState.smsDone;
          if (!smsDone && !tenant.contactNo) {
            smsDone = true;
            await reminderRef.set({smsStatus: "skipped", smsReason: "missing-contact"}, {merge: true});
          } else if (!smsDone) {
            try {
              const result = await sendSMSWithRetry(tenant.contactNo, smsMessage, tenantId, "payment-reminder");
              smsDone = true;
              await reminderRef.set({
                smsStatus: "accepted",
                providerMessageId: result.providerMessageId,
                providerStatus: result.providerStatus,
                smsAttempts: result.attempts,
              }, {merge: true});
            } catch (error) {
              await reminderRef.set({
                smsStatus: "failed",
                smsError: error instanceof Error ? error.message : "Unknown error",
              }, {merge: true});
              console.error("[SMS FAILED]", {tenantId, error});
            }
          }

          await reminderRef.set({
            status: smsDone && notificationDone ? "complete" : "partial",
            leaseUntil: 0,
            completedAt: smsDone && notificationDone ? FieldValue.serverTimestamp() : null,
          }, {merge: true});
        } catch (error) {
          console.error("[TENANT REMINDER FAILED]", {tenantId: tenantDoc.id, error});
        }
      }
    } catch (error) {
      console.error("[SCHEDULER FAILED]", error);
      throw error;
    }
  },
);
