import { z } from "zod";

export const statementQuerySchema = z.object({
  year: z.coerce
    .number({ error: "year must be a number" })
    .int("year must be a whole number")
    .min(2020, "year must be 2020 or later")
    .max(2100, "year must be 2100 or earlier")
    .optional(),
});
