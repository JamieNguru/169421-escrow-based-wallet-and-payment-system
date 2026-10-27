import { z } from "zod";

import { normalizePhone } from "./register";

export const initiateStkSchema = z.object({
  jobId: z.string().trim().min(1, "jobId is required"),
  workerId: z.string().trim().min(1, "workerId is required"),
  // Optional: the server works out what is due from the job. A different amount is refused with 409.
  amount: z
    .number({ error: "amount must be a number" })
    .int("amount must be a whole number of KES")
    .positive("amount must be greater than 0")
    .optional(),
  phone: z
    .string()
    .trim()
    .refine((value) => normalizePhone(value) !== null, "phone must be a valid Kenyan mobile number")
    .optional(),
});

export type InitiateStkInput = z.infer<typeof initiateStkSchema>;

export const withdrawSchema = z.object({
  amount: z
    .number({ error: "amount must be a number" })
    .int("amount must be a whole number of KES")
    .positive("amount must be greater than 0"),
});

export type WithdrawInput = z.infer<typeof withdrawSchema>;

const wholeKes = z
  .number({ error: "amount must be a number" })
  .int("amount must be a whole number of KES")
  .positive("amount must be greater than 0")
  .max(250_000, "amount must be at most 250,000 (the M-Pesa limit)");

export const topUpSchema = z.object({
  amount: wholeKes,
  phone: z
    .string()
    .trim()
    .refine((value) => normalizePhone(value) !== null, "phone must be a valid Kenyan mobile number")
    .optional(),
});

export type TopUpInput = z.infer<typeof topUpSchema>;

export const simulateSchema = z.object({
  outcome: z.enum(["success", "failure"], { error: "outcome must be success or failure" }),
});

export type SimulateOutcome = z.infer<typeof simulateSchema>["outcome"];
