import { doc, getDoc, updateDoc } from "firebase/firestore";

import { db } from "../shared/firebaseConfig";

export interface Tenant {
  id: string;

  name?: string;

  email?: string;

  role?: string;

  stallId?: string;

  firstName?: string;

  lastName?: string;

  contactNo?: string;

  mustChangePassword?: boolean;

  stall?: any;
}

export async function updateTenantProfile(userId: string, data: any) {
  const ref = doc(db, "users", userId);

  await updateDoc(ref, data);
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
