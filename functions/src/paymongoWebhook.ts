import {createHmac, timingSafeEqual} from "crypto";

export type PaymongoWebhookResource = {
  id?: string;
  type?: string;
  attributes?: {
    payment_intent_id?: string;
    amount?: number;
    currency?: string;
  };
};

export type PaymongoWebhookEvent = {
  data?: {
    id?: string;
    attributes?: {
      type?: string;
      livemode?: boolean;
      data?: PaymongoWebhookResource;
    };
  };
};

export function verifyPaymongoWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string,
  webhookSecret: string,
  livemode: boolean,
  nowMs = Date.now(),
): {valid: boolean; reason?: string} {
  const parts = Object.fromEntries(signatureHeader.split(",").map((part) => {
    const separator = part.indexOf("=");
    return separator > 0 ? [part.slice(0, separator).trim(), part.slice(separator + 1).trim()] : [part, ""];
  }));
  const timestamp = String(parts.t ?? "");
  const supplied = String(livemode ? parts.li : parts.te);
  const timestampSeconds = Number(timestamp);
  if (!timestamp || !supplied || !webhookSecret) return {valid: false, reason: "missing"};
  if (!Number.isFinite(timestampSeconds) || Math.abs(nowMs - timestampSeconds * 1000) > 5 * 60_000) {
    return {valid: false, reason: "stale"};
  }
  if (!/^[a-fA-F0-9]{64}$/.test(supplied)) return {valid: false, reason: "malformed"};
  const expected = createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");
  const suppliedBuffer = Buffer.from(supplied, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer)
    ? {valid: true}
    : {valid: false, reason: "mismatch"};
}

export function parsePaymongoWebhookEvent(event: PaymongoWebhookEvent) {
  const eventId = String(event.data?.id ?? "");
  const eventType = String(event.data?.attributes?.type ?? "");
  const resource = event.data?.attributes?.data;
  const paymentIntentId = resource?.type === "payment_intent"
    ? String(resource.id ?? "")
    : String(resource?.attributes?.payment_intent_id ?? "");
  const attemptStatus = eventType === "payment.paid" || eventType === "payment_intent.succeeded"
    ? "paid"
    : eventType === "payment.failed"
      ? "failed"
      : eventType === "qrph.expired"
        ? "expired"
        : null;
  return {eventId, eventType, resource, paymentIntentId, attemptStatus};
}

export function mayApplyUnsuccessfulWebhook(
  sessionStatus: unknown,
  currentAttemptStatus: unknown,
): boolean {
  return sessionStatus !== "used" && currentAttemptStatus !== "paid";
}
