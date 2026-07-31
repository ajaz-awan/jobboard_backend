// src/routes/authRoutes.js
// Ye file batati hai kaunsa URL hit hone pe kaunsa controller function chalega

import express from "express";
import { register, login } from "../controllers/authController.js";
import validate from "../middleware/validate.js";                      // naya import — validation middleware
import { registerSchema, loginSchema } from "../schemas/authSchema.js"; // naya import — Zod schemas

const router = express.Router();

router.post("/register", validate(registerSchema), register); // POST /api/auth/register
router.post("/login", validate(loginSchema), login); // POST /api/auth/login

export default router;