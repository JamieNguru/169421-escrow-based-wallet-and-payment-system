import { z } from "zod";

import { browseJobsQuerySchema } from "./jobs";

export const applyToJobSchema = z.object({
  message: z
    .string({ error: "message must be a string" })
    .trim()
    .max(1000, "message must be at most 1000 characters")
    .optional(),
});

export type ApplyToJobInput = z.infer<typeof applyToJobSchema>;

export const listApplicationsQuerySchema = browseJobsQuerySchema.pick({ limit: true, cursor: true });

export type ListApplicationsQuery = z.infer<typeof listApplicationsQuerySchema>;
