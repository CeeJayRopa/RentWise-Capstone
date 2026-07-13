import { doc, getDoc, updateDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

import { db, firebaseApp, auth } from "../shared/firebaseConfig";

const cloudFunctions = getFunctions(firebaseApp);

export interface Tenant {
  id: string;

  name?: string;

  email?: string;

  role?: string;

  stallId?: string;

  firstName?: string;

  lastName?: string;

  contactNo?: string;

  // Real personal email, distinct from the synthetic `email` (username@rentwise.app)
  // used internally — only present once the tenant has added one, which enables
  // self-service password reset. Optional: many tenants may never set this.
  personalEmail?: string;

  mustChangePassword?: boolean;

  stall?: any;
}

export async function updateTenantProfile(userId: string, data: any) {
  const ref = doc(db, "users", userId);

  await updateDoc(ref, data);
}

// Adds/updates the tenant's real email — this both changes their Firebase
// Auth account's actual sign-in email (via the Cloud Function, since a
// client can't do that for itself without a recent-login check) and stores
// it on their Firestore doc, so "Forgot password" can find it afterward.
export async function syncPersonalEmail(personalEmail: string): Promise<void> {
  const callerUid = auth.currentUser?.uid;
  if (!callerUid) throw new Error("Not authenticated.");
  const syncFn = httpsCallable(cloudFunctions, "syncPersonalEmail");
  await syncFn({ callerUid, personalEmail });
}

export async function getTenantData(uid: string): Promise<Tenant | null> {
  const userRef = doc(db, "users", uid);

  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    return null;
  }

  const userData = userSnap.data() as Tenant;

  let stallData = null;

  if (userData.stallId) {
    const stallRef = doc(
      db,

      "stalls",

      userData.stallId,
    );

    const stallSnap = await getDoc(stallRef);

    if (stallSnap.exists()) {
      stallData = {
        id: stallSnap.id,

        ...stallSnap.data(),
      };
    }
  }

  return {
    ...userData,

    id: userSnap.id,

    stall: stallData,
  };
}
