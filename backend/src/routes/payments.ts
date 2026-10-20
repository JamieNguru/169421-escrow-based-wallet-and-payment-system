import { RequestHandler, Router } from "express";

import { HttpError } from "../errors";
import { authenticate, requireRole } from "../middleware/auth";
import { getB2CCallbackSecret, getStkCallbackSecret } from "../config/daraja";
import {
  getPayment,
  handleStkCallback,
  initiateEscrowPayment,
  initiateTopUp,
  simulatePayment,
} from "../services/paymentService";
import { handleB2CResult, handleB2CTimeout, initiateWithdrawal } from "../services/withdrawalService";
import { initiateStkSchema, simulateSchema, topUpSchema, withdrawSchema } from "../validation/payments";

const router = Router();

router.post("/stk-push", authenticate, requireRole("client"), async (req, res, next) => {
  const parsed = initiateStkSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return next(new HttpError(400, message));
  }

  try {
    const { payment, customerMessage } = await initiateEscrowPayment(req.user!.sub, parsed.data);
    res.status(202).json({ payment, message: customerMessage, simulated: Boolean(payment.simulated) });
  } catch (err) {
    next(err);
  }
});

// Adds money to the wallet with an M-Pesa prompt, with no job involved.
router.post("/top-up", authenticate, requireRole("client"), async (req, res, next) => {
  const parsed = topUpSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return next(new HttpError(400, message));
  }

  try {
    const { payment, customerMessage } = await initiateTopUp(req.user!.sub, parsed.data);
    res.status(202).json({ payment, message: customerMessage, simulated: Boolean(payment.simulated) });
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

// A client's own payment, polled by the app while the M-Pesa prompt is open.
router.get("/:checkoutRequestId", authenticate, requireRole("client"), async (req, res, next) => {
  try {
    res.json({ payment: await getPayment(req.user!.sub, String(req.params.checkoutRequestId)) });
  } catch (err) {
    next(err);
  }
});

// Test mode only (DARAJA_SIMULATE=true, never in production): settle one of your own test payments.
router.post("/:checkoutRequestId/simulate", authenticate, requireRole("client"), async (req, res, next) => {
  const parsed = simulateSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return next(new HttpError(400, message));
  }

  try {
    res.json({ payment: await simulatePayment(req.user!.sub, String(req.params.checkoutRequestId), parsed.data.outcome) });
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

// Daraja calls this after the customer pays, cancels or times out on the STK prompt.
router.post("/stk/callback/:secret", async (req, res, next) => {
  try {
    if (req.params.secret !== getStkCallbackSecret()) return next(new HttpError(404, "Not found"));
    await handleStkCallback(req.body);
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err) {
    next(err);
  }
});

router.post("/b2c/result/:secret", b2cCallback(handleB2CResult));
router.post("/b2c/timeout/:secret", b2cCallback(handleB2CTimeout));

export default router;
