import { User, Job, Application, Report, AuditLog } from "../models/index.js";
import { paginate } from "../utils/paginate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import AppError from "../utils/AppError.js";
import { auditedAction } from "../services/audit.js";
import { revokeAllSessions } from "../services/sessions.js";
import { notify } from "../services/notifications.js";
export const dashboard = asyncHandler(async (req, res) => {
  const [users, jobs, applications, reports] = await Promise.all([
    User.aggregate([{ $group: { _id: "$role", total: { $sum: 1 }, suspended: { $sum: { $cond: [{ $eq: ["$status", "suspended"] }, 1, 0] } } } }]).option({ maxTimeMS: 5000 }),
    Job.aggregate([{ $match: { deleted_at: null } }, { $group: { _id: { $ifNull: ["$moderation_status", "approved"] }, total: { $sum: 1 } } }]).option({ maxTimeMS: 5000 }),
    Application.countDocuments({}).maxTimeMS(5000), Report.countDocuments({ status: "open" }).maxTimeMS(5000),
  ]);
  res.json({ success: true, data: { users, jobs, applications, open_reports: reports } });
});
export const listUsers = asyncHandler(async (req, res) => {
  const { role, status, email } = req.query, filter = {};
  if (role) filter.role = role;
  if (status) filter.status = status === "active" ? { $ne: "suspended" } : "suspended";
  if (email) filter.email = email.toLowerCase();
  res.json({ success: true, ...await paginate(User, filter, req.query) });
});
export const setUserStatus = asyncHandler(async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target) throw new AppError("User not found", 404);
  if (target.role === "admin" || target.id === req.user.id) throw new AppError("Administrative accounts must be managed through trusted operations", 403);
  if (target.status === req.body.status) return res.json({ success: true, data: target });
  const data = await auditedAction(req, "user_status", target.id, { from: target.status, to: req.body.status, reason: req.body.reason }, async auditId => {
    const user = await User.findOneAndUpdate({ _id: target.id, role: { $ne: "admin" }, status: { $ne: req.body.status } },
      { $set: { status: req.body.status, suspension_reason: req.body.reason }, $inc: { auth_version: 1, __v: 1 } }, { returnDocument: "after", runValidators: true });
    if (!user) throw new AppError("User changed; reload and retry", 409);
    try { await revokeAllSessions(user.id); } catch { console.error(JSON.stringify({ event: "session_cleanup_pending" })); }
    await notify(user.id, "account_status", "Account status updated", `Your account is now ${req.body.status}. ${req.body.reason}`, "account", user.id, `audit:${auditId}`);
    return user;
  });
  res.json({ success: true, data });
});
export const listJobs = asyncHandler(async (req, res) => {
  const filter = { deleted_at: null };
  if (req.query.moderation_status) filter.moderation_status = req.query.moderation_status === "approved" ? { $nin: ["pending", "blocked"] } : req.query.moderation_status;
  if (req.query.employer_id) filter.employer_id = req.query.employer_id;
  res.json({ success: true, ...await paginate(Job, filter, req.query) });
});
export const moderateJob = asyncHandler(async (req, res) => {
  const data = await auditedAction(req, "job_moderation", req.params.id, { status: req.body.status, reason: req.body.reason, revision: req.body.revision }, async auditId => {
    const job = await Job.findOneAndUpdate({ _id: req.params.id, deleted_at: null, __v: req.body.revision },
      { $set: { moderation_status: req.body.status, moderation_reason: req.body.reason }, $inc: { __v: 1 } }, { returnDocument: "after", runValidators: true }).select("+moderation_reason");
    if (!job) {
      if (!await Job.exists({ _id: req.params.id, deleted_at: null })) throw new AppError("Job not found", 404);
      throw new AppError("Job changed since review; reload before moderating", 409);
    }
    await notify(job.employer_id, "job_moderated", "Job review completed", `Your job was ${req.body.status}. ${req.body.reason}`, "job", job.id, `audit:${auditId}`);
    return job;
  });
  res.json({ success: true, data });
});
export const listReports = asyncHandler(async (req, res) => {
  const filter = req.query.status ? { status: req.query.status } : {};
  res.json({ success: true, ...await paginate(Report, filter, req.query, { populate: { path: "jobs", select: "title employer_id status moderation_status" } }) });
});
export const reviewReport = asyncHandler(async (req, res) => {
  const data = await auditedAction(req, "report_review", req.params.id, { status: req.body.status, note: req.body.note }, async auditId => {
    const report = await Report.findOneAndUpdate({ _id: req.params.id, status: "open" }, { $set: {
      status: req.body.status, resolution_note: req.body.note, reviewed_by: req.user.id, reviewed_at: new Date(),
    } }, { returnDocument: "after", runValidators: true }).select("+resolution_note");
    if (!report) {
      if (!await Report.exists({ _id: req.params.id })) throw new AppError("Report not found", 404);
      throw new AppError("Report is already reviewed", 409);
    }
    await notify(report.reporter_id, "report_reviewed", "Your report was reviewed", `Your job report was ${req.body.status}.`, "report", report.id, `audit:${auditId}`);
    return report;
  });
  res.json({ success: true, data });
});
export const listAuditLogs = asyncHandler(async (req, res) => {
  const filter = {};
  for (const field of ["action", "actor_id", "outcome"]) if (req.query[field]) filter[field] = req.query[field];
  res.json({ success: true, ...await paginate(AuditLog, filter, req.query) });
});
