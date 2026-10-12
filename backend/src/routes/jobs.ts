import { Router } from "express";

import { HttpError } from "../errors";
import { authenticate, requireRole } from "../middleware/auth";
import { postJob } from "../services/jobService";
import { postJobSchema } from "../validation/jobs";

const router = Router();

router.post("/", authenticate, requireRole("client"), async (req, res, next) => {
  const parsed = postJobSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return next(new HttpError(400, message));
  }

  try {
    const job = await postJob(req.user!.sub, parsed.data);
    res.status(201).json({ job });
  } catch (err) {
    next(err);
  }
});

export default router;
