const test = require("node:test");
const assert = require("node:assert/strict");
const {createHmac} = require("node:crypto");
const {
  parsePaymongoWebhookEvent,
  mayApplyUnsuccessfulWebhook,
  verifyPaymongoWebhookSignature,
} = require("../lib/paymongoWebhook");

function signedPayload(event, secret, timestamp, mode = "test") {
  const raw = Buffer.from(JSON.stringify(event));
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${raw.toString("utf8")}`)
    .digest("hex");
  return {
    raw,
    header: `t=${timestamp},te=${mode === "test" ? signature : ""},li=${mode === "live" ? signature : ""}`,
  };
}

test("verifies realistic test/live signatures and rejects tampering or stale delivery", () => {
  const secret = "whsk_test_fixture";
  const now = 1_800_000_000_000;
  const timestamp = Math.floor(now / 1000);
  const event = {data: {id: "evt_123", attributes: {type: "payment.paid", livemode: false, data: {}}}};
  const testSigned = signedPayload(event, secret, timestamp, "test");
  assert.equal(verifyPaymongoWebhookSignature(testSigned.raw, testSigned.header, secret, false, now).valid, true);
  const liveEvent = {data: {id: "evt_456", attributes: {type: "payment.paid", livemode: true, data: {}}}};
  const liveSigned = signedPayload(liveEvent, secret, timestamp, "live");
  assert.equal(verifyPaymongoWebhookSignature(liveSigned.raw, liveSigned.header, secret, true, now).valid, true);
  assert.equal(verifyPaymongoWebhookSignature(Buffer.from("{}"), testSigned.header, secret, false, now).valid, false);
  assert.equal(verifyPaymongoWebhookSignature(testSigned.raw, testSigned.header, secret, false, now + 301_000).reason, "stale");
});

test("late failed or expired deliveries cannot downgrade a successful session", () => {
  assert.equal(mayApplyUnsuccessfulWebhook("used", "paid"), false);
  assert.equal(mayApplyUnsuccessfulWebhook("created", "paid"), false);
  assert.equal(mayApplyUnsuccessfulWebhook("created", "pending"), true);
});

test("maps paid, failed, and QR expiry payloads to their Payment Intent", () => {
  const paid = parsePaymongoWebhookEvent({data: {id: "evt_paid", attributes: {
    type: "payment.paid", livemode: false,
    data: {id: "pay_1", type: "payment", attributes: {payment_intent_id: "pi_paid", amount: 60000, currency: "PHP"}},
  }}});
  assert.deepEqual({id: paid.paymentIntentId, status: paid.attemptStatus}, {id: "pi_paid", status: "paid"});
  const failed = parsePaymongoWebhookEvent({data: {id: "evt_failed", attributes: {
    type: "payment.failed", livemode: false,
    data: {id: "pay_2", type: "payment", attributes: {payment_intent_id: "pi_failed"}},
  }}});
  assert.equal(failed.attemptStatus, "failed");
  const expired = parsePaymongoWebhookEvent({data: {id: "evt_expired", attributes: {
    type: "qrph.expired", livemode: false,
    data: {id: "qrph_1", type: "qrph", attributes: {payment_intent_id: "pi_expired"}},
  }}});
  assert.deepEqual({id: expired.paymentIntentId, status: expired.attemptStatus}, {id: "pi_expired", status: "expired"});
});
