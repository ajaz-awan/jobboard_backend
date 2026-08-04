// src/schemas/applicationSchema.js
import { z } from "zod";

// Apply karte waqt — resume file Multer handle karta hai (Zod file validate nahi karta),
// isliye yahan sirf text fields validate ho rahe hain: job_id aur cover_letter
export const applySchema = z.object({
  job_id: z.string().uuid("job_id ek valid UUID hona chahiye"),
  cover_letter: z.string().max(2000, "Cover letter 2000 characters se zyada nahi ho sakta").optional(),
});

// src/schemas/applicationSchema.js mein yeh add karo (existing schemas ke sath)



export const updateApplicationStatusSchema = z.object({
  status: z.enum(["pending", "accepted", "rejected"], {
    // agar galat value bheji (jaise "approved"), yeh error dega
    errorMap: () => ({ message: "Status sirf 'pending', 'accepted', ya 'rejected' ho sakta hai" }),
  }),
});