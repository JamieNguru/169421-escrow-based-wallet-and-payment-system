import { z } from "zod";

export const fundEscrowSchema = z.object({
  jobId: z.string().trim().min(1, "jobId is required"),
  workerId: z.string().trim().min(1, "workerId is required"),
  amount: z
    .number({ error: "amount must be a number" })
    .positive("amount must be greater than 0")
    .finite("amount must be a finite number"),
});

export type FundEscrowInput = z.infer<typeof fundEscrowSchema>;
