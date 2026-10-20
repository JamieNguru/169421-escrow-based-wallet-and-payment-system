import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";

// Minimal in-memory stand-in for the Firestore calls processRefund makes.
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

describe("POST /api/escrow/:jobId/process-refund", () => {
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

  const seedRequest = (jobId: string, status = "pending") =>
    store.set(`refundRequests/${jobId}`, {
      jobId,
      clientId: "client1",
      workerId: "worker1",
      amount: 500,
      currency: "KES",
      reason: "Worker stopped responding",
      status,
      createdAt: new Date(),
    });

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    store.clear();
    seedEscrow("job1", "in_escrow");
    seedRequest("job1");
    store.set("wallets/c1", {
      ownerId: "client1",
      ownerRole: "client",
      currency: "KES",
      balance: 100,
      escrowBalance: 500,
    });
  });

  const processRefundRequest = (jobId = "job1", auth = adminAuth()) =>
    request(app).post(`/api/escrow/${jobId}/process-refund`).set("Authorization", auth);

  const ledger = () => [...store.keys()].filter((k) => k.startsWith("transactions/"));

  test.each(["in_escrow", "work_submitted"])("refunds the client from %s", async (status) => {
    seedEscrow("job1", status);

    const res = await processRefundRequest();

    expect(res.status).toBe(200);
    expect(res.body.refundRequest).toMatchObject({
      jobId: "job1",
      status: "approved",
      processedBy: "admin1",
    });
    expect(store.get("escrows/job1")).toMatchObject({ status: "refunded" });
    expect(store.get("escrows/job1")!.refundedAt).toBeInstanceOf(Date);
    expect(store.get("refundRequests/job1")).toMatchObject({ status: "approved", processedBy: "admin1" });
    expect(store.get("wallets/c1")).toMatchObject({ balance: 600, escrowBalance: 0 });
    expect(ledger()).toEqual(["transactions/refund-job1"]);
    expect(store.get("transactions/refund-job1")).toMatchObject({
      type: "escrow_refund",
      amount: 500,
      toUserId: "client1",
    });
  });

  test("404 when the escrow does not exist", async () => {
    const res = await processRefundRequest("missing");
    expect(res.status).toBe(404);
  });

  test("404 when no refund was requested", async () => {
    store.delete("refundRequests/job1");

    const res = await processRefundRequest();

    expect(res.status).toBe(404);
    expect(store.get("escrows/job1")).toMatchObject({ status: "in_escrow" });
  });

  test("409 when the request was already processed", async () => {
    expect((await processRefundRequest()).status).toBe(200);

    const res = await processRefundRequest();

    expect(res.status).toBe(409);
    expect(store.get("wallets/c1")).toMatchObject({ balance: 600, escrowBalance: 0 });
    expect(ledger()).toHaveLength(1);
  });

  test.each(["disputed", "completed", "refunded"])("409 when the escrow is %s", async (status) => {
    seedEscrow("job1", status);

    const res = await processRefundRequest();

    expect(res.status).toBe(409);
    expect(store.get("refundRequests/job1")).toMatchObject({ status: "pending" });
    expect(store.get("wallets/c1")).toMatchObject({ balance: 100, escrowBalance: 500 });
    expect(ledger()).toHaveLength(0);
  });

  test("404 when the client wallet is missing and nothing changes", async () => {
    store.delete("wallets/c1");

    const res = await processRefundRequest();

    expect(res.status).toBe(404);
    expect(store.get("escrows/job1")).toMatchObject({ status: "in_escrow" });
    expect(store.get("refundRequests/job1")).toMatchObject({ status: "pending" });
  });

  test.each(["client", "worker"] as const)("403 for a %s", async (role) => {
    const res = await processRefundRequest("job1", tokenFor("someone", role));
    expect(res.status).toBe(403);
  });

  test("401 without a token", async () => {
    const res = await request(app).post("/api/escrow/job1/process-refund");
    expect(res.status).toBe(401);
  });
});
