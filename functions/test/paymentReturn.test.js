const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const handlerPath = path.resolve(__dirname, "../../paymongo-api/api/payment-return.js");

async function redirectFor(attributes, options = {}) {
  const priorFetch = global.fetch;
  const priorSecret = process.env.PAYMONGO_SECRET_KEY;
  process.env.PAYMONGO_SECRET_KEY = "sk_test_mock";
  global.fetch = async () => ({
    ok: options.ok !== false,
    status: options.status ?? 200,
    json: async () => ({ data: { attributes } }),
  });
  delete require.cache[handlerPath];
  const handler = require(handlerPath);
  let location = "";
  await handler(
    { query: { amount: "10000", pi: "pi_mock123" } },
    { writeHead: (_status, headers) => { location = headers.Location; }, end: () => {} },
  );
  global.fetch = priorFetch;
  process.env.PAYMONGO_SECRET_KEY = priorSecret;
  return location;
}

test("return endpoint confirms only succeeded", async () => {
  assert.match(await redirectFor({ status: "succeeded" }), /^rentwise:\/\/\/payment-success\?returnStatus=success/);
  assert.match(await redirectFor({ status: "processing" }), /^rentwise:\/\/\/payment-success\?returnStatus=processing/);
});

test("return endpoint keeps transient failures neutral and identifies cancellation", async () => {
  assert.match(await redirectFor({ status: "awaiting_payment_method", last_payment_error: {} }), /returnStatus=pending/);
  assert.match(await redirectFor({ status: "awaiting_payment_method" }), /returnStatus=pending/);
  assert.match(await redirectFor({ status: "cancelled" }), /returnStatus=cancelled/);
  assert.match(await redirectFor({}, { ok: false, status: 503 }), /returnStatus=pending/);
});
