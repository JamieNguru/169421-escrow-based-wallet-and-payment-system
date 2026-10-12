import { Router } from "express";

import { HttpError } from "../errors";
import { authenticate, requireRole } from "../middleware/auth";
import { initiateEscrowPayment } from "../services/paymentService";
import { initiateStkSchema } from "../validation/payments";

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

export default router;
