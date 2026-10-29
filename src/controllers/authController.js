import bcrypt from "bcryptjs";
import { User, Session } from "../models/index.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import AppError from "../utils/AppError.js";
import { createSession, rotateSession, setRefreshCookie, clearRefreshCookie, refreshCookieName,
  revokeByRefresh, revokeAllSessions, hashToken } from "../services/sessions.js";
import { requestAccountEmail, consumeSignupOtp } from "../services/accountTokens.js";
import { enqueueMail } from "../services/mail.js";
const dummyHash = bcrypt.hashSync("unavailable-account-placeholder", 12);
const generic = { success: true, message: "If the account is eligible, an email will be sent shortly" };
function respondWithSession(res, user, result, status = 200) {
  setRefreshCookie(res, result.refreshToken, result.session.expires_at);
  res.status(status).json({ success: true, user, token: result.token, verification_required: !user.email_verified_at });
}
export const register = asyncHandler(async (req, res) => {
  const { name, email, password, role, company_name } = req.body;
  if (await User.exists({ email })) throw new AppError("Email is already registered", 409);
  const user = await User.create({ name, email, password_hash: await bcrypt.hash(password, 12), role, company_name: role === "employer" ? company_name : null });
  await requestAccountEmail(user.email, "verification");
  res.status(201).json({ success: true, verification_required: true, email: user.email,
    message: "Check your email for a 6-digit code. Verify it before signing in." });
});
export const login = asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: req.body.email }).select("+password_hash +auth_version");
  const matches = await bcrypt.compare(req.body.password, user?.password_hash || dummyHash);
  if (!user || !matches) throw new AppError("Invalid email or password", 401);
  if (user.status === "suspended") throw new AppError("Account is unavailable", 403);
  if (!user.email_verified_at) throw new AppError("Verify your email before signing in. Request a new code if needed.", 403);
  respondWithSession(res, user, await createSession(user, req.headers["user-agent"]));
});
export const refresh = asyncHandler(async (req, res) => {
  try {
    const result = await rotateSession(req.cookies?.[refreshCookieName]);
    respondWithSession(res, result.user, result);
  } catch (error) { clearRefreshCookie(res); throw error; }
});
export const logout = asyncHandler(async (req, res) => {
  await revokeByRefresh(req.cookies?.[refreshCookieName]); clearRefreshCookie(res); res.status(204).end();
});
export const logoutAll = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(req.user.id, { $inc: { auth_version: 1 } }, { returnDocument: "after" });
  if (!user) throw new AppError("Account is unavailable", 401);
  await revokeAllSessions(req.user.id); clearRefreshCookie(res); res.status(204).end();
});
export const resendVerification = asyncHandler(async (req, res) => { await requestAccountEmail(req.body.email, "verification"); res.json(generic); });
export const forgotPassword = asyncHandler(async (req, res) => { await requestAccountEmail(req.body.email, "reset"); res.json(generic); });
export const verifySignup = asyncHandler(async (req, res) => {
  await consumeSignupOtp(req.body.email, req.body.otp);
  res.json({ success: true, message: "Email verified. You can now sign in." });
});
export const verifyEmail = asyncHandler(async (req, res) => {
  const user = await User.findOneAndUpdate({ email_verification_hash: hashToken(req.body.token), email_verification_expires: { $gt: new Date() }, email_verified_at: null, status: "active" },
    { $set: { email_verified_at: new Date() }, $unset: { email_verification_hash: 1, email_verification_expires: 1, email_otp_hash: 1, email_otp_expires: 1, email_otp_attempts: 1 } }, { returnDocument: "after" });
  if (!user) throw new AppError("Invalid or expired verification link", 400);
  res.json({ success: true, message: "Email verified" });
});
async function passwordChanged(user) {
  // User version is already incremented atomically, so session invalidation fails closed even if cleanup is temporarily unavailable.
  try { await revokeAllSessions(user.id); } catch { console.error(JSON.stringify({ event: "session_cleanup_pending" })); }
  try { await enqueueMail({ to: user.email, subject: "Your Job Board password changed", text: "Your password was changed and your sessions were signed out. If this was not you, reset your password immediately." }); }
  catch { console.error(JSON.stringify({ event: "password_notification_failed" })); }
}
export const resetPassword = asyncHandler(async (req, res) => {
  const filter = { password_reset_hash: hashToken(req.body.token), password_reset_expires: { $gt: new Date() } };
  if (!await User.exists(filter)) throw new AppError("Invalid or expired reset link", 400);
  const password_hash = await bcrypt.hash(req.body.password, 12);
  const user = await User.findOneAndUpdate({ ...filter, password_reset_expires: { $gt: new Date() } },
    { $set: { password_hash }, $inc: { auth_version: 1 }, $unset: { password_reset_hash: 1, password_reset_expires: 1, reset_sent_at: 1 } }, { returnDocument: "after" });
  if (!user) throw new AppError("Invalid or expired reset link", 400);
  await passwordChanged(user); clearRefreshCookie(res);
  res.json({ success: true, message: "Password reset. Please log in again" });
});
export const changePassword = asyncHandler(async (req, res) => {
  const current = await User.findById(req.user.id).select("+password_hash +auth_version");
  if (!current || !await bcrypt.compare(req.body.current_password, current.password_hash)) throw new AppError("Current password is incorrect", 401);
  const password_hash = await bcrypt.hash(req.body.new_password, 12);
  const user = await User.findOneAndUpdate({ _id: current.id, password_hash: current.password_hash },
    { $set: { password_hash }, $inc: { auth_version: 1 }, $unset: { password_reset_hash: 1, password_reset_expires: 1, reset_sent_at: 1 } }, { returnDocument: "after" });
  if (!user) throw new AppError("Account changed; log in again", 409);
  await passwordChanged(user); clearRefreshCookie(res); res.json({ success: true, message: "Password changed. Please log in again" });
});
export const listSessions = asyncHandler(async (req, res) => {
  const sessions = await Session.find({ user_id: req.user.id, auth_version: req.user.auth_version, revoked_at: null, expires_at: { $gt: new Date() } })
    .select("created_at last_used_at expires_at user_agent").sort({ created_at: -1 }).limit(50);
  res.json({ success: true, data: sessions.map(session => ({ id: session.id, created_at: session.created_at,
    last_used_at: session.last_used_at, expires_at: session.expires_at, user_agent: session.user_agent, current: session.id === req.sessionId })) });
});
export const revokeSession = asyncHandler(async (req, res) => {
  const session = await Session.findOneAndUpdate({ _id: req.params.id, user_id: req.user.id }, { $set: { revoked_at: new Date() } });
  if (!session) throw new AppError("Session not found", 404);
  if (req.params.id === req.sessionId) clearRefreshCookie(res);
  res.status(204).end();
});
