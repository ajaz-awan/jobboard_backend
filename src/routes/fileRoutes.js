import { Router } from "express";
import { z } from "zod";
import validate from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendStoredFile } from "../utils/fileStorage.js";
const router = Router();
const pathSchema = z.strictObject({ userId: z.uuid(), filename: z.string().regex(/^[0-9a-f-]{36}\.(png|jpg|webp)$/i) });
router.get("/logos/:userId/:filename", validate(pathSchema, "params"), asyncHandler(async (req, res, next) => {
  // Logos are public; resume files are never exposed through this router.
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  await sendStoredFile(res, next, "logos", `${req.params.userId}/${req.params.filename}`);
}));
export default router;
