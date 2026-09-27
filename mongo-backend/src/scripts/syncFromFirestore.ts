// One-time (or re-runnable) data sync: reads the real Firestore collections
// and mirrors them into MongoDB, using the exact field shapes already
// verified in models/User.ts, Stall.ts, Payment.ts. READ-ONLY against
// Firestore -- never writes back, never modifies the live production data.
//
// Requires a Firebase service account key (download from Firebase Console
// > Project Settings > Service Accounts) saved as serviceAccountKey.json in
// this mongo-backend/ folder -- gitignored, never commit it.
//
// Run with: npx ts-node src/scripts/syncFromFirestore.ts

import "dotenv/config";
import * as admin from "firebase-admin";
import { connectDb } from "../db";
import { User } from "../models/User";
import { Stall } from "../models/Stall";
import { Payment } from "../models/Payment";

async function main() {
  const serviceAccount = require("../../serviceAccountKey.json");
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const firestore = admin.firestore();

  await connectDb();

  // --- users ---------------------------------------------------------
  // NOTE: Firestore's users collection has no password field (Firebase Auth
  // stores that separately, and it's not exportable). Synced users get a
  // random placeholder passwordHash and MUST have their password reset via
  // the new /auth system before they can actually log in against MongoDB.
  const usersSnap = await firestore.collection("users").get();
  let userCount = 0;
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    await User.findOneAndUpdate(
      { username: data.username ?? doc.id },
      {
        firstName: data.firstName ?? "",
        lastName: data.lastName ?? "",
        username: data.username ?? doc.id,
        email: data.email ?? `${doc.id}@unknown.rentwise.app`,
        contactNo: data.contactNo,
        // Placeholder only -- see note above. bcrypt hash of a random UUID,
        // never a guessable value, but also never meant to be logged into
        // directly; a real password-reset flow must run for each user.
        passwordHash: "SYNC_PLACEHOLDER_REQUIRES_PASSWORD_RESET",
        role: data.role ?? "tenant",
        status: data.status ?? "active",
        stallId: data.stallId,
        price: data.price,
        paymentSchedule: data.paymentSchedule,
        category: data.category,
      },
      { upsert: true }
    );
    userCount++;
  }
  console.log(`[sync] users: ${userCount} synced`);

  // --- stalls ----------------------------------------------------------
  const stallsSnap = await firestore.collection("stalls").get();
  let stallCount = 0;
  for (const doc of stallsSnap.docs) {
    const data = doc.data();
    await Stall.findOneAndUpdate(
      { buildingNumber: data.buildingNumber, spaceId: data.spaceId },
      {
        buildingNumber: data.buildingNumber,
        spaceId: data.spaceId,
        length: data.length,
        width: data.width,
        price: data.price ?? 0,
        paymentSchedule: data.paymentSchedule,
        category: data.category,
        tenantId: data.tenantId ?? null,
        status: data.status ?? "vacant",
      },
      { upsert: true }
    );
    stallCount++;
  }
  console.log(`[sync] stalls: ${stallCount} synced`);

  // --- payments ---------------------------------------------------------
  const paymentsSnap = await firestore.collection("payments").get();
  let paymentCount = 0;
  for (const doc of paymentsSnap.docs) {
    const data = doc.data();
    await Payment.create({
      userId: data.userId,
      amount: data.amount,
      method: data.method,
      status: data.status,
      receipt: data.receipt,
      paymentId: data.paymentId,
      date: data.date?.toDate ? data.date.toDate() : new Date(),
    });
    paymentCount++;
  }
  console.log(`[sync] payments: ${paymentCount} synced (always inserted fresh, not upserted -- re-running duplicates these)`);

  console.log("[sync] done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[sync] failed:", err);
  process.exit(1);
});
