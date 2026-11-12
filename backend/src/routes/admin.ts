import { Router } from "express";

import { HttpError } from "../errors";
import { authenticate, requireRole } from "../middleware/auth";
import { getComplianceFlags } from "../services/complianceService";
import { getDispute, listDisputes, listPayments, listRefundRequests } from "../services/adminListService";
import { getKycForAdmin, listDisputedWorkerKyc } from "../services/kycService";
import { getPlatformOverview } from "../services/overviewService";
import { getUser, listUsers, setUserStatus } from "../services/userService";
import {
  listDisputesQuerySchema,
  listPaymentsQuerySchema,
  listRefundRequestsQuerySchema,
  listUsersQuerySchema,
  roleSchema,
  setUserStatusSchema,
} from "../validation/admin";

const router = Router();

router.use(authenticate, requireRole("admin"));

router.get("/overview", async (_req, res, next) => {
  try {
    res.json(await getPlatformOverview());
  } catch (err) {
    next(err);
  }
});

// Patterns worth a look (splitting, refunds after delivery, large earnings with no tax PIN).
router.get("/compliance", async (_req, res, next) => {
  try {
    res.json(await getComplianceFlags());
  } catch (err) {
    next(err);
  }
});

router.get("/disputes", async (req, res, next) => {
  const parsed = listDisputesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return next(new HttpError(400, message));
  }

  try {
    const { status, limit, cursor } = parsed.data;
    res.json(await listDisputes({ status, limit, before: cursor }));
  } catch (err) {
    next(err);
  }
});

router.get("/disputes/:jobId", async (req, res, next) => {
  try {
    res.json({ dispute: await getDispute(String(req.params.jobId)) });
  } catch (err) {
    next(err);
  }
});

router.get("/refund-requests", async (req, res, next) => {
  const parsed = listRefundRequestsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return next(new HttpError(400, message));
  }

  try {
    const { status, limit, cursor } = parsed.data;
    res.json(await listRefundRequests({ status, limit, before: cursor }));
  } catch (err) {
    next(err);
  }
});

router.get("/kyc", async (_req, res, next) => {
  try {
    res.json({ workers: await listDisputedWorkerKyc() });
  } catch (err) {
    next(err);
  }
});

router.get("/kyc/:workerId", async (req, res, next) => {
  try {
    res.json({ kyc: await getKycForAdmin(req.user!.sub, String(req.params.workerId)) });
  } catch (err) {
    next(err);
  }
});

router.get("/payments", async (req, res, next) => {
  const parsed = listPaymentsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return next(new HttpError(400, message));
  }

  try {
    const { status, limit, cursor } = parsed.data;
    res.json(await listPayments({ status, limit, before: cursor }));
  } catch (err) {
    next(err);
  }
});

router.get("/users", async (req, res, next) => {
  const parsed = listUsersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return next(new HttpError(400, message));
  }

  try {
    res.json(await listUsers(parsed.data));
  } catch (err) {
    next(err);
  }
});

router.get("/users/:role/:id", async (req, res, next) => {
  const role = roleSchema.safeParse(req.params.role);
  if (!role.success) {
    return next(new HttpError(400, role.error.issues[0].message));
  }

  try {
    res.json({ user: await getUser(role.data, String(req.params.id)) });
  } catch (err) {
    next(err);
  }
});

router.patch("/users/:role/:id/status", async (req, res, next) => {
  const role = roleSchema.safeParse(req.params.role);
  if (!role.success) {
    return next(new HttpError(400, role.error.issues[0].message));
  }
  const parsed = setUserStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return next(new HttpError(400, message));
  }

  try {
    const user = await setUserStatus(req.user!.sub, role.data, String(req.params.id), parsed.data);
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

export default router;
