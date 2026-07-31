import express from "express";
import {
  createJob,
  getAllJobs,
  getJobById,
  updateJob,
  deleteJob,
} from "../controllers/jobController.js";
import { protect, authorize } from "../middleware/auth.js";
import validate from "../middleware/validate.js";
import { createJobSchema, updateJobSchema } from "../schemas/jobSchema.js";
import { paginationSchema } from "../schemas/paginationSchema.js";
const router = express.Router();

// Public-ish routes — koi bhi logged-in user dekh sakta hai
// (agar tum chaho ke bina login ke bhi dikhe, to protect hata dena)

router.get("/", protect, validate(paginationSchema, "query"), getAllJobs)
router.get("/:id", protect, getJobById);

// Sirf employer create/update/delete kar sakta hai

router.post("/", protect, authorize("employer"), validate(createJobSchema), createJob);
router.patch("/:id", protect, authorize("employer"), validate(updateJobSchema), updateJob)
router.delete("/:id", protect, authorize("employer"), deleteJob);

export default router;