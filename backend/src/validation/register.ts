import { z } from "zod";

// Accepts 07xx / 01xx / +2547xx / 2547xx / 2541xx and returns 254XXXXXXXXX,
// the format M-Pesa expects. Returns null if the number is not a Kenyan mobile.
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  const match = /^(?:\+?254|0)([17]\d{8})$/.exec(digits);
  return match ? `254${match[1]}` : null;
}

export const registerSchema = z.object({
  name: z.string().trim().min(1, "name is required"),
  email: z.string().trim().toLowerCase().email("email is not valid"),
  phone: z
    .string()
    .transform((value, ctx) => {
      const phone = normalizePhone(value);
      if (!phone) ctx.addIssue({ code: "custom", message: "phone must be a Kenyan mobile number" });
      return phone ?? z.NEVER;
    }),
  password: z.string().min(8, "password must be at least 8 characters"),
  role: z.enum(["client", "worker"], { error: "role must be client or worker" }),
});

export type RegisterInput = z.infer<typeof registerSchema>;
