import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/User";
import { normalizeEmail } from "../validation";

const router = Router();

function signToken(user: { _id: unknown }) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return jwt.sign({}, secret, {
    algorithm: "HS256",
    subject: String(user._id),
    issuer: "rentwise-mongo-backend",
    audience: "rentwise-apps",
    expiresIn: "1h",
  });
}

// Mirrors adminCreateTenant's shape (functions/src/index.ts) for the tenant
// case; admin/owner creation should get their own guarded routes later
// (adminCreateTenant is itself admin-only, not public) -- this route is
// deliberately unauthenticated for now only to prove the schema/hashing/JWT
// pipeline end-to-end. Lock this down before it's used for anything real.
router.post("/register", (_req, res) => {
  return res.status(503).json({
    error: "Registration is disabled until an administrator-only provisioning flow is implemented.",
  });
});

const loginAttempts = new Map<string, { count: number; startedAt: number }>();

router.post("/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    if (!email || typeof password !== "string" || password.length > 128) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const attemptKey = `${req.ip}:${email}`;
    const now = Date.now();
    const attempts = loginAttempts.get(attemptKey);
    if (attempts && now - attempts.startedAt < 15 * 60_000 && attempts.count >= 5) {
      return res.status(429).json({ error: "Too many attempts. Try again later." });
    }
    if (!attempts || now - attempts.startedAt >= 15 * 60_000) {
      loginAttempts.set(attemptKey, { count: 1, startedAt: now });
    } else {
      attempts.count += 1;
    }

    const user = await User.findOne({ email });
    if (!user || user.status !== "active") {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const valid = user.passwordHash.startsWith("$2") &&
      await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    loginAttempts.delete(attemptKey);

    return res.json({ token: signToken(user), userId: user._id, role: user.role });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Login failed" });
  }
});

export default router;
