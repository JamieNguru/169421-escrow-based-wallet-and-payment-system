import { z } from "zod";

import { normalizePhone } from "./register";

// The login field takes an email or a Kenyan mobile number. `email` is still
// accepted as the field name so existing clients keep working.
const credentials = z.object({
  identifier: z
    .string({ error: "email or phone is required" })
    .trim()
    .min(1, "email or phone is required"),
  password: z.string().min(1, "password is required"),
});

export const loginSchema = z
  .preprocess(
    (raw) =>
      raw && typeof raw === "object" && !("identifier" in raw) && "email" in raw
        ? { ...raw, identifier: (raw as { email: unknown }).email }
        : raw,
    credentials,
  )
  .transform(({ identifier, password }, ctx): { email?: string; phone?: string; password: string } => {
    if (identifier.includes("@")) {
      const email = z.string().email().safeParse(identifier.toLowerCase());
      if (!email.success) {
        ctx.addIssue({ code: "custom", message: "email is not valid" });
        return z.NEVER;
      }
      return { email: email.data, password };
    }
    const phone = normalizePhone(identifier);
    if (!phone) {
      ctx.addIssue({ code: "custom", message: "enter a valid email or Kenyan mobile number" });
      return z.NEVER;
    }
    return { phone, password };
  });

export type LoginInput = z.infer<typeof loginSchema>;
