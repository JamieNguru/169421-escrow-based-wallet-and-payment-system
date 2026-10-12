import { z } from "zod";

export const applyToJobSchema = z.object({
  message: z
    .string({ error: "message must be a string" })
    .trim()
    .max(1000, "message must be at most 1000 characters")
    .optional(),
});

export type ApplyToJobInput = z.infer<typeof applyToJobSchema>;
