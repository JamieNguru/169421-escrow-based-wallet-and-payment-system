import { z } from "zod";

import { browseJobsQuerySchema } from "./jobs";

const messageSchema = z
  .string({ error: "message must be a string" })
  .trim()
  .max(1000, "message must be at most 1000 characters");

const priceSchema = z
  .number({ error: "price must be a number" })
  .positive("price must be greater than 0")
  .finite("price must be a finite number");

export const applyToJobSchema = z.object({
  price: priceSchema,
  message: messageSchema.optional(),
});

export type ApplyToJobInput = z.infer<typeof applyToJobSchema>;

export const updateQuoteSchema = z
  .object({ price: priceSchema.optional(), message: messageSchema.optional() })
  .refine((input) => input.price !== undefined || input.message !== undefined, "price or message is required");

export type UpdateQuoteInput = z.infer<typeof updateQuoteSchema>;

export const selectWorkerSchema = z.object({
  workerId: z
    .string({ error: "workerId must be a string" })
    .trim()
    .min(1, "workerId is required"),
});

export type SelectWorkerInput = z.infer<typeof selectWorkerSchema>;

export const listApplicationsQuerySchema = browseJobsQuerySchema.pick({ limit: true, cursor: true });

export type ListApplicationsQuery = z.infer<typeof listApplicationsQuerySchema>;
