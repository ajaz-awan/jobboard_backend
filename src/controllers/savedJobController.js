import { SavedJob, Job } from "../models/index.js";
import { jobAvailable } from "../services/jobVisibility.js";
import { loadJob } from "./jobController.js";
import { paginate } from "../utils/paginate.js";
import AppError from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
export const saveJob = asyncHandler(async (req, res) => {
  const job = await loadJob(req.params.id);
  if (!await jobAvailable(job)) throw new AppError("Open job not found", 404);
  try {
    await SavedJob.updateOne({ candidate_id: req.user.id, job_id: job.id },
      { $setOnInsert: { candidate_id: req.user.id, job_id: job.id } }, { upsert: true, runValidators: true });
  } catch (error) { if (error.code !== 11000) throw error; }
  res.json({ success: true });
});
export const unsaveJob = asyncHandler(async (req, res) => {
  await SavedJob.deleteOne({ candidate_id: req.user.id, job_id: req.params.id });
  res.status(204).end();
});
export const getSavedJobs = asyncHandler(async (req, res) => {
  const result = await paginate(SavedJob, { candidate_id: req.user.id }, req.query, {
    populate: { path: "jobs", select: "title location job_type status salary_min salary_max", match: { deleted_at: null } },
  });
  res.json({ success: true, ...result });
});
export const getEmployerJobs = asyncHandler(async (req, res) => {
  const { data: jobs, ...meta } = await paginate(Job, { employer_id: req.user.id, deleted_at: null }, req.query);
  res.json({ success: true, ...meta, jobs });
});
