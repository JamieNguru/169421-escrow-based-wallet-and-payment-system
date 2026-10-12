import { z } from "zod";

export const trustScoreQuerySchema = z.object({
  role: z.enum(["client", "worker"], { error: "role must be client or worker" }),
});
