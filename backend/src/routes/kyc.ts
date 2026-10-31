import { Router } from "express";

import { HttpError } from "../errors";
import { authenticate, requireRole } from "../middleware/auth";
import { addTaxPin, getMyKyc, submitKyc } from "../services/kycService";
import { addTaxPinSchema, submitKycSchema } from "../validation/kyc";

const router = Router();

router.use(authenticate, requireRole("worker"));

router.post("/", async (req, res, next) => {
  const parsed = submitKycSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return next(new HttpError(400, message));
  }

  try {
    res.status(201).json({ kyc: await submitKyc(req.user!.sub, parsed.data) });
  } catch (err) {
    next(err);
  }
});

router.post("/tax-pin", async (req, res, next) => {
  const parsed = addTaxPinSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return next(new HttpError(400, message));
  }

  try {
    res.json({ kyc: await addTaxPin(req.user!.sub, parsed.data.taxPin) });
  } catch (err) {
    next(err);
  }
});

router.get("/me", async (req, res, next) => {
  try {
    res.json({ kyc: await getMyKyc(req.user!.sub) });
  } catch (err) {
    next(err);
  }
});

export default router;
