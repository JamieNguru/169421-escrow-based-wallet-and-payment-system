import type { TokenPayload } from "../config/jwt";

declare global {
  namespace Express {
    interface Request {
      // Set by the authenticate middleware.
      user?: Pick<TokenPayload, "sub" | "role">;
      // The unparsed JSON body, kept so webhook signatures can be checked.
      rawBody?: Buffer;
    }
  }
}

export {};
