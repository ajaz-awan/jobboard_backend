// src/schemas/jobSchema.js
import { z } from "zod";

// Job create karte waqt — sab required fields (jo DB mein NOT NULL hain unke hisab se)
export const createJobSchema = z.object({
  title: z.string().min(3, "Title kam se kam 3 characters ka hona chahiye").max(150),
  description: z.string().min(10, "Description kam se kam 10 characters ki honi chahiye"),
  location: z.string().optional(), // DB mein nullable hai, isliye optional rakha
  job_type: z
    .enum(["full-time", "part-time", "contract", "internship"], {
      errorMap: () => ({ message: "job_type sirf full-time, part-time, contract, ya internship ho sakta hai" }),
    })
    .optional(), // DB mein default 'full-time' hai, isliye optional
  salary_min: z.number().int().positive().optional(),
  salary_max: z.number().int().positive().optional(),
}).refine(
  // Cross-field check — salary_max hamesha salary_min se bada ya barabar hona chahiye
  (data) => !data.salary_min || !data.salary_max || data.salary_max >= data.salary_min,
  {
    message: "salary_max, salary_min se kam nahi ho sakta",
    path: ["salary_max"], // error isi field ke naam se dikhega
  }
);

// Job update karte waqt — sab fields optional (jo bhi bhejo wahi update hoga)
// Note: ye createJobSchema se alag likha hai (naya object), kyunki .refine() ke baad .partial() lagana Zod mein allowed nahi hota
export const updateJobSchema = z.object({
  title: z.string().min(3).max(150).optional(),
  description: z.string().min(10).optional(),
  location: z.string().optional(),
  job_type: z.enum(["full-time", "part-time", "contract", "internship"]).optional(),
  salary_min: z.number().int().positive().optional(),
  salary_max: z.number().int().positive().optional(),
  status: z
    .enum(["open", "closed"], {
      errorMap: () => ({ message: "status sirf open ya closed ho sakta hai" }),
    })
    .optional(),
});