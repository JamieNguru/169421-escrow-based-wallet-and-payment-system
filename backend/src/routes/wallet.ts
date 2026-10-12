import { Router } from "express";

import { HttpError } from "../errors";
import { authenticate } from "../middleware/auth";
import { convert } from "../services/exchangeRateService";
import { convertQuerySchema } from "../validation/currency";

const router = Router();

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
