import { Router } from "express";

import { HttpError } from "../errors";
import { authenticate, requireRole } from "../middleware/auth";
import { getTrustScore, type ScoredRole } from "../services/trustScoreService";
import { trustScoreQuerySchema } from "../validation/trustScore";

const router = Router();

router.get("/me", authenticate, requireRole("client", "worker"), async (req, res, next) => {
  try {
    const { sub, role } = req.user!;
    res.json(await getTrustScore(sub, role as ScoredRole));
  } catch (err) {
    next(err);
  }
});

// Admins look up any client or worker; the role picks the collection and model.
router.get("/:userId", authenticate, requireRole("admin"), async (req, res, next) => {
  const parsed = trustScoreQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return next(new HttpError(400, message));
  }

  try {
    res.json(await getTrustScore(String(req.params.userId), parsed.data.role));
  } catch (err) {
    next(err);
  }
});

export default router;
