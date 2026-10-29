import { Application, Job } from "../models/index.js";
import { jobAvailable, stillAvailable } from "../services/jobVisibility.js";
import { notify } from "../services/notifications.js";
import { loadJob } from "./jobController.js";
import { paginate } from "../utils/paginate.js";
import AppError from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { storeFile, removeStoredFile, sendStoredFile } from "../utils/fileStorage.js";
export const applyToJob = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError("Resume PDF is required (field: resume)", 400);
  const job = await loadJob(req.body.job_id);
  if (!await jobAvailable(job)) throw new AppError("Job is not accepting applications", 409);
  const filter = { candidate_id: req.user.id, job_id: job.id };
  if (await Application.exists(filter)) throw new AppError("You already applied to this job", 409);
  const file = await storeFile(req.file, "resumes", req.user.id);
  let application;
  try {
    application = await Application.create({ ...filter, cover_letter: req.body.cover_letter || null, resume_path: file.key });
    // Compensate if the job was closed/deleted while uploading. Standalone MongoDB
    // cannot provide a multi-document transaction; see README for this boundary.
    if (!await Job.exists({ _id: job.id, status: "open", deleted_at: null }) || !await stillAvailable(job.id)) throw new AppError("Job is no longer open", 409);
  } catch (error) {
    if (application) await Application.deleteOne({ _id: application.id });
    await removeStoredFile("resumes", file.key);
    throw error;
  }
  await notify(job.employer_id, "application_received", "New application", `A candidate applied to ${job.title}.`, "application", application.id, `application:${application.id}:received`);
  res.status(201).json({ success: true, data: application });
});
export const getMyApplications = asyncHandler(async (req, res) => {
  const filter = { candidate_id: req.user.id };
  if (req.query.status) filter.status = req.query.status;
  const result = await paginate(Application, filter, req.query, { populate: { path: "jobs", select: "title location job_type" } });
  res.json({ success: true, ...result });
});
export const getApplicationsForJob = asyncHandler(async (req, res) => {
  const job = await loadJob(req.params.jobId);
  if (job.employer_id !== req.user.id) throw new AppError("Access denied", 403);
  const filter = { job_id: job.id };
  if (req.query.status) filter.status = req.query.status;
  const result = await paginate(Application, filter, req.query, { populate: { path: "users", select: "name email" } });
  res.json({ success: true, ...result });
});
async function ownedApplication(req, resume = false) {
  const application = await Application.findById(req.params.id).select(resume ? "+resume_path" : "");
  if (!application) throw new AppError("Application not found", 404);
  const job = await Job.findById(application.job_id).select("employer_id");
  return { application, employer: job?.employer_id === req.user.id };
}
export const updateApplicationStatus = asyncHandler(async (req, res) => {
  const { application, employer } = await ownedApplication(req);
  if (!employer) throw new AppError("Access denied", 403);
  if (application.status !== "pending" && req.body.status !== application.status) throw new AppError("Final decisions cannot be changed", 409);
  const updated = await Application.findOneAndUpdate({ _id: application.id, status: application.status },
    { $set: { status: req.body.status } }, { returnDocument: "after", runValidators: true });
  if (!updated) throw new AppError("Application changed; reload and retry", 409);
  await notify(updated.candidate_id, "application_decision", "Application status updated", `Your application is ${updated.status}.`, "application", updated.id, `application:${updated.id}:${updated.status}`);
  res.json({ success: true, data: updated });
});
export const downloadResume = asyncHandler(async (req, res, next) => {
  const { application, employer } = await ownedApplication(req, true);
  if (!employer && application.candidate_id !== req.user.id) throw new AppError("Access denied", 403);
  if (!application.resume_path?.startsWith(`${application.candidate_id}/`)) throw new AppError("Resume is unavailable", 404);
  await sendStoredFile(res, next, "resumes", application.resume_path, true);
});

export const withdrawApplication = asyncHandler(async (req, res) => {
  const application = await Application.findOneAndUpdate({ _id: req.params.id, candidate_id: req.user.id, status: "pending" },
    { $set: { status: "withdrawn" } }, { returnDocument: "after", runValidators: true });
  if (!application) {
    if (!await Application.exists({ _id: req.params.id, candidate_id: req.user.id })) throw new AppError("Application not found", 404);
    throw new AppError("Only pending applications can be withdrawn", 409);
  }
  const job = await Job.findById(application.job_id).select("employer_id");
  if (job) await notify(job.employer_id, "application_withdrawn", "Application withdrawn", "A candidate withdrew an application.", "application", application.id, `application:${application.id}:withdrawn`);
  res.json({ success: true, data: application });
});
