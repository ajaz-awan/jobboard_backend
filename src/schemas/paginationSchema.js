import { z } from "zod";
export const paginationFields = {
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
};
export const paginationSchema = z.strictObject(paginationFields);
export const idSchema = z.strictObject({ id: z.uuid() });
export const jobIdSchema = z.strictObject({ jobId: z.uuid() });
export const pageRange = ({ page, limit }) => [(page - 1) * limit, page * limit - 1];
