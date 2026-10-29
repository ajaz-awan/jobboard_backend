import { scanUpload } from "../services/malwareScan.js";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink, access } from "node:fs/promises";
import { resolve } from "node:path";
import { constants } from "node:fs";
import { pipeline } from "node:stream/promises";
import { FileCleanupJob } from "../models/index.js";
import { putObject, getObject, deleteObject, verifyObjectStorage } from "../services/objectStorage.js";
import { z } from "zod";
import { env } from "../config/env.js";
import AppError from "./AppError.js";

export function verifiedExtension(file) {
  const b = file.buffer;
  const signatures = {
    "application/pdf": () => b.subarray(0, 5).toString() === "%PDF-",
    "image/png": () => b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
    "image/jpeg": () => b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255,
    "image/webp": () => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP",
  };
  if (!signatures[file.mimetype]?.()) throw new AppError("File content does not match its type", 400);
  return { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[file.mimetype];
}

export function resolveStoredFile(bucket, key) {
  if (!["resumes", "logos"].includes(bucket)) throw new AppError("Invalid storage bucket", 400);
  const parts = key?.split("/") || [];
  if (parts.length !== 2 || !z.uuid().safeParse(parts[0]).success || !/^[0-9a-f-]{36}\.(pdf|png|jpg|webp)$/i.test(parts[1])) {
    throw new AppError("Invalid file path", 400);
  }
  if (!z.uuid().safeParse(parts[1].split(".")[0]).success) throw new AppError("Invalid filename", 400);
  return resolve(env.UPLOAD_DIR, bucket, ...parts);
}
export const storeFile = async (file, bucket, userId) => {
  const ext = verifiedExtension(file);
  if ((bucket === "resumes" && ext !== "pdf") || (bucket === "logos" && ext === "pdf")) throw new AppError("Unsupported file type", 400);
  await scanUpload(file.buffer);
  const key = `${userId}/${randomUUID()}.${ext}`;
  const path = resolveStoredFile(bucket, key);
  if (env.STORAGE_DRIVER === "s3") await putObject(bucket, key, file);
  else {
    await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
    await writeFile(path, file.buffer, { flag: "wx", mode: 0o600 });
  }
  return { key, url: bucket === "logos" ? `/api/files/logos/${key}` : null };
};
export async function deleteStoredFile(bucket, key, driver = env.STORAGE_DRIVER) {
  const path = resolveStoredFile(bucket, key); // Validate keys before either backend sees them.
  if (driver === "s3") { try { await deleteObject(bucket, key); } catch (error) { if (error.statusCode !== 404) throw error; } }
  else { try { await unlink(path); } catch (error) { if (error.code !== "ENOENT") throw error; } }
}
export const removeStoredFile = async (bucket, key) => {
  try { await deleteStoredFile(bucket, key); }
  catch {
    try { await FileCleanupJob.updateOne({ driver: env.STORAGE_DRIVER, bucket, key }, { $setOnInsert: { driver: env.STORAGE_DRIVER, bucket, key } }, { upsert: true }); }
    catch { console.error(JSON.stringify({ event: "file_cleanup_queue_failed", bucket })); }
    console.error(JSON.stringify({ event: "file_cleanup_pending", bucket }));
  }
};
export async function initializeStorage() {
  if (env.STORAGE_DRIVER === "s3") await verifyObjectStorage();
  else {
    await mkdir(resolve(env.UPLOAD_DIR), { recursive: true, mode: 0o700 });
    await access(resolve(env.UPLOAD_DIR), constants.R_OK | constants.W_OK);
  }
}
export async function sendStoredFile(res, next, bucket, key, download = false) {
  const path = resolveStoredFile(bucket, key);
  if (env.STORAGE_DRIVER === "s3") {
    const object = await getObject(bucket, key);
    if (!object.Body) throw new AppError("File not found", 404);
    const mime = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", webp: "image/webp" }[key.split(".").pop().toLowerCase()];
    res.type(mime);
    res.setHeader("Cache-Control", "no-store");
    if (download) res.attachment("resume.pdf");
    const close = () => { if (!res.writableFinished) object.Body.destroy(); };
    res.once("close", close);
    try { await pipeline(object.Body, res); }
    finally { res.off("close", close); }
    return;
  }
  const done = error => {
    if (!error) return;
    next(error.code === "ENOENT" || error.status === 404 ? new AppError("File not found", 404) : error);
  };
  if (download) res.download(path, "resume.pdf", { dotfiles: "deny" }, done);
  else res.sendFile(path, { dotfiles: "deny" }, done);
}
