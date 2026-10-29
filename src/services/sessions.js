import { randomBytes, randomUUID, createHash } from "node:crypto";
import { Session, User } from "../models/index.js";
import { env } from "../config/env.js";
import { generateToken } from "../utils/generateToken.js";
import AppError from "../utils/AppError.js";
export const hashToken = token => createHash("sha256").update(token).digest("hex");
export const randomToken = () => randomBytes(32).toString("hex");
export const refreshCookieName = env.NODE_ENV === "production" ? "__Secure-jobboard_refresh" : "jobboard_refresh";
const cookieOptions = { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth" };
export const clearRefreshCookie = res => res.clearCookie(refreshCookieName, cookieOptions);
export const setRefreshCookie = (res, value, expires) => res.cookie(refreshCookieName, value, { ...cookieOptions, expires });
const active = () => ({ revoked_at: null, expires_at: { $gt: new Date() } });
const unauthorized = () => new AppError("Session expired or revoked. Please log in again", 401);
export async function createSession(user, userAgent = "") {
  if (!user.email_verified_at) throw new AppError("Verify your email before signing in", 403);
  const id = randomUUID(), secret = randomToken();
  const version = user.auth_version ?? 0;
  const expires = new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86400_000);
  const session = await Session.create({ _id: id, user_id: user.id, auth_version: version,
    refresh_hash: hashToken(secret), expires_at: expires,
    user_agent: userAgent.replace(/[\r\n\x00-\x1f]/g, " ").slice(0, 160) });
  const current = await User.findById(user.id).select("+auth_version");
  if (!current || !current.email_verified_at || current.status === "suspended" || (current.auth_version ?? 0) !== version) {
    await Session.updateOne({ _id: id }, { $set: { revoked_at: new Date() } });
    throw unauthorized();
  }
  return { session, token: generateToken(user.id, user.role, { sessionId: id, authVersion: version }), refreshToken: `${id}.${secret}` };
}
function parse(value) {
  const match = /^([0-9a-f-]{36})\.([0-9a-f]{64})$/i.exec(value || "");
  return match ? { id: match[1], hash: hashToken(match[2]) } : null;
}
export async function rotateSession(value) {
  const parsed = parse(value);
  if (!parsed) throw unauthorized();
  const secret = randomToken();
  const session = await Session.findOneAndUpdate({ _id: parsed.id, ...active(), refresh_hash: parsed.hash, rotations: { $lt: 1000 } },
    { $set: { refresh_hash: hashToken(secret), last_used_at: new Date() }, $push: { used_hashes: parsed.hash }, $inc: { rotations: 1 } },
    { returnDocument: "after" });
  if (!session) {
    // Revoke only when a known used token is replayed; a guessed secret cannot revoke a family.
    await Session.updateOne({ _id: parsed.id, ...active(), $or: [{ used_hashes: parsed.hash }, { refresh_hash: parsed.hash, rotations: { $gte: 1000 } }] },
      { $set: { revoked_at: new Date() } });
    throw unauthorized();
  }
  const user = await User.findById(session.user_id).select("+auth_version");
  if (!user || !user.email_verified_at || user.status === "suspended" || (user.auth_version ?? 0) !== session.auth_version) {
    await Session.updateOne({ _id: session.id }, { $set: { revoked_at: new Date() } }); throw unauthorized();
  }
  return { user, session, token: generateToken(user.id, user.role, { sessionId: session.id, authVersion: session.auth_version }), refreshToken: `${session.id}.${secret}` };
}
export async function revokeByRefresh(value) {
  const parsed = parse(value);
  if (parsed) await Session.updateOne({ _id: parsed.id, $or: [{ refresh_hash: parsed.hash }, { used_hashes: parsed.hash }] }, { $set: { revoked_at: new Date() } });
}
export const revokeAllSessions = userId => Session.updateMany({ user_id: userId, revoked_at: null }, { $set: { revoked_at: new Date() } });
