import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";

// Minimal in-memory stand-in for the Firestore calls resolveDispute makes.
const store = new Map<string, Record<string, any>>();

const refFor = (name: string, id: string) => ({ id, path: `${name}/${id}` });

jest.mock("../src/config/firebase", () => ({
  getDb: () => ({
    collection: (name: string) => ({
      doc: (id: string) => refFor(name, id),
      where: (field: string, _op: string, value: unknown) => {
        const query = { name, field, value, limit: () => query };
        return query;
      },
    }),
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => {
      const writes: Array<[string, Record<string, any>, boolean]> = [];
      const result = await fn({
        get: async (target: any) => {
          if (target.path) {
            const data = store.get(target.path);
            return { exists: data !== undefined, data: () => data };
          }
          const docs = [...store.entries()]
            .filter(([path, data]) => path.startsWith(`${target.name}/`) && data[target.field] === target.value)
            .map(([path, data]) => ({
              id: path.split("/")[1],
              ref: refFor(target.name, path.split("/")[1]),
              data: () => data,
            }));
          return { empty: docs.length === 0, docs };
        },
        set: (ref: { path: string }, data: Record<string, any>) => writes.push([ref.path, data, false]),
        update: (ref: { path: string }, data: Record<string, any>) => writes.push([ref.path, data, true]),
      });
      writes.forEach(([path, data, merge]) => store.set(path, merge ? { ...store.get(path), ...data } : data));
      return result;
    },
  }),
}));

const tokenFor = (sub: string, role: "client" | "worker" | "admin") =>
  `Bearer ${signToken({ sub, role })}`;

// Signed on demand because JWT_SECRET is only set in beforeEach.
const adminAuth = () => tokenFor("admin1", "admin");

describe("POST /api/escrow/:jobId/resolve-dispute", () => {
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
      disputedAt: new Date(),
    });

  const seedDispute = (jobId: string) =>
    store.set(`disputes/${jobId}`, {
      jobId,
      clientId: "client1",
      workerId: "worker1",
      amount: 500,
      currency: "KES",
      raisedBy: "client1",
      raisedByRole: "client",
      reason: "Work does not match the brief",
      previousStatus: "work_submitted",
      status: "open",
      createdAt: new Date(),
    });

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    store.clear();
    seedEscrow("job1", "disputed");
    seedDispute("job1");
    store.set("wallets/c1", {
      ownerId: "client1",
      ownerRole: "client",
      currency: "KES",
      balance: 0,
      escrowBalance: 500,
    });
    store.set("wallets/w1", {
      ownerId: "worker1",
      ownerRole: "worker",
      currency: "KES",
      balance: 100,
      escrowBalance: 0,
    });
  });

  const resolve = (
    body: unknown = { decision: "release", resolution: "Work met the brief" },
    jobId = "job1",
    auth = adminAuth(),
  ) => request(app).post(`/api/escrow/${jobId}/resolve-dispute`).set("Authorization", auth).send(body as object);

  const ledger = () => [...store.keys()].filter((k) => k.startsWith("transactions/"));

  test("release pays the worker and completes the escrow", async () => {
    const res = await resolve();

    expect(res.status).toBe(200);
    expect(res.body.dispute).toMatchObject({
      jobId: "job1",
      status: "resolved",
      decision: "release",
      resolution: "Work met the brief",
      resolvedBy: "admin1",
      reason: "Work does not match the brief",
    });
    expect(res.body.dispute.resolvedAt).toBeDefined();
    expect(store.get("wallets/c1")).toMatchObject({ balance: 0, escrowBalance: 0 });
    expect(store.get("wallets/w1")).toMatchObject({ balance: 600 });
    expect(store.get("escrows/job1")).toMatchObject({ status: "completed" });
    expect(store.get("escrows/job1")!.completedAt).toBeDefined();
    expect(store.get("disputes/job1")).toMatchObject({ status: "resolved", decision: "release" });
    expect(ledger()).toEqual(["transactions/release-job1"]);
    expect(store.get("transactions/release-job1")).toMatchObject({
      type: "escrow_release",
      amount: 500,
      fromUserId: "client1",
      toUserId: "worker1",
    });
  });

  test("refund returns the money to the client and refunds the escrow", async () => {
    const res = await resolve({ decision: "refund", resolution: "Work was never delivered" });

    expect(res.status).toBe(200);
    expect(res.body.dispute).toMatchObject({ status: "resolved", decision: "refund", resolvedBy: "admin1" });
    expect(store.get("wallets/c1")).toMatchObject({ balance: 500, escrowBalance: 0 });
    expect(store.get("wallets/w1")).toMatchObject({ balance: 100 });
    expect(store.get("escrows/job1")).toMatchObject({ status: "refunded" });
    expect(store.get("escrows/job1")!.refundedAt).toBeDefined();
    expect(store.get("escrows/job1")!.completedAt).toBeUndefined();
    expect(ledger()).toEqual(["transactions/refund-job1"]);
    expect(store.get("transactions/refund-job1")).toMatchObject({
      type: "escrow_refund",
      amount: 500,
      toUserId: "client1",
    });
  });

  test("trims the resolution", async () => {
    const res = await resolve({ decision: "release", resolution: "  Approved  " });

    expect(res.body.dispute.resolution).toBe("Approved");
  });

  test.each([
    ["decision is missing", { resolution: "x" }],
    ["decision is unknown", { decision: "split", resolution: "x" }],
    ["resolution is missing", { decision: "release" }],
    ["resolution is empty", { decision: "release", resolution: "   " }],
    ["resolution is not a string", { decision: "release", resolution: 42 }],
    ["resolution is too long", { decision: "release", resolution: "x".repeat(1001) }],
  ])("returns 400 when the %s", async (_label, body) => {
    const res = await resolve(body);

    expect(res.status).toBe(400);
    expect(store.get("escrows/job1")).toMatchObject({ status: "disputed" });
    expect(store.get("disputes/job1")).toMatchObject({ status: "open" });
    expect(ledger()).toHaveLength(0);
  });

  test.each([
    ["a client", () => tokenFor("client1", "client")],
    ["a worker", () => tokenFor("worker1", "worker")],
  ])("returns 403 for %s", async (_label, auth) => {
    const res = await resolve(undefined, "job1", auth());

    expect(res.status).toBe(403);
    expect(store.get("escrows/job1")).toMatchObject({ status: "disputed" });
  });

  test("returns 404 when the escrow does not exist", async () => {
    expect((await resolve(undefined, "missing")).status).toBe(404);
  });

  test("returns 404 when the escrow has no dispute", async () => {
    seedEscrow("job2", "disputed");

    expect((await resolve(undefined, "job2")).status).toBe(404);
    expect(store.get("escrows/job2")).toMatchObject({ status: "disputed" });
  });

  test.each(["in_escrow", "work_submitted", "completed", "refunded"])(
    "returns 409 for an escrow that is %s",
    async (status) => {
      seedEscrow("job1", status);

      const res = await resolve();

      expect(res.status).toBe(409);
      expect(store.get("disputes/job1")).toMatchObject({ status: "open" });
      expect(ledger()).toHaveLength(0);
    },
  );

  test("returns 409 and moves no money when resolved a second time", async () => {
    await resolve({ decision: "release", resolution: "First" });
    const res = await resolve({ decision: "refund", resolution: "Second" });

    expect(res.status).toBe(409);
    expect(store.get("disputes/job1")).toMatchObject({ decision: "release", resolution: "First" });
    expect(store.get("wallets/w1")).toMatchObject({ balance: 600 });
    expect(store.get("wallets/c1")).toMatchObject({ balance: 0, escrowBalance: 0 });
  });

  test("returns 404 and leaves everything untouched when the client wallet is missing", async () => {
    store.delete("wallets/c1");

    const res = await resolve({ decision: "refund", resolution: "x" });

    expect(res.status).toBe(404);
    expect(store.get("escrows/job1")).toMatchObject({ status: "disputed" });
    expect(store.get("disputes/job1")).toMatchObject({ status: "open" });
  });

  test("returns 401 without a token", async () => {
    const res = await request(app)
      .post("/api/escrow/job1/resolve-dispute")
      .send({ decision: "release", resolution: "x" });

    expect(res.status).toBe(401);
  });

  describe("split", () => {
    test("divides the escrow between client and worker and records both halves", async () => {
      const res = await resolve({ decision: "split", clientAmount: 200, resolution: "Half the work was done" });

      expect(res.status).toBe(200);
      expect(res.body.dispute).toMatchObject({
        status: "resolved",
        decision: "split",
        clientAmount: 200,
        workerAmount: 300,
        resolvedBy: "admin1",
      });
      expect(store.get("wallets/c1")).toMatchObject({ balance: 200, escrowBalance: 0 });
      expect(store.get("wallets/w1")).toMatchObject({ balance: 400 });
      expect(store.get("escrows/job1")).toMatchObject({ status: "split", clientAmount: 200, workerAmount: 300 });
      expect(store.get("escrows/job1")!.completedAt).toBeDefined();
      expect(store.get("disputes/job1")).toMatchObject({ decision: "split", clientAmount: 200, workerAmount: 300 });
      expect(ledger().sort()).toEqual(["transactions/refund-job1", "transactions/release-job1"]);
      expect(store.get("transactions/refund-job1")).toMatchObject({ type: "escrow_refund", amount: 200, toUserId: "client1" });
      expect(store.get("transactions/release-job1")).toMatchObject({ type: "escrow_release", amount: 300, toUserId: "worker1" });
    });

    test("rounds to cents so the two halves always add up to the escrow", async () => {
      store.set("escrows/job1", { ...store.get("escrows/job1")!, amount: 100 });
      store.set("wallets/c1", { ...store.get("wallets/c1")!, escrowBalance: 100 });

      const res = await resolve({ decision: "split", clientAmount: 33.333, resolution: "Rough thirds" });

      expect(res.status).toBe(200);
      expect(res.body.dispute).toMatchObject({ clientAmount: 33.33, workerAmount: 66.67 });
      expect(store.get("wallets/c1")).toMatchObject({ balance: 33.33, escrowBalance: 0 });
      expect(store.get("wallets/w1")!.balance).toBeCloseTo(166.67, 2);
    });

    test.each([
      ["a split with no clientAmount", { decision: "split", resolution: "x" }],
      ["a zero clientAmount", { decision: "split", clientAmount: 0, resolution: "x" }],
      ["a negative clientAmount", { decision: "split", clientAmount: -5, resolution: "x" }],
    ])("rejects %s with 400", async (_label, body) => {
      expect((await resolve(body)).status).toBe(400);
    });

    test("rejects a clientAmount equal to or above the escrow and moves no money", async () => {
      const res = await resolve({ decision: "split", clientAmount: 500, resolution: "All back" });

      expect(res.status).toBe(400);
      expect(store.get("escrows/job1")).toMatchObject({ status: "disputed" });
      expect(store.get("wallets/c1")).toMatchObject({ balance: 0, escrowBalance: 500 });
      expect(ledger()).toEqual([]);
    });

    test("cannot be resolved a second time", async () => {
      await resolve({ decision: "split", clientAmount: 200, resolution: "First" });
      const again = await resolve({ decision: "split", clientAmount: 100, resolution: "Second" });

      expect(again.status).toBe(409);
      expect(store.get("wallets/c1")).toMatchObject({ balance: 200 });
    });
  });
});

