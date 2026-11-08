/** Builds the canonical RentWise username (for example, Jaycee -> RWJAYCEE). */
export function rentWiseUsernameBase(firstName: string): string {
  const normalizedFirstName = firstName
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();

  if (!normalizedFirstName) throw new Error("Enter a valid first name.");
  return `RW${normalizedFirstName}`;
}

/** Fixed usernames for the two single privileged RentWise accounts. */
export const RENTWISE_ADMIN_USERNAME = "RWADMIN";
export const RENTWISE_OWNER_USERNAME = "RWOWNER";
