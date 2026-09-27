import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDb } from "./db";
import authRoutes from "./routes/auth";
import usersRoutes from "./routes/users";
import stallsRoutes from "./routes/stalls";
import paymentsRoutes from "./routes/payments";

async function main() {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters");
  }
  await connectDb();

  const app = express();
  app.disable("x-powered-by");
  const allowedOrigins = new Set(
    (process.env.CORS_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error("Origin not allowed"));
    },
    methods: ["GET", "POST", "PATCH"],
    allowedHeaders: ["Authorization", "Content-Type"],
  }));
  app.use(express.json({ limit: "32kb", strict: true }));

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/auth", authRoutes);
  app.use("/users", usersRoutes);
  app.use("/stalls", stallsRoutes);
  app.use("/payments", paymentsRoutes);

  const port = Number(process.env.PORT) || 4000;
  app.listen(port, () => console.log(`[mongo-backend] listening on :${port}`));
}

main().catch((err) => {
  console.error("[mongo-backend] failed to start:", err);
  process.exit(1);
});
