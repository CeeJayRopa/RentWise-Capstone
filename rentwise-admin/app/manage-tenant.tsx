import { AccountScreen } from "./account";

/**
 * Tenant Management owns this route. It intentionally has its own route and
 * onboarding key so future tenant-specific actions can be added without
 * changing the Stall Management "Manage Account" flow.
 */
export default function ManageTenant() {
  return (
    <AccountScreen
      manageTitle="Manage Tenant"
      manageTourKey="manage-tenant"
      allowArchive
    />
  );
}
