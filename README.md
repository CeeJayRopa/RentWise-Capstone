# RentWise

RentWise is a rental management system for Ka Domeng Talipapa Wet and Dry Market — it lets the market's stall tenants pay rent online, lets admins track payments and manage tenants, and lets the owner oversee admins and approve updates. This repo is an npm-workspaces monorepo containing all of the apps and backend services.

## Structure

| Folder | What it is |
|---|---|
| `rentwise-tenant/` | Expo app for stall tenants — pay rent (GCash/Maya via PayMongo or cash), view payment history and balance, manage profile. |
| `rentwise-admin/` | Expo app for market admins — confirm payments, manage tenants, manage stalls/buildings, view financial reports. |
| `rentwise-owner/` | Expo app for the market owner — manage admin accounts, approve/review admin-submitted updates. |
| `rentwise-guest/` | Expo app for market visitors — browse the wet/dry market layout, stall details, and an AR market view. Not tied to tenant accounts. |
| `functions/` | Firebase Cloud Functions (v2) — payment reminders, admin/owner account-management callables (create/reset-password/disable tenant accounts, reset admin passwords), scheduled jobs. |
| `paymongo-api/` | Small serverless API (deployed on Vercel) that brokers PayMongo payment-intent/checkout requests for the tenant app. |
| `shared/` | Code shared across the four Expo apps (Firebase config, Firestore/service helpers, shared UI). Each app imports it via a thin re-export shim. |

## Tech stack

- Expo / React Native (SDK 56), Expo Router
- Firebase: Firestore, Auth, Cloud Functions (v2), Cloud Scheduler
- PayMongo (GCash/Maya payments)
- Cloudinary (receipt image uploads)
- EAS Build for native builds

## Getting started

This is an npm workspaces monorepo — install once from the repo root:

```bash
npm install
```

Then run any individual app from its own folder, e.g.:

```bash
cd rentwise-tenant
npx expo start
```

Cloud Functions live in `functions/` and deploy independently:

```bash
cd functions
npm run build
firebase deploy --only functions:<functionName>
```

## Notes

- All four Expo apps read the same daily-rate billing model (daily/weekly/semi-monthly/monthly schedules derived from a stall's daily rate) — see `rentwise-tenant/app/dashboard.tsx` for the reference implementation; `rentwise-admin` and `functions/src/paymentChecker.ts` mirror it.
- Some Cloud Functions in `functions/src/index.ts` are marked "BLAZE PLAN ONLY" — they require Firebase's pay-as-you-go plan and are meant to be removed/downgraded after the capstone defense (see comments in `rentwise-admin/shared/services/accountServices.ts`).
