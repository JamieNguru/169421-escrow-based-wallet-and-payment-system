import { z } from "zod";

export const SUPPORTED_CURRENCIES = ["KES", "UGX", "TZS", "USD"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

const currency = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .trim()
    .toUpperCase()
    .pipe(z.enum(SUPPORTED_CURRENCIES, { error: `${name} must be one of ${SUPPORTED_CURRENCIES.join(", ")}` }));

export const convertQuerySchema = z.object({
  from: currency("from"),
  to: currency("to"),
  amount: z.coerce
    .number({ error: "amount must be a number" })
    .positive("amount must be greater than 0")
    .finite("amount must be a finite number"),
});

export type ConvertQuery = z.infer<typeof convertQuerySchema>;
