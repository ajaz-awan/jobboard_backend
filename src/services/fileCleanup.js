import { FileCleanupJob } from "../models/index.js";
import { deleteStoredFile } from "../utils/fileStorage.js";
export async function processNextCleanup() {
  const now = new Date();
  const job = await FileCleanupJob.findOneAndUpdate({ attempts: { $lt: 5 }, next_attempt_at: { $lte: now },
    $or: [{ lease_until: null }, { lease_until: { $lte: now } }] },
    { $set: { lease_until: new Date(Date.now() + 60000) }, $inc: { attempts: 1 } }, { returnDocument: "after" });
  if (!job) return false;
  try { await deleteStoredFile(job.bucket, job.key, job.driver); await FileCleanupJob.deleteOne({ _id: job.id }); }
  catch { await FileCleanupJob.updateOne({ _id: job.id }, { $set: { lease_until: null, next_attempt_at: new Date(Date.now() + 1000 * 2 ** job.attempts) } }); }
  return true;
}
export function startCleanupWorker() {
  let running = null, stopped = false;
  const tick = () => {
    if (running || stopped) return;
    running = processNextCleanup().catch(() => console.error(JSON.stringify({ event: "file_cleanup_worker_failed" }))).finally(() => { running = null; });
  };
  const timer = setInterval(tick, 5000); timer.unref(); tick();
  return async () => { stopped = true; clearInterval(timer); await running; };
}
