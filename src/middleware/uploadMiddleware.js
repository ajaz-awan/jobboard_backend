import multer from "multer";
import AppError from "../utils/AppError.js";
// PDF-only resumes reduce the active document formats accepted by the API.
const types = { resume: ["application/pdf"], logo: ["image/jpeg", "image/png", "image/webp"] };
export default multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 3, parts: 4, fieldSize: 8192 },
  fileFilter(req, file, cb) {
    cb(types[file.fieldname]?.includes(file.mimetype) ? null : new AppError("Unsupported file type", 400), true);
  },
});
