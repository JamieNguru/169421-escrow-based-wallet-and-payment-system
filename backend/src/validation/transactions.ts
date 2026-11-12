import { z } from "zod";

export const transactionsQuerySchema = z.object({
  limit: z.coerce
    .number({ error: "limit must be a number" })
    .int("limit must be a whole number")
    .min(1, "limit must be at least 1")
    .max(100, "limit must be at most 100")
    .default(20),
  cursor: z.iso.datetime({ error: "cursor must be an ISO date-time" }).pipe(z.coerce.date()).optional(),
  userId: z.string().trim().min(1, "userId must not be empty").optional(),
});

export type TransactionsQuery = z.infer<typeof transactionsQuerySchema>;
