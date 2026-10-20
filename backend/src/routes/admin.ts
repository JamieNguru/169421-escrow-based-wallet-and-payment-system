import { Router } from "express";

import { HttpError } from "../errors";
import { authenticate, requireRole } from "../middleware/auth";
import { getPlatformOverview } from "../services/overviewService";
import { getUser, listUsers, setUserStatus } from "../services/userService";
import { listUsersQuerySchema, roleSchema, setUserStatusSchema } from "../validation/admin";

const router = Router();

router.use(authenticate, requireRole("admin"));

router.get("/overview", async (_req, res, next) => {
  try {
    res.json(await getPlatformOverview());
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
