const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyPaymentAttempt, isRetryableAttempt } = require("../lib/paymentAttemptStatus");

test("maps authoritative PayMongo states without treating processing as paid", () => {
  assert.equal(classifyPaymentAttempt({ status: "succeeded" }, false), "paid");
  assert.equal(classifyPaymentAttempt({ status: "processing" }, true), "processing");
  assert.equal(classifyPaymentAttempt({ status: "cancelled" }, false), "cancelled");
  assert.equal(classifyPaymentAttempt({ status: "awaiting_payment_method", last_payment_error: {} }, false), "pending");
  assert.equal(classifyPaymentAttempt({ status: "awaiting_payment_method", last_payment_error: {} }, true), "failed");
});

test("expires only unresolved local sessions and preserves active pending", () => {
  assert.equal(classifyPaymentAttempt({ status: "awaiting_next_action" }, false), "pending");
  assert.equal(classifyPaymentAttempt({ status: "awaiting_next_action" }, true), "pending");
  assert.equal(classifyPaymentAttempt({ status: "awaiting_payment_method" }, true), "expired");
  assert.equal(classifyPaymentAttempt({ status: "succeeded" }, true), "paid");
  assert.equal(classifyPaymentAttempt({ status: "awaiting_next_action" }, false, "expired"), "pending");
  assert.equal(classifyPaymentAttempt({ status: "succeeded" }, false, "expired"), "paid");
  assert.equal(classifyPaymentAttempt({ status: "awaiting_payment_method" }, false, "failed"), "pending");
});

test("only terminal unsuccessful attempts allow a new payment session", () => {
  for (const status of ["expired", "failed", "cancelled"]) assert.equal(isRetryableAttempt(status), true);
  for (const status of ["pending", "processing", "paid"]) assert.equal(isRetryableAttempt(status), false);
});
