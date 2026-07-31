// src/controllers/authController.js
// Yahan register aur login ka logic hai — ab asyncHandler + AppError ke sath, try/catch nahi likhna pada

import bcrypt from "bcryptjs";
import { supabase } from "../config/supabaseClient.js";
import { generateToken } from "../utils/generateToken.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import AppError from "../utils/AppError.js";

// ============================================
// REGISTER (Signup)
// ============================================
export const register = asyncHandler(async (req, res) => {
  // name/email/password ka required check aur role ka enum+default check
  // ab registerSchema (Zod, route mein lagaya hua) kar chuka hai — yahan dobara zaroorat nahi
  const { name, email, password, role, company_name } = req.body;

  // ---- Check: email pehle se to nahi hai ----
  const { data: existingUser, error: findError } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (findError) throw new AppError(findError.message, 500);

  if (existingUser) {
    throw new AppError("Ye email pehle se registered hai", 409);
  }

  // ---- Password hash karo ----
  const hashedPassword = await bcrypt.hash(password, 10);

  // ---- User database mein insert karo ----
  const { data: newUser, error } = await supabase
    .from("users")
    .insert({
      name,
      email,
      password_hash: hashedPassword,
      role, // Zod schema se ab ye already validated + defaulted (candidate) aakar aata hai
      company_name: role === "employer" ? company_name : null,
    })
    .select("id, name, email, role, company_name, created_at")
    .single();

  if (error) throw new AppError(error.message, 500);

  // ---- JWT token generate karo ----
  const token = generateToken(newUser.id, newUser.role);

  res.status(201).json({
    success: true,
    message: "Account ban gaya ✅",
    user: newUser,
    token,
  });
});

// ============================================
// LOGIN
// ============================================
export const login = asyncHandler(async (req, res) => {
  // email/password ka required + format check ab loginSchema (Zod) kar chuka hai
  const { email, password } = req.body;

  // ---- User dhundo email se ----
  const { data: user, error } = await supabase
    .from("users")
    .select("id, name, email, password_hash, role, company_name")
    .eq("email", email)
    .maybeSingle();

  if (error) throw new AppError(error.message, 500);

  // Generic message — attacker ko pata nahi chalna chahiye email exist karta hai ya nahi
  if (!user) {
    throw new AppError("Email ya password galat hai", 401);
  }

  // ---- Password compare karo ----
  const isMatch = await bcrypt.compare(password, user.password_hash);

  if (!isMatch) {
    throw new AppError("Email ya password galat hai", 401);
  }

  // ---- Token generate karo ----
  const token = generateToken(user.id, user.role);

  const { password_hash, ...userWithoutPassword } = user;

  res.json({
    success: true,
    message: "Login ho gaya ✅",
    user: userWithoutPassword,
    token,
  });
});