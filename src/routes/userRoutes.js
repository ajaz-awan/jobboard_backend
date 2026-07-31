import express from "express";
import { protect, authorize } from "../middleware/auth.js";
import upload from "../middleware/uploadMiddleware.js";
import { uploadLogo } from "../controllers/userController.js";

const router = express.Router();

// Sirf employer apna logo update kar sakta hai
router.patch("/me/logo", protect, authorize("employer"), upload.single("logo"), uploadLogo);

export default router;
