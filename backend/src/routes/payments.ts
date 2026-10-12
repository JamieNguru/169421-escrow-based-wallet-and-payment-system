import { RequestHandler, Router } from "express";

import { HttpError } from "../errors";
import { authenticate, requireRole } from "../middleware/auth";
import { getB2CCallbackSecret } from "../config/daraja";
import { initiateEscrowPayment } from "../services/paymentService";
import { handleB2CResult, handleB2CTimeout, initiateWithdrawal } from "../services/withdrawalService";
import { initiateStkSchema, withdrawSchema } from "../validation/payments";

const router = Router();

router.post("/stk-push", authenticate, requireRole("client"), async (req, res, next) => {
  const parsed = initiateStkSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return next(new HttpError(400, message));
  }

  try {
    const { payment, customerMessage } = await initiateEscrowPayment(req.user!.sub, parsed.data);
    res.status(202).json({ payment, message: customerMessage });
  } catch (err) {
    next(err);
  }
});

router.post("/withdraw", authenticate, requireRole("worker"), async (req, res, next) => {
  const parsed = withdrawSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return next(new HttpError(400, message));
  }

  try {
    const withdrawal = await initiateWithdrawal(req.user!.sub, parsed.data);
    res.status(202).json({ withdrawal });
  } catch (err) {
    next(err);
  }
});

// Daraja calls these without a token. The secret in the path stands in for a signature,
// and a wrong one looks like a missing route.
const b2cCallback = (handle: (payload: unknown) => Promise<void>): RequestHandler => {
  return async (req, res, next) => {
    try {
      if (req.params.secret !== getB2CCallbackSecret()) return next(new HttpError(404, "Not found"));
      await handle(req.body);
      res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    } catch (err) {
      next(err);
    }
  };
};

router.post("/b2c/result/:secret", b2cCallback(handleB2CResult));
router.post("/b2c/timeout/:secret", b2cCallback(handleB2CTimeout));

export default router;
