import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";

// Minimal in-memory stand-in for the Firestore calls requestRefund makes.
const store = new Map<string, Record<string, any>>();

const refFor = (name: string, id: string) => ({ id, path: `${name}/${id}` });

jest.mock("../src/config/firebase", () => ({
  getDb: () => ({
    collection: (name: string) => ({
      doc: (id: string) => refFor(name, id),
    }),
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => {
      const writes: Array<[string, Record<string, any>]> = [];
      const result = await fn({
        get: async (ref: { path: string }) => {
          const data = store.get(ref.path);
          return { exists: data !== undefined, data: () => data };
        },
        set: (ref: { path: string }, data: Record<string, any>) => writes.push([ref.path, data]),
      });
      writes.forEach(([path, data]) => store.set(path, data));
      return result;
    },
  }),
}));

const tokenFor = (sub: string, role: "client" | "worker" | "admin") =>
  `Bearer ${signToken({ sub, role })}`;

// Signed on demand because JWT_SECRET is only set in beforeEach.
const clientAuth = () => tokenFor("client1", "client");

describe("POST /api/escrow/:jobId/refund-request", () => {
  const app = createApp();

  const seedEscrow = (jobId: string, status: string) =>
    store.set(`escrows/${jobId}`, {
      jobId,
      clientId: "client1",
      workerId: "worker1",
      amount: 500,
      currency: "KES",
      status,
      createdAt: new Date(),
      fundedAt: new Date(),
    });

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    store.clear();
    seedEscrow("job1", "in_escrow");
    store.set("wallets/c1", {
      ownerId: "client1",
      ownerRole: "client",
      currency: "KES",
      balance: 0,
      escrowBalance: 500,
    });
  });

  const requestRefund = (body: unknown = { reason: "Work was never started" }, jobId = "job1", auth = clientAuth()) =>
    request(app).post(`/api/escrow/${jobId}/refund-request`).set("Authorization", auth).send(body as object);

  test.each(["in_escrow", "work_submitted"])("creates a pending request for a %s escrow", async (status) => {
    seedEscrow("job1", status);

    const res = await requestRefund();

    expect(res.status).toBe(201);
    expect(res.body.refundRequest).toMatchObject({
      jobId: "job1",
      clientId: "client1",
      workerId: "worker1",
      amount: 500,
      currency: "KES",
      reason: "Work was never started",
      status: "pending",
    });
    expect(res.body.refundRequest.createdAt).toBeDefined();
    expect(store.get("refundRequests/job1")).toMatchObject({ status: "pending", reason: "Work was never started" });
  });

  test("trims the reason", async () => {
    const res = await requestRefund({ reason: "  Not delivered  " });

    expect(res.body.refundRequest.reason).toBe("Not delivered");
  });

  test("changes no escrow status, wallet or ledger entry", async () => {
    await requestRefund();

    expect(store.get("escrows/job1")).toMatchObject({ status: "in_escrow" });
    expect(store.get("wallets/c1")).toMatchObject({ balance: 0, escrowBalance: 500 });
    expect([...store.keys()].filter((k) => k.startsWith("transactions/"))).toHaveLength(0);
  });

  test.each([
    ["missing", {}],
    ["empty", { reason: "   " }],
    ["not a string", { reason: 42 }],
    ["too long", { reason: "x".repeat(1001) }],
  ])("returns 400 when the reason is %s", async (_label, body) => {
    const res = await requestRefund(body);

    expect(res.status).toBe(400);
    expect(store.has("refundRequests/job1")).toBe(false);
  });

  test("returns 404 when the escrow does not exist", async () => {
    expect((await requestRefund(undefined, "missing")).status).toBe(404);
  });

  test("returns 403 for a client who does not own the job", async () => {
    const res = await requestRefund(undefined, "job1", tokenFor("client2", "client"));

    expect(res.status).toBe(403);
    expect(store.has("refundRequests/job1")).toBe(false);
  });

  test.each(["worker", "admin"] as const)("returns 403 for a %s", async (role) => {
    expect((await requestRefund(undefined, "job1", tokenFor("worker1", role))).status).toBe(403);
  });

  test.each(["pending", "disputed", "completed", "refunded"])(
    "returns 409 for an escrow that is %s",
    async (status) => {
      seedEscrow("job1", status);

      const res = await requestRefund();

      expect(res.status).toBe(409);
      expect(store.has("refundRequests/job1")).toBe(false);
    },
  );

  test("returns 409 and keeps the original when a request already exists", async () => {
    await requestRefund({ reason: "First reason" });
    const res = await requestRefund({ reason: "Second reason" });

    expect(res.status).toBe(409);
    expect(store.get("refundRequests/job1")).toMatchObject({ reason: "First reason" });
  });

  test("returns 401 without a token", async () => {
    expect((await request(app).post("/api/escrow/job1/refund-request").send({ reason: "x" })).status).toBe(401);
  });
});
