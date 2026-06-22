import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "./firestore";

// ── Legacy schema (kept for backward-compat with existing Firestore docs) ──────

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

// ── New detailed schema ────────────────────────────────────────────────────────

export type DetailedUpdatePayload = {
  module: string;
  type: string;
  fieldChanged?: string;
  targetId?: string;
  tenantId?: string;
  tenantName?: string;
  spaceNo?: string;
  buildingNo?: string;
  oldValue?: string;
  newValue?: string;
  paymentAmount?: number;
  paymentMethod?: string;
  changedBy: string;
  approvalStatus: "pending";
};

export const logDetailedUpdate = async (
  payload: DetailedUpdatePayload,
): Promise<void> => {
  try {
    await addDoc(collection(db, "updates"), {
      ...payload,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error("logDetailedUpdate error:", err);
  }
};
