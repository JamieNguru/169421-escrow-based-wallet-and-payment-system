import { Router } from "express";

import { HttpError } from "../errors";
import { authenticate, requireRole } from "../middleware/auth";
import { fundEscrow } from "../services/escrowService";
import { fundEscrowSchema } from "../validation/escrow";

const router = Router();

router.post("/fund", authenticate, requireRole("client"), async (req, res, next) => {
  const parsed = fundEscrowSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return next(new HttpError(400, message));
  }

  try {
    const escrow = await fundEscrow(req.user!.sub, parsed.data);
    res.status(201).json({ escrow });
  } catch (err) {
    next(err);
  }
});

export default router;
