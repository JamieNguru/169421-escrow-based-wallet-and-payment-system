import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";

import { signToken } from "../src/config/jwt";
import { authenticate, requireRole } from "../src/middleware/auth";
import { errorHandler } from "../src/middleware/errorHandler";

process.env.JWT_SECRET = "test-secret";

function buildApp() {
  const app = express();
  app.get("/any", authenticate, (req, res) => res.json({ user: req.user }));
  app.get("/client", authenticate, requireRole("client"), (_req, res) => res.json({ ok: true }));
  app.get("/staff", authenticate, requireRole("worker", "admin"), (_req, res) =>
    res.json({ ok: true }),
  );
  app.get("/unauthenticated-guard", requireRole("client"), (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe("authenticate", () => {
  const app = buildApp();

  it("returns 401 when the Authorization header is missing", async () => {
    const res = await request(app).get("/any");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("authentication required");
  });

  it("returns 401 when the scheme is not Bearer", async () => {
    const token = signToken({ sub: "u1", role: "client" });
    const res = await request(app).get("/any").set("Authorization", `Basic ${token}`);
    expect(res.status).toBe(401);
  });

  it("returns 401 when the Bearer token is empty", async () => {
    const res = await request(app).get("/any").set("Authorization", "Bearer ");
    expect(res.status).toBe(401);
  });

  it("returns 401 for a malformed token", async () => {
    const res = await request(app).get("/any").set("Authorization", "Bearer not-a-jwt");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid or expired token");
  });

  it("returns 401 for a token signed with a different secret", async () => {
    const token = jwt.sign({ sub: "u1", role: "client" }, "other-secret");
    const res = await request(app).get("/any").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("returns 401 for an expired token", async () => {
    const token = jwt.sign({ sub: "u1", role: "client" }, "test-secret", { expiresIn: -10 });
    const res = await request(app).get("/any").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("sets req.user from a valid token", async () => {
    const token = signToken({ sub: "u1", role: "worker" });
    const res = await request(app).get("/any").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ sub: "u1", role: "worker" });
  });
});

describe("requireRole", () => {
  const app = buildApp();
  const as = (role: "client" | "worker" | "admin") => `Bearer ${signToken({ sub: "u1", role })}`;

  it("allows a matching role", async () => {
    const res = await request(app).get("/client").set("Authorization", as("client"));
    expect(res.status).toBe(200);
  });

  it("returns 403 for a different role", async () => {
    const res = await request(app).get("/client").set("Authorization", as("worker"));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("you do not have permission to access this resource");
  });

  it("allows any of several roles", async () => {
    const worker = await request(app).get("/staff").set("Authorization", as("worker"));
    const admin = await request(app).get("/staff").set("Authorization", as("admin"));
    expect(worker.status).toBe(200);
    expect(admin.status).toBe(200);
  });

  it("returns 403 for a role outside the list", async () => {
    const res = await request(app).get("/staff").set("Authorization", as("client"));
    expect(res.status).toBe(403);
  });

  it("returns 401 if used without authenticate", async () => {
    const res = await request(app).get("/unauthenticated-guard");
    expect(res.status).toBe(401);
  });
});
