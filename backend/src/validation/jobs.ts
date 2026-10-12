import { z } from "zod";

import { SUPPORTED_CURRENCIES } from "./currency";

export const postJobSchema = z.object({
  title: z.string({ error: "title is required" }).trim().min(1, "title is required"),
  description: z.string({ error: "description is required" }).trim().min(1, "description is required"),
  budget: z
    .number({ error: "budget must be a number" })
    .positive("budget must be greater than 0")
    .finite("budget must be a finite number"),
  currency: z
    .string({ error: "currency is required" })
    .trim()
    .toUpperCase()
    .pipe(z.enum(SUPPORTED_CURRENCIES, { error: `currency must be one of ${SUPPORTED_CURRENCIES.join(", ")}` })),
});

export type PostJobInput = z.infer<typeof postJobSchema>;
