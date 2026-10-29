import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import nodemailer from "nodemailer";
import { EmailJob } from "../models/index.js";
import { env } from "../config/env.js";
const key = Buffer.from(hkdfSync("sha256", env.JWT_SECRET, "jobboard", "email-queue-v1", 32));
function encrypt(payload) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  const bytes = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), bytes].map(b => b.toString("base64url")).join(".");
}
function decrypt(value) {
  const [iv, tag, bytes] = value.split(".").map(s => Buffer.from(s, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", key, iv); cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(bytes), cipher.final()]).toString("utf8"));
}
export function actionLink(path, token) {
  const url = new URL(path, env.CLIENT_URL); url.hash = new URLSearchParams({ token }).toString(); return url.toString();
}
export const enqueueMail = (payload, expires = new Date(Date.now() + 86400_000)) => EmailJob.create({
  encrypted_payload: encrypt(payload), expires_at: expires,
});
const smtp = env.MAIL_TRANSPORT === "smtp" ? nodemailer.createTransport({
  host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465,
  requireTLS: env.SMTP_PORT !== 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 10000,
  disableFileAccess: true, disableUrlAccess: true,
}) : null;
export const mailTransport = {
  async send(message, id) {
    if (smtp) { await smtp.sendMail({ from: env.MAIL_FROM, ...message }); return; }
    await mkdir(resolve(env.MAIL_OUTBOX_DIR), { recursive: true, mode: 0o700 });
    await writeFile(resolve(env.MAIL_OUTBOX_DIR, `${id}.json`), JSON.stringify({ from: env.MAIL_FROM, ...message }, null, 2), { mode: 0o600 });
  },
};
export async function processNextMail() {
  const now = new Date();
  const job = await EmailJob.findOneAndUpdate({ sent_at: null, expires_at: { $gt: now }, attempts: { $lt: 5 },
    next_attempt_at: { $lte: now }, $or: [{ lease_until: null }, { lease_until: { $lte: now } }] },
    { $set: { lease_until: new Date(Date.now() + 60000) }, $inc: { attempts: 1 } },
    { returnDocument: "after", sort: { created_at: 1 } }).select("+encrypted_payload");
  if (!job) return false;
  try {
    await mailTransport.send(decrypt(job.encrypted_payload), job.id);
    await EmailJob.updateOne({ _id: job.id }, { $set: { sent_at: new Date(), lease_until: null }, $unset: { encrypted_payload: 1 } });
  } catch {
    await EmailJob.updateOne({ _id: job.id }, { $set: { lease_until: null,
      next_attempt_at: new Date(Date.now() + Math.min(60000, 1000 * 2 ** job.attempts)) } });
    console.error(JSON.stringify({ event: "email_delivery_failed", jobId: job.id, attempt: job.attempts }));
  }
  return true;
}
export function startMailWorker() {
  let running = null, stopped = false;
  const tick = () => {
    if (running || stopped) return;
    running = processNextMail().catch(() => console.error(JSON.stringify({ event: "email_worker_failed" }))).finally(() => { running = null; });
  };
  const timer = setInterval(tick, 1000); timer.unref(); tick();
  return async () => { stopped = true; clearInterval(timer); await running; smtp?.close(); };
}
