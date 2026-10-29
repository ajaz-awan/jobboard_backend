import mongoose from "mongoose";
import { env } from "./env.js";
import "../models/index.js";

mongoose.set("bufferCommands", false);
mongoose.set("strictQuery", "throw");
export async function connectDatabase(uri = env.MONGODB_URI) {
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000, socketTimeoutMS: 15000,
    maxPoolSize: 20, minPoolSize: 0, autoIndex: false,
  });
  // Build required uniqueness indexes before accepting requests. Never drops existing indexes.
  await Promise.all(Object.values(mongoose.models).map(model => model.createIndexes()));
}
export const closeDatabase = () => mongoose.disconnect();
export const databaseReady = () => mongoose.connection.readyState === 1;
