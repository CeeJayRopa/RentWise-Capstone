import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';

export const semaphoreApiKey = defineSecret('SEMAPHORE_API_KEY');

export type SmsPurpose = 'payment-reminder' | 'password-reset';

export interface SmsSendResult {
  providerMessageId: string;
  providerStatus: string;
  normalizedNumber: string;
  attempts: number;
}

interface SemaphoreMessage {
  message_id?: number | string;
  status?: string;
}

interface SemaphoreError {
  message?: string;
  error?: string;
}

export function normalizePhilippinePhone(number: string): string {
  const digits = String(number ?? '').replace(/\D/g, '');
  if (/^9\d{9}$/.test(digits)) return `0${digits}`;
  if (/^09\d{9}$/.test(digits)) return digits;
  if (/^639\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
  throw new Error('Invalid Philippine mobile number. Expected 09XXXXXXXXX.');
}

function maskPhone(number: string): string {
  return `*********${number.slice(-3)}`;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.slice(0, 300)
    : 'Unknown SMS error';
}

async function writeSmsAudit(data: {
  tenantId?: string;
  purpose: SmsPurpose;
  destination: string;
  status: 'accepted' | 'failed';
  attempts: number;
  providerMessageId?: string;
  providerStatus?: string;
  error?: string;
}): Promise<void> {
  try {
    await getFirestore().collection('sms_logs').add({
      ...data,
      sentAt: FieldValue.serverTimestamp(),
    });
  } catch (auditError) {
    console.error('[SMS AUDIT] Unable to write audit record', {
      purpose: data.purpose,
      destination: data.destination,
      error: safeErrorMessage(auditError),
    });
  }
}

async function sendSMS(
  number: string,
  message: string,
): Promise<Omit<SmsSendResult, 'attempts'>> {
  const normalizedNumber = normalizePhilippinePhone(number);
  const apiKey = semaphoreApiKey.value();
  if (!apiKey) throw new Error('SEMAPHORE_API_KEY secret is not configured.');

  const params = new URLSearchParams({
    apikey: apiKey,
    number: normalizedNumber,
    message,
  });

  const response = await fetch('https://api.semaphore.co/api/v4/messages', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: params,
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Semaphore returned an invalid response (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    throw new Error(`Semaphore rejected the SMS request (HTTP ${response.status}).`);
  }

  // Semaphore's documented examples use an array, but some account/API
  // responses return the single message object directly. Both shapes carry
  // the same message_id/status pair, so accept either instead of treating a
  // successfully accepted SMS as a provider failure.
  const record = (Array.isArray(payload) ? payload[0] : payload) as SemaphoreMessage | undefined;
  if (!record?.message_id || !record.status) {
    const providerError = !Array.isArray(payload) && payload && typeof payload === 'object'
      ? payload as SemaphoreError
      : undefined;
    const detail = providerError?.message || providerError?.error;
    throw new Error(
      detail
        ? `Semaphore rejected the request: ${String(detail).slice(0, 200)}`
        : 'Semaphore did not return a valid message record.',
    );
  }

  return {
    providerMessageId: String(record.message_id),
    providerStatus: String(record.status),
    normalizedNumber,
  };
}

export async function sendSMSWithRetry(
  number: string,
  message: string,
  tenantId: string | undefined,
  purpose: SmsPurpose,
): Promise<SmsSendResult> {
  const maxAttempts = 3;
  const delayMs = 2000;
  let lastError: unknown;
  let normalizedNumber: string;

  try {
    normalizedNumber = normalizePhilippinePhone(number);
  } catch (error) {
    await writeSmsAudit({
      tenantId,
      purpose,
      destination: 'invalid',
      status: 'failed',
      attempts: 0,
      error: safeErrorMessage(error),
    });
    throw error;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const result = await sendSMS(normalizedNumber, message);
      await writeSmsAudit({
        tenantId,
        purpose,
        destination: maskPhone(normalizedNumber),
        status: 'accepted',
        attempts: attempt,
        providerMessageId: result.providerMessageId,
        providerStatus: result.providerStatus,
      });
      console.info('[SMS] Provider accepted message', {
        purpose,
        destination: maskPhone(normalizedNumber),
        providerMessageId: result.providerMessageId,
        providerStatus: result.providerStatus,
        attempts: attempt,
      });
      return {...result, attempts: attempt};
    } catch (error) {
      lastError = error;
      console.warn('[SMS] Send attempt failed', {
        purpose,
        destination: maskPhone(normalizedNumber),
        attempt,
        error: safeErrorMessage(error),
      });
    }
  }

  await writeSmsAudit({
    tenantId,
    purpose,
    destination: maskPhone(normalizedNumber),
    status: 'failed',
    attempts: maxAttempts,
    error: safeErrorMessage(lastError),
  });
  throw lastError instanceof Error ? lastError : new Error('SMS delivery request failed.');
}
