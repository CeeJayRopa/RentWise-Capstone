# RentWise Defense Reviewer

Use this as a speaking guide, not a script. Explain the ideas in your own words and demonstrate the matching screen when possible.

## 1. Project at a glance

**RentWise** is a rental-management system for the Ka Domeng Talipapa wet and dry market. It digitizes the workflow from stall discovery through tenant account and rent management, payment recording, reporting, and owner oversight.

The system has **four connected modules** built around one Firebase backend:

| Module | Primary user | Main responsibility |
| --- | --- | --- |
| Tenant app | Stall tenant | View rental information and balance, pay rent, upload receipts, receive reminders, review payment history, and launch the AR Stall Designer. |
| Admin app | Market administrator | Manage tenants, stalls and relocations; record/verify payments; monitor financials; submit operational updates. |
| Owner app | Market owner | Manage administrator accounts, review/approve updates, monitor consolidated reports and archives. |
| Guest app | Public visitor/prospective renter | Browse market/stall information, contact the market, and preview supported 3D objects through a web AR experience. |

The intended outcome is faster, more transparent rental operations: tenants have visibility over what they owe, staff have a centralized record, and the owner has an approval and reporting layer.

## 2. One-minute opening statement

> RentWise is a four-module rental-management system designed for a public market. Instead of maintaining disconnected manual records, it gives each stakeholder a focused interface: tenants manage rent payments, administrators manage stalls and records, the owner reviews and controls administrative changes, and guests can explore the market publicly. All modules share Firebase Authentication, Firestore, security rules, and server-side Cloud Functions, so information is updated centrally and role access is enforced beyond the user interface. We also integrated PayMongo for online checkout, Cloudinary for receipt images, notifications and scheduled rent reminders, and a browser-based AR feature for guest exploration.

## 3. Architecture and pipeline

### High-level architecture

```text
 Tenant Expo app        Admin Expo app        Owner Expo app       Guest Expo web app
       |                      |                      |                    |
       +----------------------+----------------------+--------------------+
                                      |
                         Firebase client SDK / shared services
                                      |
       +------------------------------+------------------------------+
       |                              |                              |
 Firebase Authentication       Cloud Firestore                 Firebase Storage
 identity/session + login      source of truth                 public AR model files
       |                              |
       |                      Firestore Security Rules
       |                              |
       +---------------- Firebase Cloud Functions v2 ----------------+
                        account actions, recovery, scheduled jobs,
                        reminder checks, notification triggers
                                      |
          +---------------------------+--------------------------+
          |                           |                          |
       PayMongo                    Expo/FCM                 Semaphore SMS
     online checkout              push messages             tested reminder delivery
          |
 Vercel PayMongo API (also present as a separate checkout service)

 Cloudinary: receipt-image hosting for the tenant payment flow
```

### General request/data pipeline

1. A user signs in through Firebase Authentication.
2. The app obtains the matching `users/{uid}` document from Firestore, including the role: `tenant`, `admin`, or `owner`.
3. Expo Router sends the user to the role-appropriate screens.
4. The app reads or writes Firestore data through service functions and real-time listeners where freshness matters.
5. Firestore Security Rules independently validate whether that user can make the requested read or write.
6. Sensitive actions—such as privileged account operations, login/recovery lookups, scheduled reminders, and some payment checkout work—run in Cloud Functions with the Admin SDK instead of trusting the device.
7. Database events and scheduled functions create notifications, update records, or send push/SMS reminders.

### Why this structure?

- Separate apps reduce role confusion: a tenant does not ship an admin interface, and the public guest experience needs no account.
- Firebase provides authentication, real-time data, security rules, storage, and serverless functions without operating a conventional server.
- Server-side functions protect actions that should not be performed directly by an untrusted client.
- Firestore listeners allow dashboard/payment changes to appear without manual refresh.

## 4. The four modules

### A. Tenant module — rent payment and visibility

**Purpose:** give a tenant a clear view of their assigned stall, rental terms, current balance, and payment history.

**Key screens/features:**

- Login, password-reset/OTP flow, remembered login, and quick unlock.
- Tenant dashboard showing rental/billing status.
- Payment flow for online methods (GCash/Maya through PayMongo) and receipt capture/upload.
- Payment history and downloadable/shareable receipt presentation.
- Notification center for reminders and updates.
- Profile management and tenant business category updates.
- AR Stall Designer shortcut that opens the working Guest WebAR experience through a Chrome Custom Tab.

**Tenant AR button process:**

```text
Tenant taps the AR button
        -> RentWise opens the Guest AR page using a Chrome Custom Tab
        -> Chrome connects the web experience to the phone's ARCore support
        -> tenant accepts the policies and allows camera access
        -> AR Stall Designer starts
        -> pressing Back closes the browser tab and returns to the Tenant dashboard
```

**Simple presentation line:** When the tenant taps the AR button, RentWise opens the Guest AR page through Chrome. Chrome connects the page to the phone's ARCore, and pressing Back returns the user to the Tenant dashboard.

**Tenant payment process:**

```text
Tenant chooses payment period/method
        -> checkout is requested
        -> PayMongo checkout/deep link is opened for GCash or Maya
        -> app returns to payment-success route
        -> pending payment record is written to Firestore
        -> receipt may be uploaded to Cloudinary
        -> admin verifies/approves the record
        -> tenant dashboard/history reflects the approved payment
```

**Important defense point:** the payment record is separate from the checkout UI. Staff approval provides an operational verification step, particularly for uploaded receipts or cash entries.

### B. Admin module — operational control

**Purpose:** provide administrators with day-to-day management of tenants, stalls, payments, and operational reporting.

**Key screens/features:**

- Dashboard with tenant, occupancy, and financial summaries.
- Tenant management: create/manage tenant accounts, archive/restore records, and inspect tenant details.
- Building/stall management: view stall occupancy and edit rental information.
- Tenant relocation: update a tenant/stall relationship in a controlled batch-style workflow.
- Financials: record cash payments, inspect pending payments, and approve payment entries.
- Reports history and daily operational update reporting to the owner.
- Reminder schedule configuration and notification handling.

**Admin-to-owner update process:**

```text
Admin performs or records a significant operational change
        -> creates an `updates` record and notification
        -> owner receives/reviews the update
        -> owner approves or rejects it
        -> decision/status is stored and related users are notified
        -> approved updates can feed daily reporting/history
```

### C. Owner module — governance and oversight

**Purpose:** let the market owner supervise administrators and review the consolidated condition of rentals and finances.

**Key screens/features:**

- Owner dashboard with tenant, stall, and approved-payment summaries.
- Administrator account management, including reset/profile operations.
- Approval workflow for administrator-submitted updates.
- Financial dashboard and daily-report review.
- Tenant relocation/record actions at the owner level where authorized.
- Archive viewing and notification handling.
- Security-question account-recovery flow.

**Key defense point:** the owner module is not simply another dashboard. It is the governance layer: it can review changes submitted by admins, maintain admin accounts, and access consolidated reporting.

### D. Guest module — public discovery and AR

**Purpose:** offer a public, no-login experience for prospective renters or visitors.

**Key screens/features:**

- Market/home experience and wet/dry market browsing.
- Interactive/navigable market map and stall details sourced from Firestore.
- Public contact form, with server-side-rule validation of submitted fields.
- AR object catalog and placement analytics.
- Web 3D/AR preview, with fallback viewing where immersive AR is unsupported.

**AR pipeline:**

```text
Guest opens AR page in a supported browser
        -> guest selects a 3D object stored/referenced from Firebase
        -> Three.js loads and renders the GLB model
        -> WebXR starts an immersive session when supported
        -> hit testing estimates a surface location
        -> plane/depth/stability checks decide whether placement is safe
        -> colored reticle gives feedback (searching / valid / rejected)
        -> object is placed; anonymized placement event can be recorded
```

**Platform limitation to state clearly:** immersive WebXR placement is browser/device dependent and principally targets Android Chrome. Unsupported browsers receive a non-immersive model-viewing fallback.

## 5. Core technologies and why they were chosen

| Technology | Used for | Defense explanation |
| --- | --- | --- |
| TypeScript | All major app and Cloud Function logic | Reduces avoidable runtime mistakes through static types and improves maintainability. |
| React Native + Expo SDK 56 | Tenant, admin, owner apps; shared mobile development approach | One JavaScript/TypeScript ecosystem for Android-focused delivery; Expo simplifies development and device builds. |
| Expo Router | App navigation | File-based routing keeps navigation aligned with the `app/` folder structure. |
| Expo WebBrowser / Chrome Custom Tabs | Tenant-to-AR handoff | Opens the Guest AR page through Chrome so WebXR can use the phone's ARCore support, while Back returns the tenant to the app. |
| EAS Build | Native build delivery | Produces installable native builds without maintaining local native build infrastructure. |
| Firebase Authentication | Identity, login, sessions | Handles authentication lifecycle securely instead of implementing password/session infrastructure from scratch. |
| Cloud Firestore | Central operational database | Stores users, stalls, payments, notifications, updates, reports, AR records, and settings; supports live listeners. |
| Firestore Security Rules | Data authorization | Enforces access at the database boundary, even if someone modifies the client application. |
| Firebase Cloud Functions v2 + Scheduler | Privileged and scheduled work | Runs account/recovery actions, reminder checks, event triggers, and cleanup server-side. |
| Firebase Storage | AR assets | Hosts AR model files and related public assets; it is intentionally not the receipt store. |
| PayMongo | GCash/Maya checkout | Provides Philippine e-wallet checkout capability through GCash and Maya. |
| Vercel serverless API | Separate PayMongo checkout endpoint | Hosts the `paymongo-api` service independently of Firebase. |
| Cloudinary | Payment receipt images | Handles image upload/hosting for payment proof. |
| Expo Notifications / FCM | Mobile push notifications | Delivers payment and operational alerts to native apps. |
| Semaphore | SMS reminders and password-reset codes | The shared SMS service normalizes Philippine mobile numbers, accepts Semaphore's supported response shapes, retries failed requests up to three times, and writes masked audit records. |
| Three.js + WebXR | Guest 3D/AR experience | Renders models and uses browser AR capabilities such as hit testing and plane detection. |

## 6. Important data collections

| Collection | Purpose |
| --- | --- |
| `users` | Role, profile, tenant/stall relationship, rental terms, account status. |
| `stalls` | Stall identity, availability/occupancy, tenant association and details used by public views. |
| `payments` | Pending, approved, and recorded payment transactions; receipts where applicable. |
| `notifications` | In-app notices for tenants, admins, and owner. |
| `updates` | Administrator-submitted operational updates for owner review. |
| `dailyReports` | Approved/reporting history, with scheduled cleanup support. |
| `archives` | Archived tenant records and restoration workflow. |
| `settings` | Admin-configurable settings, including reminder scheduling. |
| `reminder_logs` | One claim/status record per tenant and billing period, used to prevent duplicate rent reminders. |
| `sms_logs` | Masked SMS audit records containing purpose, provider acceptance status, attempt count, and provider message metadata. |
| `arObjects` | AR model metadata. |
| `arPlacementEvents` | Validated anonymous AR placement analytics. |
| `contactMessages` | Validated public guest inquiries. |
| `passwordResetRequests`, `passwordResetOtps`, `ownerRecovery` | Account recovery workflows; sensitive OTP/recovery collections are Cloud-Function-only. |

## 7. Security reviewer

### Authentication and roles

- Firebase Authentication establishes the authenticated identity.
- The Firestore `users` document contains the application role: tenant, admin, or owner.
- UI routing improves usability, but it is **not** treated as security.
- Firestore rules check the signed-in user and role on each database request.

### Examples of rule enforcement

- Tenants can read their own user record; staff can read operational records as authorized.
- A tenant cannot change their own role, status, rental price, or payment schedule.
- Tenants can only access payment records tied to their own account and can only attach a receipt to their own existing payment.
- Staff manage tenant/stall records and payment approval.
- Public guest collections are restricted: AR objects/stalls are publicly readable by design; contact and AR analytics submissions validate field shape and size.
- Security-sensitive recovery data and rate-limit data cannot be directly read or written by clients.

### Why Cloud Functions?

Cloud Functions use Firebase Admin privileges only after validating the caller and input. They are appropriate for actions such as account lifecycle operations, password recovery, login lookup, rate limiting, and scheduled maintenance, because these should not rely on client-side trust.

## 8. Scheduled/event pipeline

### Payment reminders

```text
Cloud Scheduler invokes `sendPaymentReminders`
        -> function runs every minute but exits unless Manila time matches the admin-configured hour/minute
        -> function reads active tenants and their tenant-level billing terms
        -> billing logic determines whether payment is due/outstanding
        -> transaction claims one `reminder_logs` record for that tenant and billing period
        -> phone number is normalized to 09XXXXXXXXX
        -> Semaphore request is attempted up to three times and recorded in `sms_logs`
        -> successful provider acceptance updates the reminder log with message ID/status
        -> a failed SMS claim is removed so a later run can retry
        -> in-app notification is created independently, even if SMS fails
```

**Important defense wording:** an `accepted` status means Semaphore accepted the request and returned a message ID. It does not by itself prove that the handset received or read the SMS. Phone numbers are masked in application logs and SMS audit records.

### Event-based notifications

- A new payment can trigger admin notification logic.
- A new notification record can trigger push-delivery logic.
- Owner/admin review flows also write notification records so the recipient sees a consistent in-app queue.

### Retention

`cleanupOldDailyReports` is a scheduled Cloud Function that removes daily reports outside the rolling retention window. This prevents reports from accumulating indefinitely.

## 9. Suggested defense demonstration order

1. Start with the problem: manual rental records and disconnected communication slow market operations.
2. Show the four-user overview and architecture diagram.
3. Demo the tenant dashboard and payment flow first—this is the clearest core value.
4. Switch to admin: show tenant/stall management, a payment approval or cash-record workflow, and financial views.
5. Show the owner approval/oversight flow and reports.
6. End with guest market browsing and AR as the differentiating public-facing feature.
7. Explain the backend: Firestore as the source of truth, rules for authorization, and Cloud Functions for trusted/scheduled actions.
8. Close with limitations and next steps before the panel has to discover them.

## 10. Likely questions and short answers

**Why use four apps instead of one role-based app?**  
The user groups have different tasks and exposure levels. Separate apps make each workflow smaller and clearer, reduce accidental UI exposure, and allow the guest experience to stay public and web-oriented without login.

**Where is access control actually enforced?**  
At two levels: the app hides irrelevant screens for user experience, while Firestore Security Rules enforce the real database authorization on every request. Cloud Functions protect privileged operations further.

**Why Firestore instead of a relational database?**  
For this scope, Firebase combines real-time data, authentication, rules, serverless functions, and managed infrastructure. It fits the project because the active system needs centralized live updates and role-based access without maintaining a separate database server.

**How does a payment become approved?**  
The tenant initiates/records a payment and may attach receipt proof. The payment remains operationally reviewable; an admin verifies it and changes its approved status. Financial summaries use approved payments rather than treating every initiated payment as final.

**How are reminders calculated?**  
The function ticks every minute but only processes tenants at the admin-configured Manila time. It checks tenant-level billing terms and payment history, calculates the outstanding balance, and atomically claims one reminder record per billing period before sending. Semaphore is tried up to three times, while the in-app notification is created independently so an SMS failure does not hide the reminder in the app.

**How do you know an SMS was delivered?**  
The system records that Semaphore accepted the request, including its message ID, provider status, and attempt count. That is provider acceptance rather than proof of handset delivery or reading, so we should not overstate it during the defense.

**What happens if a tenant edits the app or calls Firestore directly?**  
They still face Firestore Security Rules, which run on Firebase servers. For example, self-service updates cannot change role, status, price, or payment schedule.

**Why PayMongo?**  
It supports locally relevant e-wallet checkout methods such as GCash and Maya, making the rent-payment process more convenient for tenants.

**How does AR choose a placement point?**  
WebXR hit testing finds candidate real-world intersections. The project strengthens that raw result with plane classification, depth when available, stability checks, and wall-clearance validation before allowing placement.

**How was the project tested?**  
The system was tested through functional and device testing, including the payment/reminder and AR workflows. We validated the expected Firestore updates, notifications, and user-facing results for the major flows.

## 11. Known limitations and honest next steps

Keep this section limited to constraints that materially affect the defense or a future production release.

1. **AR platform coverage is device/browser dependent.** Immersive WebXR AR is primarily intended for Android Chrome. Unsupported devices can use the non-immersive model-viewing fallback.

Internal refactoring and long-term scale considerations—such as consolidating billing helpers, expanding automated coverage, and tightening large-data queries—are intentionally outside this capstone defense reviewer because they do not change the demonstrated system workflow.

## 12. Final closing statement

> RentWise delivers the end-to-end workflow needed by a market-rental operation: public discovery, tenant payment visibility, staff administration, and owner governance. The design deliberately combines role-focused modules with a centralized, secured Firebase backend, online payment capability, scheduled reminders, notifications, and a browser-based AR feature. Each module contributes to one connected market-rental workflow while preserving the permissions appropriate to its user role.

## 13. Quick file map for follow-up questions

| Topic | Useful location |
| --- | --- |
| Overall project and startup | `README.md` |
| Detailed architecture/Q&A | `SYSTEM_ARCHITECTURE.md` |
| Tenant screens | `rentwise-tenant/app/` |
| Admin screens | `rentwise-admin/app/` |
| Owner screens | `rentwise-owner/app/` |
| Guest screens and AR | `rentwise-guest/app/`, `rentwise-guest/features/ar/ARSessionScene.ts` |
| Server functions | `functions/src/index.ts`, `functions/src/reminderScheduler.ts` |
| Security controls | `firestore.rules`, `storage.rules` |
| Payment checkout service | `paymongo-api/` |
| Implementation notes | `UNFINISHED.txt` |
