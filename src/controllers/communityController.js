import { Notification, Report, Application, SavedJob, Job } from "../models/index.js";
import { loadJob } from "./jobController.js";
import { jobAvailable } from "../services/jobVisibility.js";
import { paginate } from "../utils/paginate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import AppError from "../utils/AppError.js";
const activeNotifications = userId => ({ user_id: userId, expires_at: { $gt: new Date() } });
export const listNotifications = asyncHandler(async (req, res) => {
  const filter = activeNotifications(req.user.id);
  if (req.query.read === "unread") filter.read_at = null;
  res.json({ success: true, ...await paginate(Notification, filter, req.query) });
});
export const unreadCount = asyncHandler(async (req, res) => res.json({ success: true, count: await Notification.countDocuments({ ...activeNotifications(req.user.id), read_at: null }).maxTimeMS(5000) }));
export const readNotification = asyncHandler(async (req, res) => {
  const data = await Notification.findOneAndUpdate({ _id: req.params.id, ...activeNotifications(req.user.id) }, { $set: { read_at: new Date() } }, { returnDocument: "after" });
  if (!data) throw new AppError("Notification not found", 404);
  res.json({ success: true, data });
});
export const readAllNotifications = asyncHandler(async (req, res) => {
  await Notification.updateMany({ ...activeNotifications(req.user.id), read_at: null }, { $set: { read_at: new Date() } });
  res.status(204).end();
});
export const reportJob = asyncHandler(async (req, res) => {
  const job = await loadJob(req.params.id);
  if (!await jobAvailable(job)) throw new AppError("Published job not found", 404);
  const data = await Report.create({ ...req.body, job_id: job.id, reporter_id: req.user.id });
  res.status(201).json({ success: true, data });
});
export const myReports = asyncHandler(async (req, res) => res.json({ success: true, ...await paginate(Report, { reporter_id: req.user.id }, req.query) }));
export const dashboard = asyncHandler(async (req, res) => {
  const unread = Notification.countDocuments({ ...activeNotifications(req.user.id), read_at: null }).maxTimeMS(5000);
  let jobs, applications, saved;
  if (req.user.role === "candidate") {
    [applications, saved] = await Promise.all([
      Application.aggregate([{ $match: { candidate_id: req.user.id } }, { $group: { _id: "$status", total: { $sum: 1 } } }]).option({ maxTimeMS: 5000 }),
      SavedJob.countDocuments({ candidate_id: req.user.id }).maxTimeMS(5000),
    ]);
  } else {
    [jobs, applications] = await Promise.all([
      Job.aggregate([{ $match: { employer_id: req.user.id, deleted_at: null } }, { $group: { _id: { status: "$status", moderation_status: { $ifNull: ["$moderation_status", "approved"] } }, total: { $sum: 1 } } }]).option({ maxTimeMS: 5000 }),
      Job.aggregate([{ $match: { employer_id: req.user.id } }, { $lookup: { from: "applications", localField: "_id", foreignField: "job_id", as: "summary", pipeline: [{ $group: { _id: "$status", total: { $sum: 1 } } }] } }, { $unwind: "$summary" }, { $group: { _id: "$summary._id", total: { $sum: "$summary.total" } } }]).option({ maxTimeMS: 5000 }),
    ]);
  }
  res.json({ success: true, data: { role: req.user.role, applications, ...(jobs ? { jobs } : {}), ...(saved !== undefined ? { saved_jobs: saved } : {}), unread_notifications: await unread } });
});
