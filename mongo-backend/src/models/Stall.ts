import { Schema, model, type InferSchemaType } from "mongoose";

// Fields verified against real writes in rentwise-admin/app/edit-rental-info.tsx
// (length, width, price, paymentSchedule, category) and
// functions/src/index.ts's adminCreateTenant (tenantId, status) -- price
// here is the DAILY rate, matching the existing "convert at the boundary"
// convention already used throughout the real app (see edit-rental-info.tsx).
const stallSchema = new Schema(
  {
    buildingNumber: { type: String, required: true },
    spaceId: { type: String, required: true },
    length: { type: Number },
    width: { type: Number },
    price: { type: Number, default: 0 }, // daily rate
    paymentSchedule: { type: String, enum: ["daily", "weekly", "semi-monthly", "monthly"] },
    category: { type: String },
    tenantId: { type: String, default: null },
    status: { type: String, enum: ["vacant", "occupied"], default: "vacant" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export type StallDoc = InferSchemaType<typeof stallSchema>;
export const Stall = model("Stall", stallSchema);
