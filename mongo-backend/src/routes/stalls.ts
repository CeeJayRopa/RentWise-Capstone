import { Router } from "express";
import { Stall } from "../models/Stall";
import { requireAuth } from "../middleware/auth";
import { boundedNumber, isObjectId } from "../validation";

const router = Router();

// List all stalls -- the MongoDB-backed equivalent of
// getDocs(collection(db, "stalls")), used throughout admin/owner building
// views. Open to any authenticated role for now (tenants can see stall
// listings in the real app too); tighten per-field visibility later if the
// real Firestore rules restrict something this doesn't yet.
router.get("/", requireAuth(), async (_req, res) => {
  const stalls = await Stall.find();
  return res.json(stalls);
});

router.get("/:id", requireAuth(), async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(400).json({ error: "Invalid stall ID" });
  const stall = await Stall.findById(req.params.id);
  if (!stall) return res.status(404).json({ error: "Stall not found" });
  return res.json(stall);
});

// Mirrors edit-rental-info.tsx's updateDoc(doc(db, "stalls", stallId), {...})
router.patch("/:id", requireAuth("admin", "owner"), async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(400).json({ error: "Invalid stall ID" });
  const { length, width, price, paymentSchedule, category } = req.body;
  const cleanLength = boundedNumber(length, 0.1, 1000);
  const cleanWidth = boundedNumber(width, 0.1, 1000);
  const cleanPrice = boundedNumber(price, 0, 1_000_000);
  const schedules = ["daily", "weekly", "semi-monthly", "monthly"];
  const categories = ["Wet Market", "Dry Market", "Home Essential"];
  if (
    cleanLength === null || cleanWidth === null || cleanPrice === null ||
    !schedules.includes(paymentSchedule) || !categories.includes(category)
  ) {
    return res.status(400).json({ error: "Invalid stall update" });
  }
  const stall = await Stall.findByIdAndUpdate(
    req.params.id,
    { length: cleanLength, width: cleanWidth, price: cleanPrice, paymentSchedule, category },
    { new: true, runValidators: true }
  );
  if (!stall) return res.status(404).json({ error: "Stall not found" });
  return res.json(stall);
});

export default router;
