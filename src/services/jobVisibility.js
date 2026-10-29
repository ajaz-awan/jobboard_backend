import { User, Job } from "../models/index.js";
export const publicationFilter = () => ({ deleted_at: null, status: "open", moderation_status: { $nin: ["pending", "blocked"] },
  $or: [{ expires_at: null }, { expires_at: { $gt: new Date() } }] });
export async function jobAvailable(job) {
  if (job.status !== "open" || ["pending", "blocked"].includes(job.moderation_status) || (job.expires_at && job.expires_at <= new Date())) return false;
  return Boolean(await User.exists({ _id: job.employer_id, status: { $ne: "suspended" } }));
}
export async function stillAvailable(id) {
  const job = await Job.findOne({ _id: id, ...publicationFilter() }).select("employer_id");
  return Boolean(job && await User.exists({ _id: job.employer_id, status: { $ne: "suspended" } }));
}
