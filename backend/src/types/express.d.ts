import type { TokenPayload } from "../config/jwt";

declare global {
  namespace Express {
    interface Request {
      // Set by the authenticate middleware.
      user?: Pick<TokenPayload, "sub" | "role">;
    }
  }
}

export {};
