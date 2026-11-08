import {getFunctions, httpsCallable} from "firebase/functions";

import {firebaseApp} from "../firebaseConfig";
import {auth} from "./auth";

const cloudFunctions = getFunctions(firebaseApp);

export const restoreTenant = async (uid: string): Promise<void> => {
  if (!auth.currentUser?.uid) throw new Error("Owner not authenticated.");
  const restore = httpsCallable(cloudFunctions, "ownerRestoreArchivedTenant");
  await restore({uid});
};

export const restoreTenantToNewStall = async (
  uid: string,
  newStallId: string,
  transferPreviousInfo: boolean,
): Promise<void> => {
  if (!auth.currentUser?.uid) throw new Error("Owner not authenticated.");
  const restore = httpsCallable(cloudFunctions, "ownerRestoreArchivedTenant");
  await restore({uid, newStallId, transferPreviousInfo});
};
