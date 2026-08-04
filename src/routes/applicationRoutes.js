// src/routes/applicationRoutes.js
import express from "express";
import { protect, authorize } from "../middleware/auth.js";
import upload from "../middleware/uploadMiddleware.js";
import validate from "../middleware/validate.js";                   // naya import
import { applySchema } from "../schemas/applicationSchema.js";  
// src/routes/applicationRoutes.js mein add karo (existing routes ke sath)

import { updateApplicationStatus } from "../controllers/applicationController.js";
import { updateApplicationStatusSchema } from "../schemas/applicationSchema.js";


import {
  applyToJob,
  getMyApplications,
  getApplicationsForJob,
} from "../controllers/applicationController.js";

const router = express.Router();

// Order zaroori hai: upload (Multer) → validate (Zod) → applyToJob (controller)
// Multer pehle chalna zaroori hai kyunki multipart/form-data ko parse karke
// req.body mein job_id/cover_letter fields wahi daalta hai. Agar validate
// isse pehle chale, to req.body abhi khali/unparsed hoga aur validation galat fail ho jayegi.
router.post(
  "/",
  protect,
  authorize("candidate"),
  upload.single("resume"),
  validate(applySchema),
  applyToJob
);
router.patch(
  "/:id/status",
  protect,
  authorize("employer"), // sirf employer status change kar sakta hai, candidate nahi
  validate(updateApplicationStatusSchema, "body"),
  updateApplicationStatus
);    

router.get("/my", protect, authorize("candidate"), getMyApplications);
router.get("/job/:jobId", protect, authorize("employer"), getApplicationsForJob);

export default router;