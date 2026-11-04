import { z } from "zod";

import { normalizePhone } from "./register";

// What a client or worker may change about themselves. The email is the login
// identity, so it is not editable here.
export const profileSchema = z
  .object({
    name: z.string().trim().min(1, "name is required").max(80, "name is too long").optional(),
    phone: z
      .string()
      .transform((value, ctx) => {
        const phone = normalizePhone(value);
        if (!phone) ctx.addIssue({ code: "custom", message: "phone must be a Kenyan mobile number" });
        return phone ?? z.NEVER;
      })
      .optional(),
  })
  .refine((value) => value.name !== undefined || value.phone !== undefined, {
    message: "nothing to update",
  });

export type ProfileInput = z.infer<typeof profileSchema>;
