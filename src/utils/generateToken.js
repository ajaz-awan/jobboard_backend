import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
export const generateToken = (userId, role, { sessionId, authVersion = 0 } = {}) => jwt.sign({
  id: userId, role, sid: sessionId, ver: authVersion,
}, env.JWT_SECRET, {
  algorithm: "HS256", expiresIn: env.JWT_EXPIRES_IN, issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE, subject: userId, jwtid: randomUUID(),
});
