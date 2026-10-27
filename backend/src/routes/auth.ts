import { Router } from "express";

import { signToken } from "../config/jwt";
import { HttpError } from "../errors";
import { authenticate } from "../middleware/auth";
import { acceptTerms, authenticateUser, registerUser } from "../services/userService";
import { loginSchema } from "../validation/login";
import { registerSchema } from "../validation/register";

const router = Router();

router.post("/register", async (req, res, next) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return next(new HttpError(400, message));
  }

  try {
    res.status(201).json(await registerUser(parsed.data));
  } catch (err) {
    next(err);
  }
});

router.post("/login", async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return next(new HttpError(400, message));
  }

  try {
    const user = await authenticateUser(parsed.data);
    res.json({ token: signToken({ sub: user.id, role: user.role }), user });
  } catch (err) {
    next(err);
  }
});

router.post("/accept-terms", authenticate, async (req, res, next) => {
  try {
    const { sub, role } = req.user!;
    res.json(await acceptTerms(role, sub));
  } catch (err) {
    next(err);
  }
});

export default router;
