import multer from "multer";
import AppError from "../utils/AppError.js";
export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);
  let status = err.isOperational ? err.statusCode : 500;
  let message = status < 500 ? err.message : "Internal server error";
  if (["JsonWebTokenError", "TokenExpiredError", "NotBeforeError"].includes(err.name)) {
    status = 401; message = "Invalid or expired token";
  } else if (err instanceof multer.MulterError) {
    status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    message = status === 413 ? "File exceeds 5 MB limit" : "Invalid multipart upload";
  } else if (err.type === "entity.too.large") {
    status = 413; message = "Request body is too large";
  } else if (err.type === "entity.parse.failed") {
    status = 400; message = "Invalid JSON body";
  }
  if (err.code === 11000) {
    status = 409; message = "Record already exists";
  } else if (err.name === "VersionError") {
    status = 409; message = "Record changed; reload and retry";
  } else if (["ValidationError", "CastError", "StrictModeError"].includes(err.name)) {
    status = 400; message = "Invalid data";
  } else if (["MongoServerSelectionError", "MongooseServerSelectionError", "MongoNetworkError", "MongoNetworkTimeoutError"].includes(err.name)) {
    status = 503; message = "Database is unavailable";
  }
  if (status >= 500) console.error(JSON.stringify({ requestId: req.id, error: err.name || "Error", code: err.code }));
  res.status(status).json({ success: false, message, requestId: req.id,
    ...(status === 400 && err.errors ? { errors: err.errors } : {}) });
};
export const notFound = (req, res, next) => next(new AppError("Route not found", 404));
