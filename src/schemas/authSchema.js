import { z } from "zod";
const email = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(12).refine(v => Buffer.byteLength(v, "utf8") <= 72, "Password must be at most 72 UTF-8 bytes");
export const registerSchema = z.strictObject({
  name: z.string().trim().min(2).max(100), email, password: passwordSchema,
  role: z.enum(["candidate", "employer"]).default("candidate"),
  company_name: z.string().trim().min(2).max(150).optional(),
}).refine(v => v.role !== "employer" || Boolean(v.company_name), {
  path: ["company_name"], message: "Company name is required for employers",
});
export const loginSchema = z.strictObject({ email, password: z.string().min(1).max(1024) });
export const profileSchema = z.strictObject({
  name: z.string().trim().min(2).max(100).optional(),
  company_name: z.string().trim().min(2).max(150).optional(),
}).refine(v => Object.keys(v).length > 0, "Provide at least one field");

export const emailRequestSchema = z.strictObject({ email });
export const actionTokenSchema = z.strictObject({ token: z.string().regex(/^[0-9a-f]{64}$/i) });
export const resetPasswordSchema = z.strictObject({ token: z.string().regex(/^[0-9a-f]{64}$/i), password: passwordSchema });
export const changePasswordSchema = z.strictObject({ current_password: z.string().min(1).max(1024), new_password: passwordSchema });
export const emptyBodySchema = z.strictObject({}).default({});

export const signupOtpSchema = z.strictObject({ email, otp: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your email") });
