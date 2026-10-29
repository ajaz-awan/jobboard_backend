import { z } from "zod";
import { paginationFields } from "./paginationSchema.js";
const jobType = z.enum(["full-time", "part-time", "contract", "internship"]);
const salary = z.number().int().min(0).max(1_000_000_000);
const fields = {
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().min(10).max(20000),
  location: z.string().trim().min(1).max(150).optional(),
  job_type: jobType.optional(), salary_min: salary.optional(), salary_max: salary.optional(),
  status: z.enum(["open", "closed"]).optional(),
  expires_at: z.iso.datetime().refine(v => new Date(v).getTime() > Date.now(), "Deadline must be in the future").nullable().optional(),
  work_mode: z.enum(["onsite", "hybrid", "remote"]).optional(),
  experience_level: z.enum(["entry", "mid", "senior", "any"]).optional(),
  skills: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
};
export const validSalary = v => v.salary_min == null || v.salary_max == null || v.salary_max >= v.salary_min;
const salaryRule = { path: ["salary_max"], message: "Maximum salary must be at least minimum salary" };
export const createJobSchema = z.strictObject(fields).refine(validSalary, salaryRule);
export const updateJobSchema = z.strictObject({ ...fields,
  location: z.string().trim().min(1).max(150).nullable().optional(),
  salary_min: salary.nullable().optional(), salary_max: salary.nullable().optional(),
}).partial()
  .refine(v => Object.keys(v).length > 0, "Provide at least one field").refine(validSalary, salaryRule);
export const jobQuerySchema = z.strictObject({
  ...paginationFields,
  q: z.string().trim().min(1).max(100).optional(),
  work_mode: z.enum(["onsite", "hybrid", "remote"]).optional(),
  experience_level: z.enum(["entry", "mid", "senior", "any"]).optional(),
  title: z.string().trim().min(1).max(150).optional(),
  location: z.string().trim().min(1).max(150).optional(),
  job_type: jobType.optional(), status: z.enum(["open", "closed"]).optional(),
  salary_min: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  sort: z.enum(["newest", "oldest", "salary"]).default("newest"),
});
