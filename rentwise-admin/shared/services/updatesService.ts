import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "./firestore";

type BuildingUpdate = {
  category: "building";
  spaceNo: string;
  status: string;
  change: string;
};

type FinanceUpdate = {
  category: "finance";
  tenantName: string;
  status: string;
  spaceNo: string;
  change: string;
};

type ArchiveUpdate = {
  category: "archive";
  tenantName: string;
  status: string;
  change: string;
};

export type UpdatePayload = BuildingUpdate | FinanceUpdate | ArchiveUpdate;

export const logUpdate = async (payload: UpdatePayload): Promise<void> => {
  try {
    await addDoc(collection(db, "updates"), {
      ...payload,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error("logUpdate error:", err);
  }
};
