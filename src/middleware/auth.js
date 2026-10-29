import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env.js";
import { User, Session } from "../models/index.js";
import AppError from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
export const protect = asyncHandler(async (req, res, next) => {
  const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization || "");
  if (!match) throw new AppError("A Bearer token is required", 401);
  const token = jwt.verify(match[1], env.JWT_SECRET, { algorithms: ["HS256"], issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE });
  if (!z.uuid().safeParse(token.sub).success || token.id !== token.sub || !z.uuid().safeParse(token.sid).success ||
      typeof token.exp !== "number" || !Number.isSafeInteger(token.ver) || token.ver < 0) throw new AppError("Invalid token claims", 401);
  const [user, session] = await Promise.all([
    User.findById(token.sub).select("role status email_verified_at").select("+auth_version"),
    Session.findOne({ _id: token.sid, user_id: token.sub, auth_version: token.ver, revoked_at: null, expires_at: { $gt: new Date() } }),
  ]);
  if (!user || user.status === "suspended" || !session || (user.auth_version ?? 0) !== token.ver || !["candidate", "employer", "admin"].includes(user.role)) throw new AppError("Session expired or revoked. Please log in again", 401);
  if (!user.email_verified_at) throw new AppError("Verify your email before signing in", 403);
  req.user = { id: user.id, role: user.role, email_verified: Boolean(user.email_verified_at), auth_version: user.auth_version ?? 0 };
  req.sessionId = session.id;
  req.sessionCreatedAt = session.created_at;
  next();
});
export const authorize = (...roles) => (req, res, next) => {
  if (!req.user) return next(new AppError("Authentication required", 401));
  if (!roles.includes(req.user.role)) return next(new AppError("Access denied", 403));
  next();
};
export const requireVerifiedEmail = (req, res, next) => {
  if (!req.user?.email_verified) return next(new AppError("Verify your email before performing this action", 403));
  next();
};
export const csrfProtection = (req, res, next) => {
  if (req.headers["x-csrf-protection"] !== "1") return next(new AppError("CSRF protection header is required", 403));
  if (req.headers.origin && req.headers.origin !== new URL(env.CLIENT_URL).origin) return next(new AppError("Origin is not allowed", 403));
  next();
};

export const requireRecentLogin = (req, res, next) => {
  if (!req.sessionCreatedAt || Date.now() - req.sessionCreatedAt.getTime() > 15 * 60_000) return next(new AppError("Log in again before this administrative action", 403));
  next();
};

// Public reads accept guests, but a supplied credential must still be valid.
export const optionalProtect = (req, res, next) => req.headers.authorization === undefined ? next() : protect(req, res, next);
