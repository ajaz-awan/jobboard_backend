import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
const { Schema } = mongoose;
const base = () => ({ _id: { type: String, default: randomUUID } });
const options = {
  strict: "throw", optimisticConcurrency: true,
  timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  toJSON: { virtuals: true, transform(doc, ret) {
    ret.id = ret._id;
    for (const field of ["_id", "__v", "password_hash", "resume_path", "deleted_at", "auth_version",
      "email_verification_hash", "email_verification_expires", "verification_sent_at",
      "email_otp_hash", "email_otp_expires", "email_otp_attempts",
      "password_reset_hash", "password_reset_expires", "reset_sent_at",
      "refresh_hash", "used_hashes", "encrypted_payload"]) delete ret[field];
    return ret;
  } },
};
const userSchema = new Schema({
  ...base(), name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  password_hash: { type: String, required: true, select: false },
  role: { type: String, enum: ["candidate", "employer", "admin"], default: "candidate", required: true },
  status: { type: String, enum: ["active", "suspended"], default: "active", required: true },
  suspension_reason: { type: String, maxlength: 500, select: false },
  email_verified_at: { type: Date, default: null },
  auth_version: { type: Number, default: 0, min: 0, select: false },
  email_verification_hash: { type: String, select: false },
  email_verification_expires: { type: Date, select: false },
  verification_sent_at: { type: Date, select: false },
  email_otp_hash: { type: String, select: false },
  email_otp_expires: { type: Date, select: false },
  email_otp_attempts: { type: Number, default: 0, min: 0, select: false },
  password_reset_hash: { type: String, select: false },
  password_reset_expires: { type: Date, select: false },
  reset_sent_at: { type: Date, select: false },
  company_name: { type: String, maxlength: 150, default: null }, logo_url: { type: String, default: null },
}, options);
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ status: 1, role: 1, created_at: -1, _id: -1 });
userSchema.index({ email_verification_hash: 1 }, { unique: true, sparse: true });
userSchema.index({ password_reset_hash: 1 }, { unique: true, sparse: true });
userSchema.virtual("email_verified").get(function () { return Boolean(this.email_verified_at); });

const salary = { type: Number, min: 0, max: 1_000_000_000, validate: value => value == null || Number.isInteger(value) };
const jobSchema = new Schema({
  ...base(), employer_id: { type: String, ref: "User", required: true, immutable: true },
  title: { type: String, trim: true, minlength: 3, maxlength: 150, required: true },
  description: { type: String, trim: true, minlength: 10, maxlength: 20000, required: true },
  location: { type: String, trim: true, maxlength: 150 },
  job_type: { type: String, enum: ["full-time", "part-time", "contract", "internship"], default: "full-time" },
  salary_min: salary, salary_max: salary,
  expires_at: { type: Date, default: null },
  work_mode: { type: String, enum: ["onsite", "hybrid", "remote"], default: "onsite" },
  experience_level: { type: String, enum: ["entry", "mid", "senior", "any"], default: "any" },
  skills: { type: [{ type: String, maxlength: 40 }], default: [], validate: value => value.length <= 20 },
  moderation_status: { type: String, enum: ["pending", "approved", "blocked"], default: "approved" },
  moderation_reason: { type: String, maxlength: 500, select: false },
  status: { type: String, enum: ["open", "closed"], default: "open", required: true },
  deleted_at: { type: Date, default: null, select: false },
}, options);
jobSchema.pre("validate", function () {
  if (this.salary_min != null && this.salary_max != null && this.salary_max < this.salary_min) {
    this.invalidate("salary_max", "Maximum salary must be at least minimum salary");
  }
});
jobSchema.index({ deleted_at: 1, status: 1, created_at: -1, _id: -1 });
jobSchema.index({ employer_id: 1, deleted_at: 1, created_at: -1, _id: -1 });
jobSchema.index({ deleted_at: 1, salary_max: -1, _id: -1 });
jobSchema.index({ title: "text", description: "text", location: "text" }, { weights: { title: 3, description: 1, location: 1 } });
jobSchema.index({ moderation_status: 1, status: 1, deleted_at: 1, created_at: -1 });
jobSchema.virtual("revision").get(function () { return this.__v ?? 0; });

const applicationSchema = new Schema({
  ...base(), job_id: { type: String, ref: "Job", required: true, immutable: true },
  candidate_id: { type: String, ref: "User", required: true, immutable: true },
  resume_path: { type: String, required: true, select: false },
  cover_letter: { type: String, maxlength: 2000, default: null },
  status: { type: String, enum: ["pending", "accepted", "rejected", "withdrawn"], default: "pending", required: true },
}, options);
applicationSchema.index({ candidate_id: 1, job_id: 1 }, { unique: true });
applicationSchema.index({ candidate_id: 1, created_at: -1, _id: -1 });
applicationSchema.index({ job_id: 1, created_at: -1, _id: -1 });
applicationSchema.virtual("jobs", { ref: "Job", localField: "job_id", foreignField: "_id", justOne: true });
applicationSchema.virtual("users", { ref: "User", localField: "candidate_id", foreignField: "_id", justOne: true });

const savedJobSchema = new Schema({
  ...base(), candidate_id: { type: String, ref: "User", required: true, immutable: true },
  job_id: { type: String, ref: "Job", required: true, immutable: true },
}, options);
savedJobSchema.index({ candidate_id: 1, job_id: 1 }, { unique: true });
savedJobSchema.index({ candidate_id: 1, created_at: -1, _id: -1 });
savedJobSchema.virtual("jobs", { ref: "Job", localField: "job_id", foreignField: "_id", justOne: true });
export const User = mongoose.model("User", userSchema);
export const Job = mongoose.model("Job", jobSchema);
export const Application = mongoose.model("Application", applicationSchema);
export const SavedJob = mongoose.model("SavedJob", savedJobSchema);

const sessionSchema = new Schema({
  ...base(), user_id: { type: String, ref: "User", required: true, immutable: true },
  auth_version: { type: Number, required: true, min: 0 },
  refresh_hash: { type: String, required: true, select: false },
  used_hashes: { type: [String], default: [], select: false },
  rotations: { type: Number, default: 0, min: 0, max: 1000 },
  expires_at: { type: Date, required: true }, revoked_at: { type: Date, default: null },
  last_used_at: { type: Date, default: Date.now }, user_agent: { type: String, maxlength: 160 },
}, options);
sessionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ user_id: 1, revoked_at: 1, expires_at: 1 });
export const Session = mongoose.model("Session", sessionSchema);

const emailJobSchema = new Schema({
  ...base(), encrypted_payload: { type: String, required: true, select: false },
  expires_at: { type: Date, required: true }, sent_at: { type: Date, default: null },
  lease_until: { type: Date, default: null }, next_attempt_at: { type: Date, default: Date.now },
  attempts: { type: Number, default: 0, min: 0 },
}, options);
emailJobSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
emailJobSchema.index({ sent_at: 1, next_attempt_at: 1, lease_until: 1 });
export const EmailJob = mongoose.model("EmailJob", emailJobSchema);

const notificationSchema = new Schema({
  ...base(), user_id: { type: String, ref: "User", required: true, immutable: true },
  kind: { type: String, enum: ["application_received", "application_decision", "application_withdrawn", "job_moderated", "account_status", "report_reviewed"], required: true },
  title: { type: String, required: true, maxlength: 150 }, message: { type: String, required: true, maxlength: 1000 },
  resource_type: { type: String, enum: ["job", "application", "account", "report"] }, resource_id: String,
  read_at: { type: Date, default: null }, dedupe_key: { type: String, maxlength: 200, select: false },
  expires_at: { type: Date, default: () => new Date(Date.now() + 90 * 86400_000) },
}, options);
notificationSchema.index({ user_id: 1, read_at: 1, created_at: -1, _id: -1 });
notificationSchema.index({ user_id: 1, dedupe_key: 1 }, { unique: true, partialFilterExpression: { dedupe_key: { $type: "string" } } });
notificationSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
export const Notification = mongoose.model("Notification", notificationSchema);

const reportSchema = new Schema({
  ...base(), job_id: { type: String, ref: "Job", required: true }, reporter_id: { type: String, ref: "User", required: true },
  reason: { type: String, enum: ["scam", "spam", "discrimination", "misleading", "other"], required: true },
  details: { type: String, maxlength: 2000, default: "" },
  status: { type: String, enum: ["open", "resolved", "dismissed"], default: "open" },
  resolution_note: { type: String, maxlength: 1000, select: false }, reviewed_by: { type: String, ref: "User" }, reviewed_at: Date,
}, options);
reportSchema.index({ job_id: 1, reporter_id: 1 }, { unique: true });
reportSchema.index({ status: 1, created_at: -1, _id: -1 });
reportSchema.index({ reporter_id: 1, created_at: -1, _id: -1 });
reportSchema.virtual("jobs", { ref: "Job", localField: "job_id", foreignField: "_id", justOne: true });
export const Report = mongoose.model("Report", reportSchema);

const auditSchema = new Schema({
  ...base(), actor_id: { type: String, required: true }, action: { type: String, enum: ["user_status", "job_moderation", "report_review"], required: true },
  target_id: { type: String, required: true }, request_id: String,
  outcome: { type: String, enum: ["attempted", "completed", "failed"], default: "attempted" },
  details: { type: Schema.Types.Mixed, default: {} },
}, options);
auditSchema.index({ created_at: -1, _id: -1 });
auditSchema.index({ actor_id: 1, created_at: -1 });
export const AuditLog = mongoose.model("AuditLog", auditSchema);

const rateBucketSchema = new Schema({ _id: String, count: Number, reset_at: Date }, { strict: "throw", versionKey: false });
rateBucketSchema.index({ reset_at: 1 }, { expireAfterSeconds: 0 });
export const RateLimitBucket = mongoose.model("RateLimitBucket", rateBucketSchema);

const cleanupSchema = new Schema({
  ...base(), driver: { type: String, enum: ["local", "s3"], default: "local", required: true }, bucket: { type: String, enum: ["resumes", "logos"], required: true }, key: { type: String, required: true, maxlength: 100 },
  attempts: { type: Number, default: 0 }, lease_until: { type: Date, default: null }, next_attempt_at: { type: Date, default: Date.now },
}, options);
cleanupSchema.index({ driver: 1, bucket: 1, key: 1 }, { unique: true });
cleanupSchema.index({ next_attempt_at: 1, lease_until: 1 });
export const FileCleanupJob = mongoose.model("FileCleanupJob", cleanupSchema);
