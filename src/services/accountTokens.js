import { setTimeout as delay } from "node:timers/promises";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { User } from "../models/index.js";
import { env } from "../config/env.js";
import AppError from "../utils/AppError.js";
import { hashToken, randomToken } from "./sessions.js";
import { enqueueMail, actionLink } from "./mail.js";
// A server-keyed hash prevents an offline search of the small 6-digit code space.
const otpHash = (email, otp) => createHmac("sha256", env.JWT_SECRET)
  .update(`jobboard-signup-otp-v1:${email}:${otp}`).digest("hex");
export async function requestAccountEmail(email, kind) {
  const started = Date.now(), verification = kind === "verification";
  const sent = verification ? "verification_sent_at" : "reset_sent_at";
  const hash = verification ? "email_verification_hash" : "password_reset_hash";
  const expiry = verification ? "email_verification_expires" : "password_reset_expires";
  const token = randomToken(), expires = new Date(Date.now() + (verification ? 86400_000 : 30 * 60_000));
  const otp = verification ? String(randomInt(0, 1000000)).padStart(6, "0") : null;
  const otpFields = verification ? { email_otp_hash: otpHash(email, otp),
    email_otp_expires: new Date(Date.now() + 10 * 60_000), email_otp_attempts: 0 } : {};
  try {
    const user = await User.findOneAndUpdate({ email, ...(verification ? { email_verified_at: null, status: "active" } : {}),
      $or: [{ [sent]: null }, { [sent]: { $lte: new Date(Date.now() - 60_000) } }] },
      { $set: { [hash]: hashToken(token), [expiry]: expires, [sent]: new Date(), ...otpFields } }, { returnDocument: "after" });
    if (user) {
      try {
        const link = actionLink(verification ? "/verify-email" : "/reset-password", token);
        await enqueueMail({ to: user.email, subject: verification ? "Verify your Job Board email" : "Reset your Job Board password",
          text: verification
            ? `Your Job Board verification code is: ${otp}\nEnter this code on the signup screen. It expires in 10 minutes and allows 5 attempts. Never share this code.\nYou can also verify your email using this single-use link (expires in 24 hours): ${link}\nIf you did not request this, ignore this email.`
            : `Reset your password: ${link}\nThis link expires in 30 minutes. If you did not request it, ignore this email.` }, expires);
      } catch (error) {
        // Permit a retry only for the challenge whose durable queue write failed.
        await User.updateOne({ _id: user.id, [hash]: hashToken(token) }, { $unset: {
          [hash]: 1, [expiry]: 1, [sent]: 1,
          ...(verification ? { email_otp_hash: 1, email_otp_expires: 1, email_otp_attempts: 1 } : {}),
        } });
        throw error;
      }
    }
  } finally {
    await delay(Math.max(0, 200 - (Date.now() - started)));
  }
}
export async function consumeSignupOtp(email, otp) {
  const started = Date.now();
  const invalid = () => new AppError("Invalid or expired code. Request a new code if needed.", 400);
  try {
    const user = await User.findOne({ email, email_verified_at: null, status: "active" })
      .select("+email_otp_hash +email_otp_expires +email_otp_attempts");
    if (!user?.email_otp_hash || !user.email_otp_expires || user.email_otp_expires <= new Date()
      || user.email_otp_attempts >= 5) throw invalid();
    const filter = { _id: user.id, email_verified_at: null, status: "active",
      email_otp_hash: user.email_otp_hash, email_otp_expires: { $gt: new Date() }, email_otp_attempts: { $lt: 5 } };
    if (!timingSafeEqual(Buffer.from(otpHash(email, otp), "hex"), Buffer.from(user.email_otp_hash, "hex"))) {
      await User.updateOne(filter, { $inc: { email_otp_attempts: 1 } });
      throw invalid();
    }
    const verified = await User.findOneAndUpdate(filter, { $set: { email_verified_at: new Date() },
      $unset: { email_otp_hash: 1, email_otp_expires: 1, email_otp_attempts: 1,
        email_verification_hash: 1, email_verification_expires: 1 } }, { returnDocument: "after" });
    if (!verified) throw invalid();
    return verified;
  } finally {
    await delay(Math.max(0, 200 - (Date.now() - started)));
  }
}
