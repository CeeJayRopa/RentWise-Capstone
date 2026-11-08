import { doc, getDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

import { db, firebaseApp, auth } from "../shared/firebaseConfig";
import { readLocalCache, saveLocalCache } from "../shared/services/localCache";

const cloudFunctions = getFunctions(firebaseApp);

export interface Tenant {
  id: string;

  name?: string;

  email?: string;

  username?: string;

  role?: string;

  stallId?: string;
  primaryStallId?: string;
  stallIds?: string[];
  stallAssignments?: Array<{
    stallId: string;
    dailyRate: number;
    assignedAt?: any;
  }>;

  firstName?: string;

  lastName?: string;

  contactNo?: string;

  // Real personal email, distinct from the synthetic `email` (username@rentwise.app)
  // used internally — only present once the tenant has added one, which enables
  // self-service password reset. Optional: many tenants may never set this.
  personalEmail?: string;

  mustChangePassword?: boolean;

  // This tenant's own billing terms -- the source of truth for rent
  // calculations (not the stall's, which is just a denormalized display
  // copy for the guest app). Travels with the tenant if they relocate.
  price?: number;
  paymentSchedule?: string;
  paymentIntervalDays?: number;
  category?: string;
  createdAt?: any;
  billingStartedAt?: any;
  lastApprovedPaymentAt?: any;
  paidThroughAt?: any;
  nextDueAt?: any;

  stall?: any;
}

export async function updateTenantProfile(userId: string, data: any) {
  if (auth.currentUser?.uid !== userId) throw new Error("Not authenticated.");
  const updateProfile = httpsCallable(cloudFunctions, "tenantUpdateOwnProfile");
  await updateProfile(data);
}

export async function finalizeTenantPasswordChange(): Promise<void> {
  if (!auth.currentUser?.uid) throw new Error("Not authenticated.");
  const finalize = httpsCallable(cloudFunctions, "tenantFinalizePasswordChange");
  await finalize({});
}

// Adds/updates the tenant's real email — this both changes their Firebase
// Auth account's actual sign-in email (via the Cloud Function, since a
// client can't do that for itself without a recent-login check) and stores
// it on their Firestore doc, so "Forgot password" can find it afterward.
export async function syncPersonalEmail(personalEmail: string): Promise<void> {
  if (!auth.currentUser?.uid) throw new Error("Not authenticated.");
  const syncFn = httpsCallable(cloudFunctions, "syncPersonalEmail");
  await syncFn({ personalEmail });
}

export async function getTenantData(uid: string): Promise<Tenant | null> {
  const cacheKey = `tenant:${uid}:profile`;
  try {
    const userRef = doc(db, "users", uid);

    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) return null;

  const userData = userSnap.data() as Tenant;
  const primaryStallId = userData.primaryStallId || userData.stallId || userData.stallIds?.[0];
  const stallIds = Array.from(new Set([
    ...(userData.stallIds ?? []),
    ...(primaryStallId ? [primaryStallId] : []),
  ].filter(Boolean)));

  let stallData = null;

  if (primaryStallId) {
    const stallRef = doc(
      db,

      "stalls",

      primaryStallId,
    );

    const stallSnap = await getDoc(stallRef);

    if (stallSnap.exists()) {
      stallData = {
        id: stallSnap.id,

        ...stallSnap.data(),
      };
    }
  }

    const tenant = {
      ...userData,
      id: userSnap.id,
      stallId: primaryStallId,
      primaryStallId,
      stallIds,
      stall: stallData,
    };
    await saveLocalCache(cacheKey, tenant);
    return tenant;
  } catch (error) {
    const cached = await readLocalCache<Tenant>(cacheKey);
    if (cached) return cached;
    throw error;
  }
}
