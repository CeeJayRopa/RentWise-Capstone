import { initializeApp, deleteApp } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  deleteUser as deleteAuthUser,
  sendPasswordResetEmail,
} from "firebase/auth";
import type { User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";

import { firebaseApp } from "../firebaseConfig";
import { auth } from "./auth";
import { db } from "./firestore";
import { logDetailedUpdate } from "./updatesService";

type CreateTenantParams = {
  firstName: string;
  lastName: string;
  userName: string;
  contactNo: string;
  password: string;
  stallId: string;
};

export const createTenantAccount = async (
  params: CreateTenantParams,
): Promise<{ uid: string }> => {
  const {
    firstName,
    lastName,
    userName,
    contactNo,
    password,
    stallId,
  } = params;
  const email = `${userName}@rentwise.app`;

  // Username uniqueness check before Auth creation minimizes orphan accounts
  const existing = await getDocs(
    query(collection(db, "users"), where("userName", "==", userName)),
  );
  if (!existing.empty) {
    throw new Error("Username is already taken.");
  }

  const appName = `tenant-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const secondaryApp = initializeApp(firebaseApp.options, appName);
  const secondaryAuth = getAuth(secondaryApp);
  let createdUser: User | null = null;

  try {
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      email,
      password,
    );
    createdUser = credential.user;
    const uid = createdUser.uid;

    const batch = writeBatch(db);

    batch.set(doc(db, "users", uid), {
      firstName,
      lastName,
      userName,
      email,
      contactNo,
      role: "tenant",
      stallId,
      status: "active",
      createdAt: serverTimestamp(),
    });

    batch.update(doc(db, "stalls", stallId), {
      tenantId: uid,
      tenantName: `${firstName} ${lastName}`,
      status: "occupied",
    });

    await batch.commit();

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
    throw err;
  } finally {
    await deleteApp(secondaryApp);
  }
};

export const sendTenantPasswordReset = async (
  userName: string,
): Promise<void> => {
  await sendPasswordResetEmail(auth, `${userName}@rentwise.app`);
};

export const archiveTenant = async (uid: string): Promise<void> => {
  const userSnap = await getDoc(doc(db, "users", uid));
  if (!userSnap.exists()) throw new Error("User not found.");

  const user = userSnap.data();
  const stallId = (user.stallId as string) ?? "";

  let buildingNumber = "";
  let spaceId = "";
  let paymentSchedule = "";

  if (stallId) {
    const stallSnap = await getDoc(doc(db, "stalls", stallId));
    if (stallSnap.exists()) {
      const sd = stallSnap.data();
      buildingNumber = (sd.buildingNumber as string) ?? "";
      spaceId = (sd.spaceId as string) ?? "";
      paymentSchedule = (sd.paymentSchedule as string) ?? "";
    }
  }

  const batch = writeBatch(db);

  batch.set(doc(db, "archives", uid), {
    originalUid: uid,
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    userName: user.userName ?? "",
    contactNo: user.contactNo ?? "",
    stallId,
    buildingNumber,
    spaceId,
    paymentSchedule,
    archivedAt: serverTimestamp(),
  });

  batch.update(doc(db, "users", uid), { status: "archived" });

  if (stallId) {
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

export const restoreTenant = async (uid: string): Promise<void> => {
  const archiveSnap = await getDoc(doc(db, "archives", uid));
  if (!archiveSnap.exists()) throw new Error("Archive record not found.");

  const archive = archiveSnap.data();
  const stallId = (archive.stallId as string) ?? "";
  const tenantName = `${archive.firstName ?? ""} ${archive.lastName ?? ""}`.trim();

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
