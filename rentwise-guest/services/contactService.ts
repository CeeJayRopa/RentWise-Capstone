import { httpsCallable } from "firebase/functions";

import { functions } from "../shared/firebaseConfig";

export type ContactMessageInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  message: string;
};

// Unlike AR placement logging, a failed submit here must surface to the
// caller — the person filling this out needs to know if their message
// actually went anywhere, not have it silently swallowed.
export async function submitContactMessage(input: ContactMessageInput): Promise<void> {
  const submit = httpsCallable<ContactMessageInput, { ok: boolean }>(functions, "submitPublicContactMessage");
  await submit(input);
}
