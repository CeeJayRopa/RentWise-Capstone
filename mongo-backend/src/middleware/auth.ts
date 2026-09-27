import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/User";
import { isObjectId } from "../validation";

export interface AuthedRequest extends Request {
  user?: { id: string; role: "tenant" | "admin" | "owner" };
}

// Mirrors the role check pattern the Cloud Functions already use
// (assertIsAdmin/assertIsOwner in functions/src/index.ts) -- one shared
// middleware instead of duplicating that check per-route the way the
// original three assert* functions did.
export function requireAuth(...allowedRoles: Array<"tenant" | "admin" | "owner">) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });

    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) throw new Error("JWT_SECRET is not set");
      const payload = jwt.verify(token, secret, {
        algorithms: ["HS256"],
        issuer: "rentwise-mongo-backend",
        audience: "rentwise-apps",
      });
      const subject = typeof payload === "object" ? payload.sub : undefined;
      if (!isObjectId(subject)) {
        return res.status(401).json({ error: "Invalid or expired token" });
      }

      // Role and account status come from the database on every request.
      // A stale token cannot retain privileges after a role/disable change.
      const account = await User.findById(subject).select("role status").lean();
      if (!account || account.status !== "active") {
        return res.status(401).json({ error: "Account is unavailable" });
      }
      if (allowedRoles.length > 0 && !allowedRoles.includes(account.role)) {
        return res.status(403).json({ error: "Not authorized for this role" });
      }
      req.user = { id: subject, role: account.role };
      return next();
    } catch {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}
