import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";

// The terms gate has its own tests (requireTerms.test.ts); let requests through here.
jest.mock("../src/middleware/requireTerms", () => ({
  requireTerms: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Minimal in-memory stand-in for the Firestore calls postJob makes.
const store = new Map<string, Record<string, any>>();
let nextId = 1;

jest.mock("../src/config/firebase", () => ({
  getDb: () => ({
    collection: (name: string) => ({
      doc: (id: string = `auto${nextId++}`) => ({
        id,
        path: `${name}/${id}`,
        set: async (data: Record<string, any>) => {
          store.set(`${name}/${id}`, data);
        },
      }),
    }),
  }),
}));

const tokenFor = (sub: string, role: "client" | "worker" | "admin") =>
  `Bearer ${signToken({ sub, role })}`;

const body = { title: "Fix my sink", description: "Leaking kitchen tap", budget: 1500, currency: "KES" };

describe("POST /api/jobs", () => {
  const app = createApp();

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    store.clear();
    nextId = 1;
  });

  const post = (payload: unknown = body, auth: string | null = tokenFor("client1", "client")) => {
    const req = request(app).post("/api/jobs");
    return (auth ? req.set("Authorization", auth) : req).send(payload as object);
  };

  test("creates an open job owned by the client", async () => {
    const res = await post();

    expect(res.status).toBe(201);
    expect(res.body.job).toMatchObject({ id: "auto1", clientId: "client1", status: "open", ...body });
    expect(store.get("jobs/auto1")).toMatchObject({ clientId: "client1", status: "open", ...body });
  });

  test("trims text and normalises the currency", async () => {
    const res = await post({ ...body, title: "  Fix my sink  ", currency: "usd" });

    expect(res.status).toBe(201);
    expect(res.body.job).toMatchObject({ title: "Fix my sink", currency: "USD" });
  });

  test.each([
    ["missing title", { ...body, title: undefined }, "title is required"],
    ["blank description", { ...body, description: "   " }, "description is required"],
    ["non-numeric budget", { ...body, budget: "1500" }, "budget must be a number"],
    ["zero budget", { ...body, budget: 0 }, "budget must be greater than 0"],
    ["unsupported currency", { ...body, currency: "EUR" }, "currency must be one of"],
    ["missing currency", { ...body, currency: undefined }, "currency is required"],
  ])("rejects %s with 400", async (_name, payload, message) => {
    const res = await post(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain(message);
    expect(store.size).toBe(0);
  });

  test("rejects a missing token with 401", async () => {
    const res = await post(body, null);

    expect(res.status).toBe(401);
    expect(store.size).toBe(0);
  });

  test.each(["worker", "admin"] as const)("rejects a %s with 403", async (role) => {
    const res = await post(body, tokenFor("user1", role));

    expect(res.status).toBe(403);
    expect(store.size).toBe(0);
  });
});
