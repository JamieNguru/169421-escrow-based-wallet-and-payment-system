import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";

// The terms gate has its own tests (requireTerms.test.ts); let requests through here.
jest.mock("../src/middleware/requireTerms", () => ({
  requireTerms: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Minimal in-memory stand-in for the Firestore calls fundEscrow makes.
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

const body = { jobId: "job1", workerId: "worker1", amount: 500 };

describe("POST /api/escrow/fund", () => {
  const app = createApp();

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    store.clear();
    store.set("workers/worker1", { name: "Wanjiru" });
    store.set("jobs/job1", {
      clientId: "client1",
      workerId: "worker1",
      status: "assigned",
      budget: 900,
      currency: "KES",
      agreedPrice: 500,
      agreedCurrency: "KES",
    });
    store.set("wallets/w1", {
      ownerId: "client1",
      ownerRole: "client",
      currency: "KES",
      balance: 1000,
      escrowBalance: 0,
    });
  });

  const fund = (payload: unknown = body, auth = tokenFor("client1", "client")) =>
    request(app).post("/api/escrow/fund").set("Authorization", auth).send(payload as object);

  test("moves funds into escrow and creates the escrow doc", async () => {
    const res = await fund();

    expect(res.status).toBe(201);
    expect(res.body.escrow).toMatchObject({
      jobId: "job1",
      clientId: "client1",
      workerId: "worker1",
      amount: 500,
      currency: "KES",
      status: "in_escrow",
    });
    expect(store.get("wallets/w1")).toMatchObject({ balance: 500, escrowBalance: 500 });
    expect(store.get("escrows/job1")).toMatchObject({ status: "in_escrow", amount: 500 });
  });

  test("records the funding in the transactions collection", async () => {
    await fund();

    expect(store.get("transactions/fund-job1")).toMatchObject({
      jobId: "job1",
      type: "escrow_fund",
      amount: 500,
      currency: "KES",
      fromUserId: "client1",
      toUserId: "worker1",
    });
    expect(store.get("transactions/fund-job1")!.createdAt).toBeDefined();
  });

  test("takes the amount from the job when none is sent", async () => {
    const res = await fund({ jobId: "job1", workerId: "worker1" });

    expect(res.status).toBe(201);
    expect(res.body.escrow.amount).toBe(500);
    expect(store.get("wallets/w1")).toMatchObject({ balance: 500, escrowBalance: 500 });
  });

  test("409 when the amount sent is not the job's agreed price, and nothing moves", async () => {
    const res = await fund({ ...body, amount: 1 });

    expect(res.status).toBe(409);
    expect(store.get("wallets/w1")).toMatchObject({ balance: 1000, escrowBalance: 0 });
    expect(store.has("escrows/job1")).toBe(false);
  });

  test("falls back to the budget for a job assigned before quotes existed", async () => {
    store.set("jobs/job1", { ...store.get("jobs/job1"), agreedPrice: undefined, agreedCurrency: undefined });
    const res = await fund({ jobId: "job1", workerId: "worker1" });

    expect(res.status).toBe(201);
    expect(res.body.escrow.amount).toBe(900);
  });

  test("404 for an unknown job", async () => {
    store.delete("jobs/job1");
    expect((await fund()).status).toBe(404);
  });

  test("403 when the job belongs to another client", async () => {
    store.set("jobs/job1", { ...store.get("jobs/job1"), clientId: "client2" });
    const res = await fund();

    expect(res.status).toBe(403);
    expect(store.get("wallets/w1")).toMatchObject({ balance: 1000, escrowBalance: 0 });
  });

  test("409 when the job has no worker yet", async () => {
    store.set("jobs/job1", { clientId: "client1", status: "open", budget: 900, currency: "KES" });
    expect((await fund()).status).toBe(409);
  });

  test("409 when the worker is not the one assigned", async () => {
    store.set("workers/worker2", { name: "Otieno" });
    expect((await fund({ ...body, workerId: "worker2" })).status).toBe(409);
  });

  test("does not record a transaction when funding fails", async () => {
    store.set("wallets/w1", { ...store.get("wallets/w1"), balance: 100 });
    await fund();

    expect([...store.keys()].filter((k) => k.startsWith("transactions/"))).toHaveLength(0);
  });

  test("allows funding the exact wallet balance", async () => {
    store.set("wallets/w1", { ...store.get("wallets/w1"), balance: 500 });
    await fund();

    expect(store.get("wallets/w1")).toMatchObject({ balance: 0, escrowBalance: 500 });
  });

  test.each([
    ["missing jobId", { workerId: "worker1", amount: 5 }],
    ["missing workerId", { jobId: "job1", amount: 5 }],
    ["zero amount", { ...body, amount: 0 }],
    ["negative amount", { ...body, amount: -5 }],
    ["string amount", { ...body, amount: "500" }],
  ])("rejects %s with 400", async (_name, payload) => {
    const res = await fund(payload);

    expect(res.status).toBe(400);
    expect(store.has("escrows/job1")).toBe(false);
  });

  test("rejects a request without a token with 401", async () => {
    const res = await request(app).post("/api/escrow/fund").send(body);

    expect(res.status).toBe(401);
  });

  test.each(["worker", "admin"] as const)("rejects a %s with 403", async (role) => {
    const res = await fund(body, tokenFor("someone", role));

    expect(res.status).toBe(403);
    expect(store.get("wallets/w1")).toMatchObject({ balance: 1000, escrowBalance: 0 });
  });

  test("returns 404 for an unknown worker", async () => {
    store.delete("workers/worker1");
    const res = await fund();

    expect(res.status).toBe(404);
    expect(store.get("wallets/w1")).toMatchObject({ balance: 1000, escrowBalance: 0 });
  });

  test("returns 404 when the client has no wallet", async () => {
    store.set("jobs/job1", { ...store.get("jobs/job1"), clientId: "client2" });
    const res = await fund(body, tokenFor("client2", "client"));

    expect(res.status).toBe(404);
    expect(store.has("escrows/job1")).toBe(false);
  });

  test("returns 402 when the balance is too low", async () => {
    store.set("wallets/w1", { ...store.get("wallets/w1"), balance: 499 });
    const res = await fund();

    expect(res.status).toBe(402);
    expect(store.get("wallets/w1")).toMatchObject({ balance: 499, escrowBalance: 0 });
    expect(store.has("escrows/job1")).toBe(false);
  });

  test("returns 409 when the job is already funded and leaves the wallet alone", async () => {
    await fund();
    const res = await fund();

    expect(res.status).toBe(409);
    expect(store.get("wallets/w1")).toMatchObject({ balance: 500, escrowBalance: 500 });
  });
});
