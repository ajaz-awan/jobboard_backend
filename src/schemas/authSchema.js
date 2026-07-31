// src/schemas/authSchema.js
import { z } from "zod";

// Register ke liye schema — jo bhi fields register route expect karta hai
export const registerSchema = z.object({
  name: z.string().min(2, "Naam kam se kam 2 characters ka hona chahiye").max(100),
  email: z.string().email("Email format sahi nahi hai"),
  password: z.string().min(6, "Password kam se kam 6 characters ka hona chahiye"),
  role: z
    .enum(["candidate", "employer", "admin"], {
      errorMap: () => ({ message: "Role sirf candidate, employer, ya admin ho sakta hai" }),
    })
    .optional()
    .default("candidate"), // agar role na diya jaye to purane jaisa hi candidate default hoga
  // Employer ke liye optional field
  company_name: z.string().optional(),
});

// Login ke liye schema — sirf email + password chahiye
export const loginSchema = z.object({
  email: z.string().email("Email format sahi nahi hai"),
  password: z.string().min(1, "Password required hai"),
});