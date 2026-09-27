import { Schema, model, type InferSchemaType } from "mongoose";

// Field shape mirrors the real Firestore users/{uid} document exactly, as
// written by adminCreateTenant in functions/src/index.ts -- so a data sync
// from Firestore can map straight across with no field renaming. passwordHash
// is new here since Firebase Auth (which held passwords separately) has no
// MongoDB equivalent -- see MONGODB_BACKUP_ROADMAP.md's Auth section.
const userSchema = new Schema(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    contactNo: { type: String },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["tenant", "admin", "owner"], required: true },
    status: { type: String, enum: ["active", "disabled"], default: "active" },

    // Tenant-specific billing terms -- present only when role === "tenant".
    // Kept optional (not a separate schema/collection) to match Firestore's
    // single flexible users collection rather than introducing a split this
    // project doesn't already have.
    stallId: { type: String },
    price: { type: Number },
    paymentSchedule: { type: String, enum: ["daily", "weekly", "semi-monthly", "monthly"] },
    category: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export type UserDoc = InferSchemaType<typeof userSchema>;
export const User = model("User", userSchema);
