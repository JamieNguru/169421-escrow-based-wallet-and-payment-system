import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";
import { CURRENT_TERMS_VERSION } from "../src/config/terms";

// Only the user docs are read; the job body below fails validation, so a
// request that gets past the gate answers 400 without touching anything else.
const store = new Map<string, Record<string, any>>();

jest.mock("../src/config/firebase", () => ({
  getDb: () => ({
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => ({ exists: store.has(`${name}/${id}`), data: () => store.get(`${name}/${id}`) }),
      }),
    }),
  }),
}));

const tokenFor = (sub: string, role: "client" | "worker" | "admin") =>
  `Bearer ${signToken({ sub, role })}`;

describe("requireTerms gate", () => {
  const app = createApp();

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    store.clear();
    store.set("clients/accepted", { termsVersion: CURRENT_TERMS_VERSION });
    store.set("clients/old", { termsVersion: "2025-01-v0" });
    store.set("clients/never", {});
    store.set("workers/never", {});
  });

  const createJob = (auth: string) => request(app).post("/api/jobs").set("Authorization", auth).send({});

  test("blocks a client who has not accepted", async () => {
    const res = await createJob(tokenFor("never", "client"));

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/terms of service/i);
  });

  test("blocks a client who accepted an older version", async () => {
    expect((await createJob(tokenFor("old", "client"))).status).toBe(403);
  });

  test("lets a client who accepted the current version through", async () => {
    expect((await createJob(tokenFor("accepted", "client"))).status).toBe(400);
  });

  test.each([
    ["fund escrow", "post", "/api/escrow/fund", "client"],
    ["raise a dispute", "post", "/api/escrow/job1/dispute", "worker"],
    ["start an STK push", "post", "/api/payments/stk-push", "client"],
    ["top up", "post", "/api/payments/top-up", "client"],
    ["withdraw", "post", "/api/payments/withdraw", "worker"],
  ] as const)("blocks %s before acceptance", async (_label, _method, path, role) => {
    const res = await request(app).post(path).set("Authorization", tokenFor("never", role)).send({});

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/terms of service/i);
  });
});
