import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";

// Minimal in-memory stand-in for the Firestore calls getEscrow makes.
const store = new Map<string, Record<string, any>>();

jest.mock("../src/config/firebase", () => ({
  getDb: () => ({
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          const data = store.get(`${name}/${id}`);
          return { exists: data !== undefined, data: () => data };
        },
      }),
    }),
  }),
}));

const tokenFor = (sub: string, role: "client" | "worker" | "admin") =>
  `Bearer ${signToken({ sub, role })}`;

describe("GET /api/escrow/:jobId", () => {
  const app = createApp();

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    store.clear();
    store.set("escrows/job1", {
      jobId: "job1",
      clientId: "client1",
      workerId: "worker1",
      amount: 500,
      currency: "KES",
      status: "in_escrow",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      fundedAt: { toDate: () => new Date("2026-01-01T00:00:00Z") },
    });
  });

  const view = (jobId = "job1", auth?: string) => {
    const req = request(app).get(`/api/escrow/${jobId}`);
    return auth ? req.set("Authorization", auth) : req;
  };

  test.each([
    ["the owning client", "client1", "client"],
    ["the assigned worker", "worker1", "worker"],
    ["an admin", "admin1", "admin"],
  ] as const)("returns the escrow to %s", async (_name, sub, role) => {
    const res = await view("job1", tokenFor(sub, role));

    expect(res.status).toBe(200);
    expect(res.body.escrow).toMatchObject({
      jobId: "job1",
      clientId: "client1",
      workerId: "worker1",
      amount: 500,
      currency: "KES",
      status: "in_escrow",
      createdAt: "2026-01-01T00:00:00.000Z",
      fundedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  test("reflects the stored status", async () => {
    store.set("escrows/job1", { ...store.get("escrows/job1")!, status: "completed" });

    const res = await view("job1", tokenFor("client1", "client"));

    expect(res.body.escrow.status).toBe("completed");
  });

  test.each([
    ["another client", "client2", "client"],
    ["another worker", "worker2", "worker"],
  ] as const)("rejects %s with 403", async (_name, sub, role) => {
    const res = await view("job1", tokenFor(sub, role));

    expect(res.status).toBe(403);
  });

  test("returns 404 for an unknown job", async () => {
    const res = await view("ghost", tokenFor("admin1", "admin"));

    expect(res.status).toBe(404);
  });

  test("rejects a request without a token with 401", async () => {
    const res = await view("job1");

    expect(res.status).toBe(401);
  });
});
