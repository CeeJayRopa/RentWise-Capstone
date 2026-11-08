const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {assertFails, assertSucceeds, initializeTestEnvironment} = require("@firebase/rules-unit-testing");
const {deleteDoc, doc, getDoc, setDoc, updateDoc} = require("firebase/firestore");

let env;

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "rentwise-payment-rules-test",
    firestore: {rules: fs.readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8")},
  });
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "users/admin-1"), {role: "admin"}),
      setDoc(doc(db, "users/owner-1"), {role: "owner"}),
      setDoc(doc(db, "users/tenant-1"), {role: "tenant"}),
      setDoc(doc(db, "users/tenant-2"), {role: "tenant"}),
      setDoc(doc(db, "payments/payment-1"), {userId: "tenant-1", amount: 600, status: "pending", method: "online"}),
      setDoc(doc(db, "paymentSessions/pi_1"), {userId: "tenant-1", amount: 600}),
      setDoc(doc(db, "paymentAttemptLocks/tenant-1"), {state: "active"}),
      setDoc(doc(db, "paymongoWebhookEvents/evt_1"), {eventType: "payment.paid"}),
    ]);
  });
});

test.after(async () => {
  if (env) await env.cleanup();
});

test("payment reads remain role-compatible", async () => {
  const tenant = env.authenticatedContext("tenant-1").firestore();
  const otherTenant = env.authenticatedContext("tenant-2").firestore();
  const admin = env.authenticatedContext("admin-1").firestore();
  const owner = env.authenticatedContext("owner-1").firestore();
  await assertSucceeds(getDoc(doc(tenant, "payments/payment-1")));
  await assertFails(getDoc(doc(otherTenant, "payments/payment-1")));
  await assertSucceeds(getDoc(doc(admin, "payments/payment-1")));
  await assertSucceeds(getDoc(doc(owner, "payments/payment-1")));
});

test("Tenant, Admin, and Owner clients cannot create, alter, or delete payments", async () => {
  for (const uid of ["tenant-1", "admin-1", "owner-1"]) {
    const db = env.authenticatedContext(uid).firestore();
    await assertFails(setDoc(doc(db, `payments/forged-${uid}`), {userId: "tenant-1", amount: 1, status: "approved"}));
    await assertFails(updateDoc(doc(db, "payments/payment-1"), {status: "approved", amount: 1}));
    await assertFails(deleteDoc(doc(db, "payments/payment-1")));
  }
  assert.ok(true);
});

test("server-only payment internals deny every client role", async () => {
  for (const uid of ["tenant-1", "admin-1", "owner-1"]) {
    const db = env.authenticatedContext(uid).firestore();
    for (const target of ["paymentSessions/pi_1", "paymentAttemptLocks/tenant-1", "paymongoWebhookEvents/evt_1"]) {
      await assertFails(getDoc(doc(db, target)));
      await assertFails(setDoc(doc(db, target), {tampered: true}, {merge: true}));
    }
  }
});
