import jwt, { type SignOptions } from "jsonwebtoken";

export interface TokenPayload {
  sub: string;
  role: "client" | "worker" | "admin";
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT is not configured: set JWT_SECRET in .env");
  }
  return secret;
}

export function signToken(payload: TokenPayload): string {
  const expiresIn = (process.env.JWT_EXPIRES_IN || "1d") as SignOptions["expiresIn"];
  return jwt.sign(payload, getSecret(), { algorithm: "HS256", expiresIn });
}

// Throws if the token is malformed, expired or signed with a different secret.
export function verifyToken(token: string): TokenPayload & { iat: number; exp: number } {
  return jwt.verify(token, getSecret(), { algorithms: ["HS256"] }) as TokenPayload & {
    iat: number;
    exp: number;
  };
}
