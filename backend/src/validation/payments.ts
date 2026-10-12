import { z } from "zod";

import { normalizePhone } from "./register";

export const initiateStkSchema = z.object({
  jobId: z.string().trim().min(1, "jobId is required"),
  workerId: z.string().trim().min(1, "workerId is required"),
  // M-Pesa only accepts whole shillings.
  amount: z
    .number({ error: "amount must be a number" })
    .int("amount must be a whole number of KES")
    .positive("amount must be greater than 0"),
  phone: z
    .string()
    .trim()
    .refine((value) => normalizePhone(value) !== null, "phone must be a valid Kenyan mobile number")
    .optional(),
});

export type InitiateStkInput = z.infer<typeof initiateStkSchema>;
