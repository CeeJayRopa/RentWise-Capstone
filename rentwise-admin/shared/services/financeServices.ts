import type { QueryDocumentSnapshot, DocumentData } from "firebase/firestore";

export const getPaidTenantUserIds = (
  paymentDocs: QueryDocumentSnapshot<DocumentData, DocumentData>[]
): Set<string> => {
  return new Set(paymentDocs.map((d) => d.data().userId as string));
};
