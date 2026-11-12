import { z } from "zod";

import { photoSchema } from "./photos";

export const ID_TYPES = ["national_id", "passport"] as const;

// A KRA PIN: A for an individual (P for a company), nine digits, then a letter.
export const taxPinSchema = z
  .string({ error: "taxPin must be a string" })
  .trim()
  .toUpperCase()
  .regex(/^[AP]\d{9}[A-Z]$/, "taxPin must look like A123456789Z (a letter, nine digits, a letter)");

export const addTaxPinSchema = z.object({ taxPin: taxPinSchema });

// Missing images and consent are not rejected here: the automatic checks report
// them as plain reasons so the worker sees everything wrong in one go.
export const submitKycSchema = z.object({
  fullName: z.string({ error: "fullName is required" }).trim().min(1, "fullName is required"),
  idType: z.enum(ID_TYPES, { error: "idType must be national_id or passport" }),
  idNumber: z
    .string({ error: "idNumber is required" })
    .trim()
    .toUpperCase()
    .min(1, "idNumber is required"),
  dateOfBirth: z
    .string({ error: "dateOfBirth is required" })
    .regex(/^\d{4}-\d{2}-\d{2}$/, "dateOfBirth must be YYYY-MM-DD"),
  // Optional: only needed before withdrawing large amounts. Can be added later.
  taxPin: taxPinSchema.optional(),
  consent: z.boolean({ error: "consent must be true or false" }),
  images: z
    .object({
      front: photoSchema.optional(),
      back: photoSchema.optional(),
      selfie: photoSchema.optional(),
    })
    .default({}),
});

export type SubmitKycInput = z.infer<typeof submitKycSchema>;
