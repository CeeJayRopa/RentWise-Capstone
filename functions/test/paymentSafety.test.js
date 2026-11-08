const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ownsPaymentCreationLock,
  paymentApprovalBindingMatches,
  providerPaymentMatches,
  paymentIntervalDaysFor,
  advancePaymentLimitFor,
  billingPeriodsDueAt,
} = require("../lib/paymentSafety");

test("provider approval requires succeeded status, exact amount, and PHP", () => {
  assert.equal(providerPaymentMatches({status: "succeeded", amount: 60000, currency: "PHP"}, 60000), true);
  assert.equal(providerPaymentMatches({status: "processing", amount: 60000, currency: "PHP"}, 60000), false);
  assert.equal(providerPaymentMatches({status: "succeeded", amount: 59900, currency: "PHP"}, 60000), false);
  assert.equal(providerPaymentMatches({status: "succeeded", amount: 60000, currency: "USD"}, 60000), false);
});

test("cash and approval billing cadence calculations remain compatible", () => {
  assert.equal(paymentIntervalDaysFor("daily"), 1);
  assert.equal(paymentIntervalDaysFor("weekly"), 7);
  assert.equal(paymentIntervalDaysFor("semi-monthly"), 15);
  assert.equal(paymentIntervalDaysFor("monthly"), 30);
  assert.equal(advancePaymentLimitFor("daily"), 365);
  assert.equal(advancePaymentLimitFor("monthly"), 12);
  assert.equal(billingPeriodsDueAt(new Date("2026-10-01T00:00:00Z"), 1, new Date("2026-10-03T00:00:00Z")), 3);
  assert.equal(billingPeriodsDueAt(new Date("2026-11-01T00:00:00Z"), 30, new Date("2026-10-03T00:00:00Z")), 0);
});

test("stale creation owners fail the fencing-token check", () => {
  assert.equal(ownsPaymentCreationLock({state: "creating", creationToken: "new"}, "old"), false);
  assert.equal(ownsPaymentCreationLock({state: "active", creationToken: "token"}, "token"), false);
  assert.equal(ownsPaymentCreationLock({state: "creating", creationToken: "token"}, "token"), true);
});

test("Admin approval binding rejects tenant, amount, method, session, and payment mismatches", () => {
  const base = {
    payment: {status: "pending", method: "online", userId: "tenant-1", amount: 600, checkoutSessionId: "pi_1"},
    session: {userId: "tenant-1", amount: 600, paymentId: "payment-1"},
    paymentId: "payment-1",
    checkoutSessionId: "pi_1",
    userId: "tenant-1",
    amountCentavos: 60000,
  };
  assert.equal(paymentApprovalBindingMatches(base), true);
  for (const payment of [
    {...base.payment, status: "approved"},
    {...base.payment, method: "cash"},
    {...base.payment, userId: "tenant-2"},
    {...base.payment, amount: 1},
    {...base.payment, checkoutSessionId: "pi_other"},
  ]) assert.equal(paymentApprovalBindingMatches({...base, payment}), false);
  assert.equal(paymentApprovalBindingMatches({...base, session: {...base.session, paymentId: "payment-other"}}), false);
});
