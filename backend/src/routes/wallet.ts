import { Router } from "express";

import { EAT_OFFSET_MS } from "../config/compliance";
import { HttpError } from "../errors";
import { authenticate, requireRole } from "../middleware/auth";
import { getStatement } from "../services/complianceService";
import { convert } from "../services/exchangeRateService";
import { getWallet } from "../services/walletService";
import { convertQuerySchema } from "../validation/currency";
import { statementQuerySchema } from "../validation/statement";

const router = Router();

router.get("/", authenticate, requireRole("client", "worker"), async (req, res, next) => {
  try {
    res.json({ wallet: await getWallet(req.user!.sub) });
  } catch (err) {
    next(err);
  }
});

// A year's earnings (worker) or payments (client), month by month, from the ledger.
router.get("/statement", authenticate, requireRole("client", "worker"), async (req, res, next) => {
  const parsed = statementQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return next(new HttpError(400, message));
  }

  try {
    const { sub, role } = req.user!;
    const year = parsed.data.year ?? new Date(Date.now() + EAT_OFFSET_MS).getUTCFullYear();
    res.json({ statement: await getStatement(sub, role as "client" | "worker", year) });
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
