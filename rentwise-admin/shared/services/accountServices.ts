import { initializeApp, deleteApp } from "firebase/app";
import {
  initializeAuth,
  inMemoryPersistence,
  createUserWithEmailAndPassword,
  deleteUser as deleteAuthUser,
} from "firebase/auth";
import type { User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { firebaseApp } from "../firebaseConfig";
import { auth } from "./auth";
import { db } from "./firestore";
import { rentWiseUsernameBase } from "../../../shared/utils/username";

function paymentIntervalDaysFor(schedule: string): number {
  if (schedule === "daily") return 1;
  if (schedule === "weekly") return 7;
  if (schedule === "semi-monthly") return 15;
  return 30;
}

// BLAZE PLAN ONLY — remove this line after capstone defense
const cloudFunctions = getFunctions(firebaseApp);
import { logDetailedUpdate } from "./updatesService";

export const DEFAULT_TENANT_PASSWORD = "@Tenant123";

type CreateTenantParams = {
  firstName: string;
  middleName?: string;
  lastName: string;
  contactNo: string;
  stallId: string;
};

export function usernameBase(firstName: string, lastName: string): string {
  if (!lastName.trim()) throw new Error("Enter a valid first and last name.");
  return rentWiseUsernameBase(firstName);
}

async function createAvailableUsername(firstName: string, lastName: string): Promise<string> {
  const base = usernameBase(firstName, lastName);
  for (let sequence = 1; sequence <= 99; sequence += 1) {
    const candidate = sequence === 1 ? base : `${base}${sequence}`;
    const [upperMatch, lowerMatch] = await Promise.all([
      getDocs(query(collection(db, "users"), where("username", "==", candidate))),
      getDocs(query(collection(db, "users"), where("username", "==", candidate.toLowerCase()))),
    ]);
    if (upperMatch.empty && lowerMatch.empty) return candidate;
  }
  throw new Error("Could not create a unique username. Please try again.");
}

export const createTenantAccount = async (
  params: CreateTenantParams,
): Promise<{ uid: string; username: string }> => {
  const {
    firstName,
    middleName = "",
    lastName,
    contactNo,
    stallId,
} = params;
  const username = await createAvailableUsername(firstName, lastName);
  const createTenant = httpsCallable<
    {firstName: string; middleName: string; lastName: string; contactNo: string; stallId: string; username: string; password: string},
    {success: boolean; uid: string; username: string}
  >(cloudFunctions, "adminCreateTenant");
  const response = await createTenant({
    firstName,
    middleName,
    lastName,
    contactNo,
    stallId,
    username,
    password: DEFAULT_TENANT_PASSWORD,
  });
  const uid = response.data.uid;
  getDoc(doc(db, "stalls", stallId)).then((snap) => {
    void logDetailedUpdate({
      module: "Register Tenant",
      type: "Tenant Registration",
      tenantId: uid,
      tenantName: [firstName, middleName, lastName].filter(Boolean).join(" "),
      spaceNo: snap.exists() ? String(snap.data().spaceId ?? stallId) : stallId,
      oldValue: "Unoccupied",
      newValue: "Active Tenant",
      changedBy: auth.currentUser?.uid ?? "",
      approvalStatus: "pending",
    });
  }).catch(() => undefined);
  return {uid, username: response.data.username || username};

  /* Legacy client-side provisioning retained temporarily for rollback
     reference. Execution returns above; production creation is server-only.
  // Firebase email/password authentication needs an email-shaped value. The
  // user never enters this value; login resolves their stored username.
  const email = `${username.toLowerCase()}@rentwise.app`;
  // Tenant can log in immediately with the shared default (see the
  // mustChangePassword gate below) instead of being stuck until they
  // happen to check their email — the welcome email sent further down is
  // an *additional*, faster path in, not the only way in.
  const password = DEFAULT_TENANT_PASSWORD;

  const appName = `tenant-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const secondaryApp = initializeApp(firebaseApp.options, appName);
  const secondaryAuth = initializeAuth(secondaryApp, { persistence: inMemoryPersistence });
  let createdUser: User | null = null;

  try {
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      email,
      password,
    );
    createdUser = credential.user;
    const uid = createdUser.uid;

    // Transaction guards against two admins registering the same stall at
    // the same time — re-checks occupancy right before committing instead
    // of trusting whatever was read when the form first loaded.
    await runTransaction(db, async (tx) => {
      const stallRef = doc(db, "stalls", stallId);
      const stallSnap = await tx.get(stallRef);

      if (!stallSnap.exists()) {
        throw new Error("Stall not found.");
      }
      if (stallSnap.data().status === "occupied") {
        throw new Error(
          "This stall was just registered by another admin. Please refresh and choose a different stall.",
        );
      }

      // Billing terms (price/paymentSchedule/category) now live on the
      // TENANT, not the stall -- a new tenant starts out with whatever the
      // stall was last listing (its own denormalized display copy), same
      // starting point as before, they just own that data going forward
      // instead of sharing the stall's copy with whoever rents it next.
      const stallData = stallSnap.data();
      const billingStartedAt = Timestamp.now();
      const initialSchedule = String(stallData.paymentSchedule ?? "monthly");
      tx.set(doc(db, "users", uid), {
        firstName,
        middleName,
        lastName,
        email,
        // Keeps the existing SMS-OTP reset function compatible while the
        // visible account identifier is the username.
        personalEmail: email,
        username,
        contactNo,
        role: "tenant",
        stallId,
        primaryStallId: stallId,
        stallIds: [stallId],
        stallAssignments: [{
          stallId,
          dailyRate: Number(stallData.price ?? 0),
          assignedAt: billingStartedAt,
        }],
        status: "active",
        price: stallData.price ?? 0,
        paymentSchedule: initialSchedule,
        paymentIntervalDays: Number(stallData.paymentIntervalDays) || paymentIntervalDaysFor(initialSchedule),
        category: stallData.category ?? "",
        // Always starts true — every tenant starts on the shared default
        // password and must change it via the forced-change screen the
        // moment they first log in with @Tenant123.
        mustChangePassword: true,
        createdAt: billingStartedAt,
        billingStartedAt,
        nextDueAt: billingStartedAt,
        lastApprovedPaymentAt: null,
        paidThroughAt: null,
      });

      tx.update(stallRef, {
        tenantId: uid,
        tenantName: [firstName, middleName, lastName].filter(Boolean).join(" "),
        status: "occupied",
      });
    });

    // Fire-and-forget: fetch stall info for the log (non-blocking)
    getDoc(doc(db, "stalls", stallId)).then((snap) => {
      const spaceNo = snap.exists() ? String(snap.data().spaceId ?? stallId) : stallId;
      void logDetailedUpdate({
        module: "Register Tenant",
        type: "Tenant Registration",
        tenantId: uid,
        tenantName: [firstName, middleName, lastName].filter(Boolean).join(" "),
        spaceNo,
        oldValue: "Unoccupied",
        newValue: "Active Tenant",
        changedBy: auth.currentUser?.uid ?? "",
        approvalStatus: "pending",
      });
    }).catch(() => {});

    return { uid, username };
  } catch (err) {
    // Rollback: remove Auth account if Firestore write failed after auth creation
    if (createdUser) {
      try {
        await deleteAuthUser(createdUser);
      } catch (rollbackErr) {
        console.error("Auth rollback failed:", rollbackErr);
      }
    }
    const e = err as { code?: string };
    if (e.code === "auth/email-already-in-use") {
      throw new Error("This generated username is already in use. Please try again.");
    }
    throw err;
  } finally {
    await deleteApp(secondaryApp);
  }
  */
};

// Adds/updates the CALLER's own real email — changes their Firebase Auth
// account's actual sign-in email (so self-service reset can reach them) and
// stores it on their Firestore doc. Self-service only — no target uid param,
// the Cloud Function always acts on request.auth.uid.
export const syncPersonalEmail = async (personalEmail: string): Promise<void> => {
  // The Cloud Function identifies the caller itself from the verified
  // auth token (request.auth.uid) -- this check is just a fast client-side
  // fail rather than something the function relies on.
  if (!auth.currentUser?.uid) throw new Error("Not authenticated.");
  const syncFn = httpsCallable(cloudFunctions, "syncPersonalEmail");
  await syncFn({ personalEmail });
};

export const resetTenantPasswordToDefault = async (
  uid: string,
): Promise<void> => {
  if (!auth.currentUser?.uid) throw new Error("Admin not authenticated.");
  const resetFn = httpsCallable(cloudFunctions, "adminResetTenantPassword");
  await resetFn({ uid, newPassword: DEFAULT_TENANT_PASSWORD });
};

// Disables/re-enables the tenant's Firebase Auth login itself — separate
// from the Firestore `status` field, which only controls what the admin
// app shows. Without this, an "archived" tenant's account still works and
// they can keep signing in.
const setTenantAccountDisabled = async (
  uid: string,
  disabled: boolean,
): Promise<void> => {
  if (!auth.currentUser?.uid) throw new Error("Admin not authenticated.");
  const setDisabledFn = httpsCallable(cloudFunctions, "adminSetAccountDisabled");
  await setDisabledFn({ uid, disabled });
};

export type ArchiveEligibility = {
  canArchive: boolean;
  outstandingBalance: number;
  hasPendingPayment: boolean;
};

export type ExistingTenantAssignmentResult = {
  success: boolean;
  stallIds: string[];
  combinedDailyRate: number;
};

export const assignStallToExistingTenant = async (
  tenantId: string,
  stallId: string,
): Promise<ExistingTenantAssignmentResult> => {
  if (!auth.currentUser?.uid) throw new Error("Admin not authenticated.");
  const assignFn = httpsCallable<
    {tenantId: string; stallId: string},
    ExistingTenantAssignmentResult
  >(cloudFunctions, "assignStallToExistingTenant");
  const result = await assignFn({tenantId, stallId});
  return result.data;
};

export type RemoveTenantStallResult = {
  success: boolean;
  stallIds: string[];
  primaryStallId: string;
  combinedDailyRate: number;
};

export const removeStallFromTenantSafely = async (
  tenantId: string,
  stallId: string,
): Promise<RemoveTenantStallResult> => {
  if (!auth.currentUser?.uid) throw new Error("Admin not authenticated.");
  const removeFn = httpsCallable<
    {tenantId: string; stallId: string},
    RemoveTenantStallResult
  >(cloudFunctions, "removeStallFromTenantSafely");
  const result = await removeFn({tenantId, stallId});
  return result.data;
};

export type UpdateStallRentalTermsInput = {
  stallId: string;
  length: number;
  width: number;
  dailyRate: number;
  paymentSchedule: string;
  category: string;
};

export type UpdateStallRentalTermsResult = {
  success: boolean;
  combinedDailyRate: number;
};

export const updateStallRentalTermsSafely = async (
  input: UpdateStallRentalTermsInput,
): Promise<UpdateStallRentalTermsResult> => {
  if (!auth.currentUser?.uid) throw new Error("Admin not authenticated.");
  const updateFn = httpsCallable<
    UpdateStallRentalTermsInput,
    UpdateStallRentalTermsResult
  >(cloudFunctions, "adminUpdateStallRentalTermsSafely");
  const result = await updateFn(input);
  return result.data;
};

export const checkTenantArchiveEligibility = async (
  uid: string,
): Promise<ArchiveEligibility> => {
  if (!auth.currentUser?.uid) throw new Error("Admin not authenticated.");
  const checkEligibility = httpsCallable<
    { uid: string },
    ArchiveEligibility
  >(cloudFunctions, "checkTenantArchiveEligibility");
  const result = await checkEligibility({ uid });
  return result.data;
};

export const archiveTenant = async (uid: string): Promise<void> => {
  if (!auth.currentUser?.uid) throw new Error("Admin not authenticated.");
  const archiveFn = httpsCallable<{uid: string}, {success: boolean}>(cloudFunctions, "archiveTenantSafely");
  await archiveFn({uid});
};

// Retained temporarily for rollback/reference while production clients move
// to the server-coordinated archive operation above.
const archiveTenantLegacy = async (uid: string): Promise<void> => {
  const userSnap = await getDoc(doc(db, "users", uid));
  if (!userSnap.exists()) throw new Error("User not found.");

  const user = userSnap.data();
  const stallId = (user.stallId as string) ?? "";

  let buildingNumber = "";
  let spaceId = "";
  // Source of truth is the tenant's own doc now, not the stall -- read
  // straight off `user` (already fetched above) instead of the stall copy.
  const paymentSchedule = (user.paymentSchedule as string) ?? "";

  let stallBelongsToTenant = false;
  if (stallId) {
    const stallSnap = await getDoc(doc(db, "stalls", stallId));
    if (stallSnap.exists()) {
      const sd = stallSnap.data();
      buildingNumber = (sd.buildingNumber as string) ?? "";
      spaceId = (sd.spaceId as string) ?? "";
      // Only this tenant's own archive should clear the stall's occupancy —
      // a stale stallId left over from a past race condition (e.g. two
      // admins registering the same stall) must not evict whoever the
      // stall doc actually says is occupying it.
      stallBelongsToTenant = sd.tenantId === uid;
    }
  }

  // Lock the tenant out of the app before committing the archive — if this
  // fails, the whole archive aborts rather than leaving Firestore saying
  // "archived" while the tenant can still log in.
  await setTenantAccountDisabled(uid, true);

  const batch = writeBatch(db);

  batch.set(doc(db, "archives", uid), {
    originalUid: uid,
    firstName: user.firstName ?? "",
    middleName: user.middleName ?? "",
    lastName: user.lastName ?? "",
    // Legacy accounts still have `username`; new Gmail-based tenants don't
    // — fall back through whichever fields this particular tenant has.
    email: user.personalEmail ?? user.email ?? "",
    username: user.username ?? "",
    contactNo: user.contactNo ?? "",
    stallId,
    buildingNumber,
    spaceId,
    paymentSchedule,
    archivedAt: serverTimestamp(),
  });

  batch.update(doc(db, "users", uid), { status: "archived" });

  if (stallId && stallBelongsToTenant) {
    batch.update(doc(db, "stalls", stallId), {
      status: "unoccupied",
      tenantId: null,
      tenantName: null,
    });
  }

  await batch.commit();

  const tenantName = [user.firstName, user.middleName, user.lastName].filter(Boolean).join(" ");
  void logDetailedUpdate({
    module: "Manage Account",
    type: "Tenant Archived",
    tenantId: uid,
    tenantName,
    spaceNo: spaceId || stallId,
    buildingNo: buildingNumber,
    oldValue: "Active",
    newValue: "Archived",
    changedBy: auth.currentUser?.uid ?? "",
    approvalStatus: "pending",
  });
};

// ── FREE PLAN (Spark) ─────────────────────────────────────────────────────────
// After capstone defense: downgrade Firebase to Spark, then uncomment this
// block and delete the BLAZE PLAN block below (including the cloudFunctions
// import at the top of this file).
// NOTE: Firebase Auth account is NOT deleted — orphaned accounts stay in
// Firebase Console but do not affect app functionality.
//
// export const deleteArchivedTenant = async (uid: string): Promise<void> => {
//   const archiveSnap = await getDoc(doc(db, "archives", uid));
//   if (!archiveSnap.exists()) throw new Error("Archive record not found.");
//
//   const archive = archiveSnap.data();
//   const tenantName = `${archive.firstName ?? ""} ${archive.lastName ?? ""}`.trim();
//
//   const batch = writeBatch(db);
//   batch.delete(doc(db, "archives", uid));
//   batch.delete(doc(db, "users", uid));
//   await batch.commit();
//
//   void logDetailedUpdate({
//     module: "Account Archive",
//     type: "Tenant Deleted",
//     tenantId: uid,
//     tenantName,
//     spaceNo: (archive.spaceId as string) ?? "",
//     buildingNo: (archive.buildingNumber as string) ?? "",
//     oldValue: "Archived",
//     newValue: "Deleted",
//     changedBy: auth.currentUser?.uid ?? "",
//     approvalStatus: "pending",
//   });
// };
// ─────────────────────────────────────────────────────────────────────────────

// ── BLAZE PLAN ────────────────────────────────────────────────────────────────
// After capstone defense: remove this entire block and uncomment the FREE PLAN
// block above. Also delete adminDeleteTenant from functions/src/index.ts.
export const deleteArchivedTenant = async (uid: string): Promise<void> => {
  const archiveSnap = await getDoc(doc(db, "archives", uid));
  if (!archiveSnap.exists()) throw new Error("Archive record not found.");

  const archive = archiveSnap.data();
  const tenantName = [archive.firstName, archive.middleName, archive.lastName].filter(Boolean).join(" ");

  // Deletes Firebase Auth account so the username can be reused
  if (!auth.currentUser?.uid) throw new Error("Admin not authenticated.");
  const deleteFn = httpsCallable(cloudFunctions, "adminDeleteTenant");
  await deleteFn({ uid });

  const batch = writeBatch(db);
  batch.delete(doc(db, "archives", uid));
  batch.delete(doc(db, "users", uid));
  await batch.commit();

  void logDetailedUpdate({
    module: "Account Archive",
    type: "Tenant Deleted",
    tenantId: uid,
    tenantName,
    spaceNo: (archive.spaceId as string) ?? "",
    buildingNo: (archive.buildingNumber as string) ?? "",
    oldValue: "Archived",
    newValue: "Deleted",
    changedBy: auth.currentUser?.uid ?? "",
    approvalStatus: "pending",
  });
};
// ─────────────────────────────────────────────────────────────────────────────

export const restoreTenant = async (uid: string): Promise<void> => {
  if (!auth.currentUser?.uid) throw new Error("Admin not authenticated.");
  const archiveBefore = await getDoc(doc(db, "archives", uid));
  const archiveData = archiveBefore.data() ?? {};
  const restoreFn = httpsCallable(cloudFunctions, "ownerRestoreArchivedTenant");
  await restoreFn({ uid, transferPreviousInfo: true });
  void logDetailedUpdate({
    module: "Account Archive", type: "Tenant Restore", tenantId: uid,
    tenantName: [archiveData.firstName, archiveData.middleName, archiveData.lastName].filter(Boolean).join(" "),
    spaceNo: String(archiveData.spaceId ?? archiveData.stallId ?? "N/A"),
    buildingNo: String(archiveData.buildingNumber ?? "N/A"), oldValue: "Archived", newValue: "Active Tenant",
    changedBy: auth.currentUser.uid, approvalStatus: "pending",
  });
};

// Moves a currently ACTIVE (not archived) tenant straight to a different
// stall — frees up their old stall in the same batch, so admin doesn't have
// to archive them first just to reassign a space.
export const relocateActiveTenant = async (
  uid: string,
  oldStallId: string,
  newStallId: string,
  transferPreviousInfo: boolean,
): Promise<void> => {
  if (!auth.currentUser?.uid) throw new Error("Admin not authenticated.");
  const relocateFn = httpsCallable(cloudFunctions, "adminRelocateTenant");
  await relocateFn({ uid, oldStallId, newStallId, transferPreviousInfo });
  const [tenantAfter, oldStallAfter, newStallAfter] = await Promise.all([
    getDoc(doc(db, "users", uid)),
    getDoc(doc(db, "stalls", oldStallId)),
    getDoc(doc(db, "stalls", newStallId)),
  ]);
  const tenantData = tenantAfter.data() ?? {};
  const oldStallData = oldStallAfter.data() ?? {};
  const newStallData = newStallAfter.data() ?? {};
  void logDetailedUpdate({
    module: "Manage Account",
    type: "Tenant Relocated",
    tenantId: uid,
    tenantName: [tenantData.firstName, tenantData.middleName, tenantData.lastName].filter(Boolean).join(" "),
    spaceNo: String(newStallData.spaceId ?? newStallId),
    buildingNo: String(newStallData.buildingNumber ?? ""),
    oldValue: `Building ${String(oldStallData.buildingNumber ?? "N/A")} · Space ${String(oldStallData.spaceId ?? oldStallId)}`,
    newValue: `Building ${String(newStallData.buildingNumber ?? "N/A")} · Space ${String(newStallData.spaceId ?? newStallId)}`,
    changedBy: auth.currentUser.uid,
    approvalStatus: "pending",
  });
  return;

  /* Legacy client-side relocation removed from execution; retained temporarily
     for history while the server transaction is rolled out.
  const userSnap = await getDoc(doc(db, "users", uid));
  if (!userSnap.exists()) throw new Error("User not found.");
  const user = userSnap.data();
  const tenantName = [user.firstName, user.middleName, user.lastName].filter(Boolean).join(" ");

  const newStallSnap = await getDoc(doc(db, "stalls", newStallId));
  if (!newStallSnap.exists()) throw new Error("Selected stall not found.");
  const newStallData = newStallSnap.data();
  if (newStallData.status !== "unoccupied") {
    throw new Error("Selected stall is no longer available.");
  }
  const newSpaceNo = String(newStallData.spaceId ?? newStallId);
  const newBuildingNo = String(newStallData.buildingNumber ?? "");

  // Rental Rate always adopts the new stall's own listed price -- unlike
  // category/paymentSchedule below, this is never carried over from the
  // tenant's previous stall, regardless of transferPreviousInfo.
  const resolvedPrice = Number(newStallData.price ?? 0);
  const resolvedPaymentSchedule = transferPreviousInfo
    ? (user.paymentSchedule ?? "monthly")
    : (newStallData.paymentSchedule ?? "monthly");
  const resolvedCategory = transferPreviousInfo
    ? (user.category ?? "")
    : (newStallData.category ?? "");

  let oldSpaceNo = "";
  let oldBuildingNo = "";
  // Only clear the old stall if it still actually belongs to this tenant —
  // same safety check as archiveTenant, guards against a stale stallId.
  let oldStallBelongsToTenant = false;
  if (oldStallId) {
    const oldStallSnap = await getDoc(doc(db, "stalls", oldStallId));
    if (oldStallSnap.exists()) {
      const od = oldStallSnap.data();
      oldSpaceNo = String(od.spaceId ?? oldStallId);
      oldBuildingNo = String(od.buildingNumber ?? "");
      oldStallBelongsToTenant = od.tenantId === uid;
    }
  }

  const batch = writeBatch(db);

  // Price always follows the new stall; category/paymentSchedule follow
  // whichever source the admin picked in the transfer-info confirmation.
  batch.update(doc(db, "users", uid), {
    stallId: newStallId,
    price: resolvedPrice,
    paymentSchedule: resolvedPaymentSchedule,
    paymentIntervalDays: paymentIntervalDaysFor(resolvedPaymentSchedule),
    category: resolvedCategory,
  });

  batch.update(doc(db, "stalls", newStallId), {
    tenantId: uid,
    tenantName,
    status: "occupied",
    price: resolvedPrice,
    paymentIntervalDays: paymentIntervalDaysFor(resolvedPaymentSchedule),
    paymentSchedule: resolvedPaymentSchedule,
    category: resolvedCategory,
  });

  if (oldStallId && oldStallBelongsToTenant) {
    batch.update(doc(db, "stalls", oldStallId), {
      status: "unoccupied",
      tenantId: null,
      tenantName: null,
    });
  }

  await batch.commit();

  void logDetailedUpdate({
    module: "Manage Account",
    type: "Tenant Relocated",
    tenantId: uid,
    tenantName,
    spaceNo: newSpaceNo,
    buildingNo: newBuildingNo,
    oldValue: oldSpaceNo ? `Building ${oldBuildingNo} · Space ${oldSpaceNo}` : "—",
    newValue: `Building ${newBuildingNo} · Space ${newSpaceNo}`,
    changedBy: auth.currentUser?.uid ?? "",
    approvalStatus: "pending",
  });
  */
};

export const restoreTenantToNewStall = async (
  uid: string,
  newStallId: string,
  transferPreviousInfo: boolean,
): Promise<void> => {
  if (!auth.currentUser?.uid) throw new Error("Admin not authenticated.");
  const archiveBefore = await getDoc(doc(db, "archives", uid));
  const archiveData = archiveBefore.data() ?? {};
  const restoreFn = httpsCallable(cloudFunctions, "ownerRestoreArchivedTenant");
  await restoreFn({ uid, newStallId, transferPreviousInfo });
  const destination = await getDoc(doc(db, "stalls", newStallId));
  const destinationData = destination.data() ?? {};
  void logDetailedUpdate({
    module: "Account Archive", type: "Tenant Restore", tenantId: uid,
    tenantName: [archiveData.firstName, archiveData.middleName, archiveData.lastName].filter(Boolean).join(" "),
    spaceNo: String(destinationData.spaceId ?? newStallId), buildingNo: String(destinationData.buildingNumber ?? "N/A"),
    oldValue: "Archived", newValue: "Active Tenant", changedBy: auth.currentUser.uid, approvalStatus: "pending",
  });
  return;

  /* Legacy client-side restore removed from execution; retained temporarily
     for history while the server transaction is rolled out.
  const archiveSnap = await getDoc(doc(db, "archives", uid));
  if (!archiveSnap.exists()) throw new Error("Archive record not found.");

  const archive = archiveSnap.data();
  const tenantName = [archive.firstName, archive.middleName, archive.lastName].filter(Boolean).join(" ");

  // Verify the new stall is still unoccupied before committing
  const stallSnap = await getDoc(doc(db, "stalls", newStallId));
  if (!stallSnap.exists()) throw new Error("Selected stall not found.");
  const stallData = stallSnap.data();
  if (stallData.status !== "unoccupied") {
    throw new Error("Selected stall is no longer available.");
  }

  const newSpaceNo = String(stallData.spaceId ?? newStallId);

  // The tenant's own price/paymentSchedule/category never left their doc
  // while archived -- fetched here for the transfer-info resolution below.
  const userSnap = await getDoc(doc(db, "users", uid));
  const user = userSnap.exists() ? userSnap.data() : {};

  // Rental Rate always adopts the new stall's own listed price -- unlike
  // category/paymentSchedule below, this is never carried over from the
  // tenant's previous stall, regardless of transferPreviousInfo.
  const resolvedPrice = Number(stallData.price ?? 0);
  const resolvedPaymentSchedule = transferPreviousInfo
    ? (user.paymentSchedule ?? "monthly")
    : (stallData.paymentSchedule ?? "monthly");
  const resolvedCategory = transferPreviousInfo
    ? (user.category ?? "")
    : (stallData.category ?? "");

  // Re-enable login before committing the restore.
  await setTenantAccountDisabled(uid, false);

  const batch = writeBatch(db);

  batch.update(doc(db, "users", uid), {
    status: "active",
    stallId: newStallId,
    price: resolvedPrice,
    paymentSchedule: resolvedPaymentSchedule,
    paymentIntervalDays: paymentIntervalDaysFor(resolvedPaymentSchedule),
    category: resolvedCategory,
  });

  batch.update(doc(db, "stalls", newStallId), {
    tenantId: uid,
    tenantName,
    status: "occupied",
    price: resolvedPrice,
    paymentIntervalDays: paymentIntervalDaysFor(resolvedPaymentSchedule),
    paymentSchedule: resolvedPaymentSchedule,
    category: resolvedCategory,
  });

  batch.delete(doc(db, "archives", uid));

  await batch.commit();

  void logDetailedUpdate({
    module: "Account Archive",
    type: "Tenant Restore",
    tenantId: uid,
    tenantName,
    spaceNo: newSpaceNo,
    buildingNo: String(stallSnap.data().buildingNumber ?? ""),
    oldValue: "Archived",
    newValue: "Active Tenant",
    changedBy: auth.currentUser?.uid ?? "",
    approvalStatus: "pending",
  });
  */
};
