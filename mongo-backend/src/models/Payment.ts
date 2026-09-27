import { Schema, model, type InferSchemaType } from "mongoose";

// Fields verified against rentwise-tenant/services/paymentService.ts's
// `Payment` interface exactly -- userId (not tenantId, matches the real
// field name), method/status as free-form strings (matches the original,
// not narrowed to an enum here to avoid rejecting a value the real app
// already writes that this schema hasn't seen yet).
const paymentSchema = new Schema(
  {
    userId: { type: String, required: true },
    amount: { type: Number, required: true },
    method: { type: String, required: true },
    status: { type: String, required: true },
    receipt: { type: String },
    paymentId: { type: String },
    date: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

paymentSchema.index({ userId: 1 });

export type PaymentDoc = InferSchemaType<typeof paymentSchema>;
export const Payment = model("Payment", paymentSchema);
