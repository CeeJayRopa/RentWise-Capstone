import { Router } from "express";
import { User } from "../models/User";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

const router = Router();

// First proof-of-concept read: "get my own profile," the MongoDB-backed
// equivalent of a Firestore getDoc(doc(db, "users", uid)) call. Every other
// screen's data fetch (stalls, payments, etc.) follows this same shape --
// route + requireAuth + Mongoose query -- once this pattern is proven.
router.get("/me", requireAuth(), async (req: AuthedRequest, res) => {
  const user = await User.findById(req.user!.id).select("-passwordHash");
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json(user);
});

export default router;
