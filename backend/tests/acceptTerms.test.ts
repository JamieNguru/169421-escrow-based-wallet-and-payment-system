import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";
import { CURRENT_TERMS_VERSION } from "../src/config/terms";

// In-memory stand-in for the Firestore calls acceptTerms makes.
const store = new Map<string, Record<string, any>>();

jest.mock("../src/config/firebase", () => ({
  getDb: () => ({
    collection: (name: string) => ({
      doc: (id: string) => ({
        id,
        path: `${name}/${id}`,
        get: async () => ({ exists: store.has(`${name}/${id}`), data: () => store.get(`${name}/${id}`) }),
        update: async (data: Record<string, any>) => {
          store.set(`${name}/${id}`, { ...store.get(`${name}/${id}`), ...data });
        },
      }),
    }),
  }),
}));

const tokenFor = (sub: string, role: "client" | "worker" | "admin") =>
  `Bearer ${signToken({ sub, role })}`;

describe("terms of service", () => {
  const app = createApp();

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    store.clear();
    store.set("clients/c1", { name: "Jane" });
    store.set("workers/w1", { name: "Joe", termsVersion: "2025-01-v0" });
  });

  test("GET /api/terms returns the current version and page", async () => {
    const res = await request(app).get("/api/terms");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ version: CURRENT_TERMS_VERSION, url: "/terms" });
  });

  test.each([
    ["client", "c1", "clients/c1"],
    ["worker", "w1", "workers/w1"],
  ] as const)("a %s can accept the current terms", async (role, id, path) => {
    const res = await request(app).post("/api/auth/accept-terms").set("Authorization", tokenFor(id, role));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ termsAccepted: true, termsVersion: CURRENT_TERMS_VERSION });
    expect(store.get(path)).toMatchObject({ termsVersion: CURRENT_TERMS_VERSION });
    expect(store.get(path)?.termsAcceptedAt).toBeInstanceOf(Date);
  });

  test("requires authentication", async () => {
    const res = await request(app).post("/api/auth/accept-terms");

    expect(res.status).toBe(401);
  });

  test("admins have no terms to accept", async () => {
    const res = await request(app).post("/api/auth/accept-terms").set("Authorization", tokenFor("a1", "admin"));

    expect(res.status).toBe(403);
  });
});
