import type { RequestHandler } from "express";

import { verifyToken, type TokenPayload } from "../config/jwt";
import { HttpError } from "../errors";

// Reads "Authorization: Bearer <token>" and sets req.user to { sub, role }.
export const authenticate: RequestHandler = (req, _res, next) => {
  const [scheme, token] = (req.headers.authorization ?? "").split(" ");

  if (scheme !== "Bearer" || !token) {
    return next(new HttpError(401, "authentication required"));
  }

  try {
    const { sub, role } = verifyToken(token);
    req.user = { sub, role };
    next();
  } catch (err) {
    // A missing JWT_SECRET is a server misconfiguration, not a bad token.
    if (err instanceof Error && err.message.startsWith("JWT is not configured")) {
      return next(err);
    }
    next(new HttpError(401, "invalid or expired token"));
  }
};

// Use after authenticate: requireRole("client"), requireRole("worker", "admin").
export function requireRole(...roles: TokenPayload["role"][]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new HttpError(401, "authentication required"));
    }
    if (!roles.includes(req.user.role)) {
      return next(new HttpError(403, "you do not have permission to access this resource"));
    }
    next();
  };
}
