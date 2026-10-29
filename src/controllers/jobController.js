import { Job } from "../models/index.js";
import { jobAvailable, publicationFilter } from "../services/jobVisibility.js";
import { validSalary } from "../schemas/jobSchema.js";
import { paginate } from "../utils/paginate.js";
import AppError from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
export const loadJob = async id => {
  const job = await Job.findOne({ _id: id, deleted_at: null });
  if (!job) throw new AppError("Job not found", 404);
  return job;
};
const ensureOwner = (job, user) => {
  if (job.employer_id !== user.id) throw new AppError("You can only modify your own jobs", 403);
};
const literalRegex = value => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
export const createJob = asyncHandler(async (req, res) => {
  const job = await Job.create({ ...req.body, employer_id: req.user.id, moderation_status: "pending" });
  res.status(201).json({ success: true, job });
});
export const getAllJobs = asyncHandler(async (req, res) => {
  const { title, location, job_type, salary_min, sort, q, work_mode, experience_level, page, limit } = req.query;
  const filter = publicationFilter();
  // Directory browsing always means published/open jobs; employer drafts are under /mine.
  if (title) filter.title = literalRegex(title);
  if (location) filter.location = literalRegex(location);
  if (job_type) filter.job_type = job_type;
  if (work_mode) filter.work_mode = work_mode;
  if (experience_level) filter.experience_level = experience_level;
  if (salary_min !== undefined) filter.salary_max = { $gte: salary_min };
  if (q) filter.$text = { $search: q };
  const ordering = sort === "salary" ? { salary_max: -1, _id: -1 } : { created_at: sort === "oldest" ? 1 : -1, _id: -1 };
  const [result] = await Job.aggregate([
    { $match: filter },
    { $lookup: { from: "users", localField: "employer_id", foreignField: "_id", as: "owner", pipeline: [{ $project: { status: 1 } }] } },
    { $match: { "owner.0": { $exists: true }, "owner.status": { $ne: "suspended" } } },
    { $facet: { data: [{ $sort: ordering }, { $skip: (page - 1) * limit }, { $limit: limit },
      { $project: { owner: 0, moderation_reason: 0, deleted_at: 0 } }], meta: [{ $count: "total" }] } },
  ]).option({ maxTimeMS: 5000 });
  const jobs = result.data.map(({ _id, __v, ...job }) => ({ ...job, id: _id, revision: __v ?? 0 }));
  const total = result.meta[0]?.total ?? 0;
  res.json({ success: true, jobs, total, count: jobs.length, page, totalPages: Math.ceil(total / limit) });
});
export const getJobById = asyncHandler(async (req, res) => {
  const job = await loadJob(req.params.id);
  if (req.user?.id !== job.employer_id && req.user?.role !== "admin" && !await jobAvailable(job)) throw new AppError("Job not found", 404);
  res.json({ success: true, job });
});
export const updateJob = asyncHandler(async (req, res) => {
  const job = await loadJob(req.params.id);
  ensureOwner(job, req.user);
  if (!validSalary({ salary_min: job.salary_min, salary_max: job.salary_max, ...req.body })) throw new AppError("Maximum salary must be at least minimum salary", 400);
  const deadline = Object.hasOwn(req.body, "expires_at") ? req.body.expires_at : job.expires_at;
  if (req.body.status === "open" && deadline && new Date(deadline) <= new Date()) throw new AppError("Extend the deadline before reopening this job", 400);
  const contentChanged = Object.keys(req.body).some(key => key !== "status");
  job.set(req.body);
  if (contentChanged) job.moderation_status = "pending";
  await job.save(); // Optimistic concurrency prevents lost updates and salary-range races.
  res.json({ success: true, job });
});
export const deleteJob = asyncHandler(async (req, res) => {
  const job = await loadJob(req.params.id);
  ensureOwner(job, req.user);
  // Keep referenced application history instead of orphaning documents/files.
  job.status = "closed"; job.deleted_at = new Date();
  await job.save();
  res.json({ success: true, message: "Job deleted" });
});
