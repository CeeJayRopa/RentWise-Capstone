import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
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

type ReportCategory = "finance" | "building" | "archive";

function reportCategory(payload: DetailedUpdatePayload): ReportCategory {
  if (payload.module === "Financials") return "finance";
  if (payload.module === "Building Management" || payload.module === "Stall Management") {
    return "building";
  }
  return "archive";
}

function reportMessage(payload: DetailedUpdatePayload): string {
  const subject = payload.tenantName || (payload.spaceNo ? `Space ${payload.spaceNo}` : "Rental record");
  if (payload.paymentAmount != null) {
    const amount = payload.paymentAmount.toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${payload.type}: ${subject} · ₱${amount}`;
  }
  if (payload.fieldChanged && payload.newValue) {
    return `${payload.type}: ${subject} · ${payload.fieldChanged} changed to ${payload.newValue}`;
  }
  if (payload.newValue) return `${payload.type}: ${subject} · ${payload.newValue}`;
  return `${payload.type}: ${subject}`;
}

export const logDetailedUpdate = async (
  payload: DetailedUpdatePayload,
): Promise<void> => {
  try {
    const ownersSnap = await getDocs(
      query(collection(db, "users"), where("role", "==", "owner")),
    );
    const updateRef = doc(collection(db, "updates"));
    const category = reportCategory(payload);
    const message = reportMessage(payload);
    const batch = writeBatch(db);

    batch.set(updateRef, {
      ...payload,
      reportCategory: category,
      createdAt: serverTimestamp(),
      submittedAt: serverTimestamp(),
      notifiedAt: serverTimestamp(),
    });

    ownersSnap.docs.forEach((ownerDoc) => {
      batch.set(doc(db, "notifications", `notif_${updateRef.id}_${ownerDoc.id}`), {
        userId: ownerDoc.id,
        updateId: updateRef.id,
        reportCategory: category,
        title: payload.type,
        message,
        changedBy: payload.changedBy,
        status: "To be Acknowledged",
        read: false,
        createdAt: serverTimestamp(),
      });
    });

    await batch.commit();
  } catch (err) {
    console.error("logDetailedUpdate error:", err);
  }
};
