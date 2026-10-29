import { createHash } from "node:crypto";
import rateLimit from "express-rate-limit";
import { RateLimitBucket } from "../models/index.js";
import { env } from "../config/env.js";
export class MongoRateLimitStore {
  constructor(prefix) { this.prefix = prefix; this.localKeys = false; }
  init(options) { this.windowMs = options.windowMs; }
  id(key) { return `${this.prefix}:${createHash("sha256").update(key).digest("hex")}`; }
  async increment(key) {
    const now = new Date(), reset = new Date(Date.now() + this.windowMs);
    const update = [{ $set: {
      count: { $cond: [{ $gt: ["$reset_at", now] }, { $add: [{ $ifNull: ["$count", 0] }, 1] }, 1] },
      reset_at: { $cond: [{ $gt: ["$reset_at", now] }, "$reset_at", reset] },
    } }];
    let result;
    try { result = await RateLimitBucket.collection.findOneAndUpdate({ _id: this.id(key) }, update, { upsert: true, returnDocument: "after", includeResultMetadata: false }); }
    catch (error) { if (error.code !== 11000) throw error; result = await RateLimitBucket.collection.findOneAndUpdate({ _id: this.id(key) }, update, { returnDocument: "after", includeResultMetadata: false }); }
    return { totalHits: result.count, resetTime: result.reset_at };
  }
  async decrement(key) { await RateLimitBucket.updateOne({ _id: this.id(key), count: { $gt: 0 } }, { $inc: { count: -1 } }); }
  async resetKey(key) { await RateLimitBucket.deleteOne({ _id: this.id(key) }); }
}
export const makeLimiter = (namespace, limit, windowMs = 15 * 60_000) => rateLimit({
  limit, windowMs, standardHeaders: "draft-8", legacyHeaders: false,
  message: { success: false, message: "Too many requests. Try again later." },
  ...(env.RATE_LIMIT_STORE === "mongo" ? { store: new MongoRateLimitStore(namespace) } : {}),
});
