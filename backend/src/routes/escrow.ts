import { Router } from "express";

import { HttpError } from "../errors";
import { authenticate, requireRole } from "../middleware/auth";
import { confirmCompletion, fundEscrow, getEscrow, markWorkComplete } from "../services/escrowService";
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

router.post("/:jobId/complete", authenticate, requireRole("worker"), async (req, res, next) => {
  try {
    const escrow = await markWorkComplete(req.user!.sub, String(req.params.jobId));
    res.json({ escrow });
  } catch (err) {
    next(err);
  }
});

router.post("/:jobId/confirm", authenticate, requireRole("client"), async (req, res, next) => {
  try {
    const escrow = await confirmCompletion(req.user!.sub, String(req.params.jobId));
    res.json({ escrow });
  } catch (err) {
    next(err);
  }
});

router.get("/:jobId", authenticate, async (req, res, next) => {
  try {
    const escrow = await getEscrow(String(req.params.jobId), req.user!);
    res.json({ escrow });
  } catch (err) {
    next(err);
  }
});

export default router;
