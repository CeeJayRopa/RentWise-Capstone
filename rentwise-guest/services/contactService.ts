import { addDoc, collection, serverTimestamp } from "firebase/firestore";

import { db } from "../shared/firebaseConfig";

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
  await addDoc(collection(db, "contactMessages"), {
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    message: input.message,
    createdAt: serverTimestamp(),
  });
}
