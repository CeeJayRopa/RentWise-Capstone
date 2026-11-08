const test = require('node:test');
const assert = require('node:assert/strict');
const {effectiveNextDueFromApprovedPayments} = require('../lib/paymentChecker');

const timestamp = (iso) => ({toDate: () => new Date(iso)});

test('uses approved payment coverage when the tenant nextDueAt is stale', () => {
  const stale = new Date('2026-11-04T00:00:00.000Z');
  const result = effectiveNextDueFromApprovedPayments(stale, [
    {status: 'approved', paidThroughAt: timestamp('2026-11-06T00:00:00.000Z')},
  ]);
  assert.equal(result.toISOString(), '2026-11-06T00:00:00.000Z');
});

test('does not let an older approved payment move a tenant backward', () => {
  const current = new Date('2026-11-10T00:00:00.000Z');
  const result = effectiveNextDueFromApprovedPayments(current, [
    {status: 'approved', nextDueAt: timestamp('2026-11-06T00:00:00.000Z')},
  ]);
  assert.equal(result.toISOString(), '2026-11-10T00:00:00.000Z');
});

test('ignores pending or failed payment coverage as proof of payment', () => {
  const current = new Date('2026-11-04T00:00:00.000Z');
  const result = effectiveNextDueFromApprovedPayments(current, [
    {status: 'pending', paidThroughAt: timestamp('2026-11-12T00:00:00.000Z')},
    {status: 'failed', paidThroughAt: timestamp('2026-11-15T00:00:00.000Z')},
  ]);
  assert.equal(result.toISOString(), '2026-11-04T00:00:00.000Z');
});
