import AsyncStorage from "@react-native-async-storage/async-storage";

// Per-device flag: the dashboard's guided tour auto-opens the very first
// time the app runs on a device (fresh install), then never again
// automatically — the user can always re-open it via the Help button.
const TOUR_SEEN_KEY = "rentwise:ownerDashboardTourSeen";

export async function hasSeenDashboardTour(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(TOUR_SEEN_KEY)) === "true";
  } catch {
    return false;
  }
}

export async function markDashboardTourSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(TOUR_SEEN_KEY, "true");
  } catch {
    // Non-fatal — worst case the tour just auto-opens again next launch.
  }
}

// Same pattern, separate key — admin is a different app/device installation
// from owner, so it needs its own independent "have they seen it" flag.
const ADMIN_TOUR_SEEN_KEY = "rentwise:adminDashboardTourSeen";

export async function hasSeenAdminDashboardTour(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ADMIN_TOUR_SEEN_KEY)) === "true";
  } catch {
    return false;
  }
}

export async function markAdminDashboardTourSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(ADMIN_TOUR_SEEN_KEY, "true");
  } catch {
    // Non-fatal — worst case the tour just auto-opens again next launch.
  }
}

// Same pattern, separate key — tenant is a different app/device installation
// from owner and admin, so it needs its own independent "have they seen it" flag.
const TENANT_TOUR_SEEN_KEY = "rentwise:tenantDashboardTourSeen";

export async function hasSeenTenantDashboardTour(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(TENANT_TOUR_SEEN_KEY)) === "true";
  } catch {
    return false;
  }
}

export async function markTenantDashboardTourSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(TENANT_TOUR_SEEN_KEY, "true");
  } catch {
    // Non-fatal — worst case the tour just auto-opens again next launch.
  }
}

// Generic per-page version of the same pattern, for every other screen that
// has its own HelpTour — each app's AsyncStorage is already sandboxed per
// install, so a plain page key (e.g. "financials", "building") is enough;
// it can't collide between admin/owner/tenant even though several of them
// have a page with the same name.
export async function hasSeenPageTour(pageKey: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(`rentwise:tour:${pageKey}`)) === "true";
  } catch {
    return false;
  }
}

export async function markPageTourSeen(pageKey: string): Promise<void> {
  try {
    await AsyncStorage.setItem(`rentwise:tour:${pageKey}`, "true");
  } catch {
    // Non-fatal — worst case the tour just auto-opens again next launch.
  }
}
