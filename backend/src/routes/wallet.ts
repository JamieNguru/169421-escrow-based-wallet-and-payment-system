import { Router } from "express";

import { HttpError } from "../errors";
import { authenticate, requireRole } from "../middleware/auth";
import { convert } from "../services/exchangeRateService";
import { getWallet } from "../services/walletService";
import { convertQuerySchema } from "../validation/currency";

const router = Router();

router.get("/", authenticate, requireRole("client", "worker"), async (req, res, next) => {
  try {
    res.json({ wallet: await getWallet(req.user!.sub) });
  } catch (err) {
    next(err);
  }
});

// A quote only: nothing in the wallet or ledger changes.
router.get("/convert", authenticate, async (req, res, next) => {
  const parsed = convertQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return next(new HttpError(400, message));
  }

  try {
    const { from, to, amount } = parsed.data;
    res.json({ conversion: await convert(from, to, amount) });
  } catch (err) {
    next(err);
  }
});

export default router;
