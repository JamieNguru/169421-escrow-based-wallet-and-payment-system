import { Router } from "express";

import { HttpError } from "../errors";
import { registerUser } from "../services/userService";
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

export default router;
