import { z } from "zod";

import { photosSchema } from "./photos";

export const fundEscrowSchema = z.object({
  jobId: z.string().trim().min(1, "jobId is required"),
  workerId: z.string().trim().min(1, "workerId is required"),
  amount: z
    .number({ error: "amount must be a number" })
    .positive("amount must be greater than 0")
    .finite("amount must be a finite number"),
});

export type FundEscrowInput = z.infer<typeof fundEscrowSchema>;

const reasonSchema = z
  .string({ error: "reason must be a string" })
  .trim()
  .min(1, "reason is required")
  .max(1000, "reason must be at most 1000 characters");

export const requestRefundSchema = z.object({ reason: reasonSchema });

export type RequestRefundInput = z.infer<typeof requestRefundSchema>;

export const raiseDisputeSchema = z.object({ reason: reasonSchema, photos: photosSchema.optional() });

export type RaiseDisputeInput = z.infer<typeof raiseDisputeSchema>;

export const resolveDisputeSchema = z
  .object({
    decision: z.enum(["release", "refund", "split"], { error: "decision must be release, refund or split" }),
    // Only for a split: how much goes back to the client; the worker gets the rest.
    clientAmount: z
      .number({ error: "clientAmount must be a number" })
      .positive("clientAmount must be greater than 0")
      .finite("clientAmount must be a finite number")
      .optional(),
    resolution: z
      .string({ error: "resolution must be a string" })
      .trim()
      .min(1, "resolution is required")
      .max(1000, "resolution must be at most 1000 characters"),
  })
  .superRefine((input, ctx) => {
    if (input.decision === "split" && input.clientAmount === undefined) {
      ctx.addIssue({ code: "custom", path: ["clientAmount"], message: "clientAmount is required for a split" });
    }
  });

export type ResolveDisputeInput = z.infer<typeof resolveDisputeSchema>;
