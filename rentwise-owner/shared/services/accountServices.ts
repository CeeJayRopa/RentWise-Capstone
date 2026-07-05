import {
  doc,
  getDoc,
  writeBatch,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { firebaseApp } from "../firebaseConfig";
import { auth } from "./auth";
import { db } from "./firestore";

const cloudFunctions = getFunctions(firebaseApp);

// Disables/re-enables the tenant's Firebase Auth login itself — separate
// from the Firestore `status` field, which only controls what the app
// shows. Without this, an "archived" tenant's account still works and
// they can keep signing in.
const setTenantAccountDisabled = async (
  uid: string,
  disabled: boolean,
): Promise<void> => {
  const callerUid = auth.currentUser?.uid;
  if (!callerUid) throw new Error("Owner not authenticated.");
  const setDisabledFn = httpsCallable(cloudFunctions, "adminSetAccountDisabled");
  await setDisabledFn({ uid, disabled, callerUid });
};

export const deleteArchivedTenant = async (uid: string): Promise<void> => {
  const archiveSnap = await getDoc(doc(db, "archives", uid));
  if (!archiveSnap.exists()) throw new Error("Archive record not found.");

  // Deletes Firebase Auth account so the username can be reused
  const callerUid = auth.currentUser?.uid;
  if (!callerUid) throw new Error("Owner not authenticated.");
  const deleteFn = httpsCallable(cloudFunctions, "adminDeleteTenant");
  await deleteFn({ uid, callerUid });

  const batch = writeBatch(db);
  batch.delete(doc(db, "archives", uid));
  batch.delete(doc(db, "users", uid));
  await batch.commit();
};

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

  if (stallId) {
    const stallSnap = await getDoc(doc(db, "stalls", stallId));
    if (stallSnap.exists() && stallSnap.data().status === "unoccupied") {
      batch.update(doc(db, "stalls", stallId), {
        tenantId: uid,
        tenantName,
        status: "occupied",
      });
    }
  }

  batch.delete(doc(db, "archives", uid));

  await batch.commit();
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
};
