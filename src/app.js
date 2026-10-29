import express from "express";
import { readFileSync } from "node:fs";
const apiDefinition = JSON.parse(readFileSync(new URL("../docs/openapi.json", import.meta.url), "utf8"));
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { makeLimiter } from "./services/rateLimits.js";
import adminRoutes from "./routes/adminRoutes.js";
import { notificationRoutes, dashboardRoutes, reportRoutes } from "./routes/communityRoutes.js";
import { randomUUID } from "node:crypto";
import { env } from "./config/env.js";
import authRoutes from "./routes/authRoutes.js";
import jobRoutes from "./routes/jobRoutes.js";
import applicationRoutes from "./routes/applicationRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import fileRoutes from "./routes/fileRoutes.js";
import { databaseReady } from "./config/database.js";
import AppError from "./utils/AppError.js";

export function createApp({ apiLimit = 300, authLimit = 10 } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY_HOPS);
  app.set("query parser", "simple");
  app.use((req, res, next) => {
    req.id = randomUUID();
    const started = performance.now();
    res.on("finish", () => {
      if (env.LOG_REQUESTS || env.NODE_ENV === "production") console.log(JSON.stringify({ event: "http_request", requestId: req.id,
        method: req.method, route: req.route ? `${req.baseUrl}${req.route.path}` : "unmatched", status: res.statusCode, durationMs: Math.round(performance.now() - started) }));
    });
    res.setHeader("X-Request-Id", req.id);
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      callback(origin && origin !== new URL(env.CLIENT_URL).origin
        ? new AppError("Origin is not allowed", 403) : null, true);
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Protection"],
    exposedHeaders: ["X-Request-Id"],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  }));
  app.use("/api", makeLimiter("api", apiLimit));
  app.use(["/api/auth/register", "/api/auth/login", "/api/auth/forgot-password", "/api/auth/reset-password",
    "/api/auth/resend-verification", "/api/auth/verify-email", "/api/auth/verify-signup", "/api/auth/change-password"], makeLimiter("auth", authLimit));
  app.use("/api/auth/refresh", makeLimiter("refresh", 60));
  app.use(cookieParser());
  app.use(express.json({ limit: "64kb", strict: true }));
  app.get("/api/openapi.json", (req, res) => res.json(apiDefinition));
  app.get("/", (req, res) => res.json({ success: true, message: "Job Board API is running" }));
  app.get("/health/live", (req, res) => res.json({ success: true }));
  app.get("/health/ready", (req, res) => res.status(databaseReady() ? 200 : 503).json({ success: databaseReady() }));
  app.use("/api/admin", adminRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/reports", reportRoutes);
  app.use("/api/files", fileRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api/jobs", jobRoutes);
  app.use("/api/applications", applicationRoutes);
  app.use("/api/users", userRoutes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
export default createApp();
