import { z } from "zod";

export const roleSchema = z.enum(["client", "worker", "admin"], {
  error: "role must be client, worker or admin",
});

const statusSchema = z.enum(["active", "suspended"], {
  error: "status must be active or suspended",
});

export const listUsersQuerySchema = z.object({
  role: roleSchema.optional(),
  status: statusSchema.optional(),
  limit: z.coerce
    .number({ error: "limit must be a number" })
    .int("limit must be a whole number")
    .min(1, "limit must be at least 1")
    .max(100, "limit must be at most 100")
    .default(25),
  startAfter: z.string().trim().min(1, "startAfter must not be empty").optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const setUserStatusSchema = z.object({
  status: statusSchema,
  reason: z
    .string({ error: "reason must be a string" })
    .trim()
    .min(1, "reason must not be empty")
    .max(1000, "reason must be at most 1000 characters")
    .optional(),
});

export type SetUserStatusInput = z.infer<typeof setUserStatusSchema>;

const cursorSchema = z.iso.datetime({ error: "cursor must be an ISO date-time" }).pipe(z.coerce.date());
const limitSchema = z.coerce
  .number({ error: "limit must be a number" })
  .int("limit must be a whole number")
  .min(1, "limit must be at least 1")
  .max(100, "limit must be at most 100")
  .default(25);

export const listDisputesQuerySchema = z.object({
  status: z.enum(["open", "resolved"], { error: "status must be open or resolved" }).optional(),
  limit: limitSchema,
  cursor: cursorSchema.optional(),
});

export const listRefundRequestsQuerySchema = z.object({
  status: z.enum(["pending", "approved"], { error: "status must be pending or approved" }).optional(),
  limit: limitSchema,
  cursor: cursorSchema.optional(),
});

export const listPaymentsQuerySchema = z.object({
  status: z.enum(["pending", "completed", "failed"], { error: "status must be pending, completed or failed" }).optional(),
  limit: limitSchema,
  cursor: cursorSchema.optional(),
});
