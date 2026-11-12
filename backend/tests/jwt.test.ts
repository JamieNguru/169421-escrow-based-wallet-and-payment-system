import jwt from "jsonwebtoken";

import { signToken, verifyToken } from "../src/config/jwt";

describe("jwt", () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    delete process.env.JWT_EXPIRES_IN;
  });

  afterEach(() => {
    process.env = { ...original };
  });

  test("round trips the user id and role", () => {
    const token = signToken({ sub: "abc", role: "worker" });

    expect(verifyToken(token)).toMatchObject({ sub: "abc", role: "worker" });
  });

  test("expires after one day by default", () => {
    const { iat, exp } = verifyToken(signToken({ sub: "abc", role: "client" })) as any;

    expect(exp - iat).toBe(24 * 60 * 60);
  });

  test("JWT_EXPIRES_IN overrides the lifetime", () => {
    process.env.JWT_EXPIRES_IN = "1h";
    const { iat, exp } = verifyToken(signToken({ sub: "abc", role: "client" })) as any;

    expect(exp - iat).toBe(60 * 60);
  });

  test("rejects a token signed with another secret", () => {
    const forged = jwt.sign({ sub: "abc", role: "client" }, "other-secret");

    expect(() => verifyToken(forged)).toThrow();
  });

  test("rejects an expired token", () => {
    const expired = jwt.sign({ sub: "abc", role: "client" }, "test-secret", { expiresIn: -10 });

    expect(() => verifyToken(expired)).toThrow(/expired/);
  });

  test("throws a clear error when JWT_SECRET is missing", () => {
    delete process.env.JWT_SECRET;

    expect(() => signToken({ sub: "abc", role: "client" })).toThrow(/JWT is not configured/);
  });
});
