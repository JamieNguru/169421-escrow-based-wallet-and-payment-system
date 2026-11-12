import type { RequestHandler } from "express";

import { CURRENT_TERMS_VERSION } from "../config/terms";
import { HttpError } from "../errors";
import { hasAcceptedTerms } from "../services/userService";

// Use after authenticate and requireRole. Blocks clients and workers who
// haven't accepted the current terms; admins are exempt.
export const requireTerms: RequestHandler = async (req, _res, next) => {
  if (!req.user) {
    return next(new HttpError(401, "authentication required"));
  }
  if (req.user.role === "admin") {
    return next();
  }
  try {
    if (!(await hasAcceptedTerms(req.user.role, req.user.sub))) {
      return next(
        new HttpError(403, `Accept the terms of service (${CURRENT_TERMS_VERSION}) to continue`),
      );
    }
    next();
  } catch (err) {
    next(err);
  }
};
