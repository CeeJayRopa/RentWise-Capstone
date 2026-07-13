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
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { firebaseApp } from "../firebaseConfig";
import { auth } from "./auth";
import { db } from "./firestore";

// BLAZE PLAN ONLY — remove this line after capstone defense
const cloudFunctions = getFunctions(firebaseApp);
import { logDetailedUpdate } from "./updatesService";

export const DEFAULT_TENANT_PASSWORD = "@Tenant123";

type CreateTenantParams = {
  firstName: string;
  lastName: string;
  contactNo: string;
  stallId: string;
  // Required — every tenant account is a real Gmail (or other real email)
  // address now. That email is directly the account's Firebase Auth
  // identity; there's no separate username/synthetic-email concept for
  // tenants anymore (admin/owner accounts are unrelated and unaffected).
  personalEmail: string;
};

export const createTenantAccount = async (
  params: CreateTenantParams,
): Promise<{ uid: string }> => {
  const {
    firstName,
    lastName,
    contactNo,
    stallId,
    personalEmail,
  } = params;
  const email = personalEmail;
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

      tx.set(doc(db, "users", uid), {
        firstName,
        lastName,
        email,
        personalEmail,
        contactNo,
        role: "tenant",
        stallId,
        status: "active",
        // Always starts true — every tenant starts on the shared default
        // password and must change it via the forced-change screen the
        // moment they first log in with @Tenant123.
        mustChangePassword: true,
        createdAt: serverTimestamp(),
      });

      tx.update(stallRef, {
        tenantId: uid,
        tenantName: `${firstName} ${lastName}`,
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
        tenantName: `${firstName} ${lastName}`,
        spaceNo,
        oldValue: "Unoccupied",
        newValue: "Active Tenant",
        changedBy: auth.currentUser?.uid ?? "",
        approvalStatus: "pending",
      });
    }).catch(() => {});

    return { uid };
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
      throw new Error("This email is already in use by another account. If this tenant was recently deleted, that account may need to be fully removed first.");
    }
    throw err;
  } finally {
    await deleteApp(secondaryApp);
  }
};

// Adds/updates the CALLER's own real email — changes their Firebase Auth
// account's actual sign-in email (so self-service reset can reach them) and
// stores it on their Firestore doc. Self-service only — no target uid param,
// the Cloud Function always acts on request.auth.uid.
export const syncPersonalEmail = async (personalEmail: string): Promise<void> => {
  const callerUid = auth.currentUser?.uid;
  if (!callerUid) throw new Error("Not authenticated.");
  const syncFn = httpsCallable(cloudFunctions, "syncPersonalEmail");
  await syncFn({ callerUid, personalEmail });
};

export const resetTenantPasswordToDefault = async (
  uid: string,
): Promise<void> => {
  const callerUid = auth.currentUser?.uid;
  if (!callerUid) throw new Error("Admin not authenticated.");
  const resetFn = httpsCallable(cloudFunctions, "adminResetTenantPassword");
  await resetFn({ uid, newPassword: DEFAULT_TENANT_PASSWORD, callerUid });
  await updateDoc(doc(db, "users", uid), { mustChangePassword: true });
};

// Disables/re-enables the tenant's Firebase Auth login itself — separate
// from the Firestore `status` field, which only controls what the admin
// app shows. Without this, an "archived" tenant's account still works and
// they can keep signing in.
const setTenantAccountDisabled = async (
  uid: string,
  disabled: boolean,
): Promise<void> => {
  const callerUid = auth.currentUser?.uid;
  if (!callerUid) throw new Error("Admin not authenticated.");
  const setDisabledFn = httpsCallable(cloudFunctions, "adminSetAccountDisabled");
  await setDisabledFn({ uid, disabled, callerUid });
};

export const archiveTenant = async (uid: string): Promise<void> => {
  const userSnap = await getDoc(doc(db, "users", uid));
  if (!userSnap.exists()) throw new Error("User not found.");

  const user = userSnap.data();
  const stallId = (user.stallId as string) ?? "";

  let buildingNumber = "";
  let spaceId = "";
  let paymentSchedule = "";

  let stallBelongsToTenant = false;
  if (stallId) {
    const stallSnap = await getDoc(doc(db, "stalls", stallId));
    if (stallSnap.exists()) {
      const sd = stallSnap.data();
      buildingNumber = (sd.buildingNumber as string) ?? "";
      spaceId = (sd.spaceId as string) ?? "";
      paymentSchedule = (sd.paymentSchedule as string) ?? "";
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

  const tenantName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
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
  const tenantName = `${archive.firstName ?? ""} ${archive.lastName ?? ""}`.trim();

  // Deletes Firebase Auth account so the username can be reused
  const callerUid = auth.currentUser?.uid;
  if (!callerUid) throw new Error("Admin not authenticated.");
  const deleteFn = httpsCallable(cloudFunctions, "adminDeleteTenant");
  await deleteFn({ uid, callerUid });

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
  const archiveSnap = await getDoc(doc(db, "archives", uid));
  if (!archiveSnap.exists()) throw new Error("Archive record not found.");

  const archive = archiveSnap.data();
  const stallId = (archive.stallId as string) ?? "";
  const tenantName = `${archive.firstName ?? ""} ${archive.lastName ?? ""}`.trim();

  // Re-enable login before committing the restore.
  await setTenantAccountDisabled(uid, false);

  const batch = writeBatch(db);

  batch.update(doc(db, "users", uid), { status: "active" });

  let stallReassigned = false;
  if (stallId) {
    const stallSnap = await getDoc(doc(db, "stalls", stallId));
    if (stallSnap.exists() && stallSnap.data().status === "unoccupied") {
      batch.update(doc(db, "stalls", stallId), {
        tenantId: uid,
        tenantName,
        status: "occupied",
      });
      stallReassigned = true;
    }
  }

  batch.delete(doc(db, "archives", uid));

  await batch.commit();

  void logDetailedUpdate({
    module: "Account Archive",
    type: "Tenant Restore",
    tenantId: uid,
    tenantName,
    spaceNo: stallReassigned ? ((archive.spaceId as string) || stallId) : "",
    buildingNo: (archive.buildingNumber as string) ?? "",
    oldValue: "Archived",
    newValue: stallReassigned ? "Active Tenant" : "Active (No Stall Assigned)",
    changedBy: auth.currentUser?.uid ?? "",
    approvalStatus: "pending",
  });
};

// Moves a currently ACTIVE (not archived) tenant straight to a different
// stall — frees up their old stall in the same batch, so admin doesn't have
// to archive them first just to reassign a space.
export const relocateActiveTenant = async (
  uid: string,
  oldStallId: string,
  newStallId: string,
): Promise<void> => {
  const userSnap = await getDoc(doc(db, "users", uid));
  if (!userSnap.exists()) throw new Error("User not found.");
  const user = userSnap.data();
  const tenantName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();

  const newStallSnap = await getDoc(doc(db, "stalls", newStallId));
  if (!newStallSnap.exists()) throw new Error("Selected stall not found.");
  if (newStallSnap.data().status !== "unoccupied") {
    throw new Error("Selected stall is no longer available.");
  }
  const newSpaceNo = String(newStallSnap.data().spaceId ?? newStallId);
  const newBuildingNo = String(newStallSnap.data().buildingNumber ?? "");

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

  batch.update(doc(db, "users", uid), { stallId: newStallId });

  batch.update(doc(db, "stalls", newStallId), {
    tenantId: uid,
    tenantName,
    status: "occupied",
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
};

export const restoreTenantToNewStall = async (
  uid: string,
  newStallId: string,
): Promise<void> => {
  const archiveSnap = await getDoc(doc(db, "archives", uid));
  if (!archiveSnap.exists()) throw new Error("Archive record not found.");

  const archive = archiveSnap.data();
  const tenantName = `${archive.firstName ?? ""} ${archive.lastName ?? ""}`.trim();

  // Verify the new stall is still unoccupied before committing
  const stallSnap = await getDoc(doc(db, "stalls", newStallId));
  if (!stallSnap.exists()) throw new Error("Selected stall not found.");
  if (stallSnap.data().status !== "unoccupied") {
    throw new Error("Selected stall is no longer available.");
  }

  const newSpaceNo = String(stallSnap.data().spaceId ?? newStallId);

  // Re-enable login before committing the restore.
  await setTenantAccountDisabled(uid, false);

  const batch = writeBatch(db);

  batch.update(doc(db, "users", uid), {
    status: "active",
    stallId: newStallId,
  });

  batch.update(doc(db, "stalls", newStallId), {
    tenantId: uid,
    tenantName,
    status: "occupied",
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
};
