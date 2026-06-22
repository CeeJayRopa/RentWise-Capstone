import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const db = getFirestore();

// ─────────────────────────────────────────────────────────────────────────────
// MOCK SMS SENDER
// Logs to console + writes to sms_logs. No real SMS is sent.
// ─────────────────────────────────────────────────────────────────────────────
async function sendSMS(
  number: string,
  message: string,
  tenantId?: string,
): Promise<void> {
  console.log(`[SMS MOCK] To: ${number} | ${message}`);

  await db.collection('sms_logs').add({
    to: number,
    message,
    sentAt: FieldValue.serverTimestamp(),
    status: 'mock',
    ...(tenantId && { tenantId }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// RETRY WRAPPER
// Max 3 attempts, 2-second delay between attempts.
// ─────────────────────────────────────────────────────────────────────────────
export async function sendSMSWithRetry(
  number: string,
  message: string,
  tenantId?: string,
): Promise<void> {
  const MAX_ATTEMPTS = 3;
  const DELAY_MS = 2000;

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`[RETRY] Attempt ${attempt} for ${number}`);
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }

      await sendSMS(number, message, tenantId);
      return; // success — exit immediately
    } catch (err) {
      lastError = err;
    }
  }

  console.log(
    `[FAILED] Could not send SMS to ${number} after ${MAX_ATTEMPTS} attempts`,
  );
  throw lastError;
}
