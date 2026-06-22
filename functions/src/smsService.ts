import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const db = getFirestore();

// ─────────────────────────────────────────────────────────────────────────────
// MOCK SMS SENDER
// MOCK SMS ENABLED FOR DEMO
// Prevents Semaphore SMS charges
// Uncomment Semaphore API integration for production
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

  // PRODUCTION ONLY - ENABLE AFTER ADDING SEMAPHORE API KEY
  /*
  const SEMAPHORE_API_KEY = process.env.SEMAPHORE_API_KEY ?? '';
  const params = new URLSearchParams();
  params.append('apikey', SEMAPHORE_API_KEY);
  params.append('number', number);
  params.append('message', message);
  params.append('sendername', 'RentWise');

  const response = await fetch('https://api.semaphore.co/api/v4/messages', {
    method: 'POST',
    body: params,
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Semaphore SMS failed: ${response.status} ${errBody}`);
  }
  */
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
