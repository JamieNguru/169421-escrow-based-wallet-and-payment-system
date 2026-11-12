import { Router } from "express";

import { HttpError } from "../errors";
import { authenticate } from "../middleware/auth";
import { listTransactions } from "../services/transactionService";
import { transactionsQuerySchema } from "../validation/transactions";

const router = Router();

// Everyone sees their own history; admins can pass userId to see anyone's.
router.get("/", authenticate, async (req, res, next) => {
  const parsed = transactionsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return next(new HttpError(400, message));
  }

  const { sub, role } = req.user!;
  const { userId, limit, cursor } = parsed.data;
  if (userId && role !== "admin") {
    return next(new HttpError(403, "you do not have permission to access this resource"));
  }

  try {
    res.json(await listTransactions(userId ?? sub, { limit, before: cursor }));
  } catch (err) {
    next(err);
  }
});

export default router;
