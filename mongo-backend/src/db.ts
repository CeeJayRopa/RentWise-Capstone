import mongoose from "mongoose";

export async function connectDb(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set (see .env.example)");
  await mongoose.connect(uri);
  console.log("[mongo-backend] connected to MongoDB");
}
