import { z } from "zod";
import { paginationFields } from "./paginationSchema.js";
export const applySchema = z.strictObject({ job_id: z.uuid(), cover_letter: z.string().trim().max(2000).optional() });
export const updateApplicationStatusSchema = z.strictObject({ status: z.enum(["pending", "accepted", "rejected"]) });
export const applicationQuerySchema = z.strictObject({ ...paginationFields, status: z.enum(["pending", "accepted", "rejected", "withdrawn"]).optional() });
