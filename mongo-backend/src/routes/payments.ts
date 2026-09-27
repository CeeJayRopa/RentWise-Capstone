import { Router } from "express";
import { Payment } from "../models/Payment";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

const router = Router();

// Mirrors paymentService.ts's createPayment(data) -- tenant creates their
// own payment record. userId is taken from the authenticated token, not
// trusted from the request body, unlike the original client-side
// Firestore write (which relied on Firestore security rules for that
// instead) -- a real improvement this migration gets "for free."
router.post("/", requireAuth("tenant"), async (_req: AuthedRequest, res) => {
  return res.status(503).json({
    error: "Payment creation is disabled until provider verification is implemented.",
  });
});

// Mirrors paymentService.ts's getPaymentsByUser(userId) --
// query(collection(db, "payments"), where("userId", "==", userId))
router.get("/mine", requireAuth("tenant"), async (req: AuthedRequest, res) => {
  const payments = await Payment.find({ userId: req.user!.id }).sort({ date: -1 });
  return res.json(payments);
});

// Admin/owner: view any tenant's payments.
router.get("/user/:userId", requireAuth("admin", "owner"), async (req, res) => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(req.params.userId)) {
    return res.status(400).json({ error: "Invalid user ID" });
  }
  const payments = await Payment.find({ userId: req.params.userId }).sort({ date: -1 });
  return res.json(payments);
});

export default router;
