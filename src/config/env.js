import "dotenv/config";
import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  CLIENT_URL: z.url().default("http://localhost:3000"),
  MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//).default("mongodb://127.0.0.1:27017/jobboard"),
  UPLOAD_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(8),
  UPLOAD_DIR: z.string().min(1).default("./uploads"),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().regex(/^\d+[smhd]$/).default("15m"),
  JWT_ISSUER: z.string().default("jobboard-api"),
  JWT_AUDIENCE: z.string().default("jobboard-client"),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  MAIL_TRANSPORT: z.enum(["outbox", "smtp"]).default("outbox"),
  MAIL_OUTBOX_DIR: z.string().min(1).default("./.mail-outbox"),
  MAIL_FROM: z.email().default("noreply@jobboard.local"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MALWARE_SCAN: z.enum(["none", "clamav"]).default("none"),
  CLAMAV_HOST: z.string().min(1).default("127.0.0.1"),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  ALLOW_LOCAL_STORAGE_IN_PRODUCTION: z.enum(["true", "false"]).default("false").transform(v => v === "true"),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/).optional(),
  S3_ENDPOINT: z.url().optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("false").transform(v => v === "true"),
  S3_KEY_PREFIX: z.string().regex(/^[a-zA-Z0-9_/-]*$/).default("jobboard"),
  RATE_LIMIT_STORE: z.enum(["memory", "mongo"]).default("memory"),
  LOG_REQUESTS: z.enum(["true", "false"]).default("false").transform(v => v === "true"),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
}).superRefine((value, ctx) => {
  if (value.STORAGE_DRIVER === "s3") {
    if (!value.S3_BUCKET) ctx.addIssue({ code: "custom", path: ["S3_BUCKET"], message: "Private bucket required" });
    if (Boolean(value.S3_ACCESS_KEY_ID) !== Boolean(value.S3_SECRET_ACCESS_KEY)) ctx.addIssue({ code: "custom", path: ["S3_ACCESS_KEY_ID"], message: "Provide both S3 credentials, or use an IAM role" });
  }
  if (value.MAIL_TRANSPORT === "smtp") {
    for (const field of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) {
      if (!value[field]) ctx.addIssue({ code: "custom", path: [field], message: "SMTP configuration required" });
    }
  }
  if (value.NODE_ENV === "production") {
    if (value.MALWARE_SCAN !== "clamav") ctx.addIssue({ code: "custom", path: ["MALWARE_SCAN"], message: "Production uploads require malware scanning" });
    if (value.RATE_LIMIT_STORE !== "mongo") ctx.addIssue({ code: "custom", path: ["RATE_LIMIT_STORE"], message: "Shared rate limits required in production" });
    if (value.STORAGE_DRIVER === "local" && !value.ALLOW_LOCAL_STORAGE_IN_PRODUCTION) ctx.addIssue({ code: "custom", path: ["STORAGE_DRIVER"], message: "Use private S3 storage, or explicitly configure a durable local volume" });
    if (value.S3_ENDPOINT && !value.S3_ENDPOINT.startsWith("https://")) ctx.addIssue({ code: "custom", path: ["S3_ENDPOINT"], message: "HTTPS endpoint required" });
    if (value.MAIL_TRANSPORT !== "smtp") ctx.addIssue({ code: "custom", path: ["MAIL_TRANSPORT"], message: "SMTP is required in production" });
    if (value.MAIL_FROM.endsWith(".local")) ctx.addIssue({ code: "custom", path: ["MAIL_FROM"], message: "Use a real sender address" });
    for (const key of ["CLIENT_URL"]) {
      if (!value[key].startsWith("https://")) ctx.addIssue({ code: "custom", path: [key], message: "HTTPS required in production" });
    }
    if (/replace|example|your[_-]|test.only/i.test(value.JWT_SECRET)) {
      ctx.addIssue({ code: "custom", path: ["JWT_SECRET"], message: "Use a random production secret" });
    }
  }
});
const result = envSchema.safeParse(process.env);
if (!result.success) {
  throw new Error(`Invalid configuration: ${result.error.issues.map(i => i.path.join(".")).join(", ")}`);
}
export const env = result.data;
