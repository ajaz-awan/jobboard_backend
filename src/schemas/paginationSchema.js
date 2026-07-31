// src/schemas/paginationSchema.js
import { z } from "zod";

// Query params hamesha STRING aate hain (URL se), isliye "coerce" use kiya —
// ye Zod ko batata hai: pehle string ko number mein convert karo, phir validate karo
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50, "Limit 50 se zyada nahi ho sakta").default(10),
});