import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";

// Minimal in-memory stand-in for the Firestore calls markWorkComplete and confirmCompletion make.
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
const clientAuth = () => tokenFor("client1", "client");
const workerAuth = () => tokenFor("worker1", "worker");

describe("escrow completion endpoints", () => {
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
      createdAt: new Date(),
      fundedAt: new Date(),
    });
    store.set("wallets/c1", {
      ownerId: "client1",
      ownerRole: "client",
      currency: "KES",
      balance: 500,
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

  const complete = (jobId = "job1", auth = workerAuth()) =>
    request(app).post(`/api/escrow/${jobId}/complete`).set("Authorization", auth);
  const confirm = (jobId = "job1", auth = clientAuth()) =>
    request(app).post(`/api/escrow/${jobId}/confirm`).set("Authorization", auth);

  describe("POST /api/escrow/:jobId/complete", () => {
    test("moves the escrow to work_submitted and stamps workSubmittedAt", async () => {
      const res = await complete();

      expect(res.status).toBe(200);
      expect(res.body.escrow).toMatchObject({ jobId: "job1", status: "work_submitted" });
      expect(res.body.escrow.workSubmittedAt).toBeDefined();
      expect(store.get("escrows/job1")).toMatchObject({ status: "work_submitted" });
    });

    test("does not move any money", async () => {
      await complete();

      expect(store.get("wallets/c1")).toMatchObject({ balance: 500, escrowBalance: 500 });
      expect(store.get("wallets/w1")).toMatchObject({ balance: 100, escrowBalance: 0 });
    });

    test("returns 404 when the escrow does not exist", async () => {
      expect((await complete("missing")).status).toBe(404);
    });

    test("returns 403 for a worker who is not assigned to the job", async () => {
      const res = await complete("job1", tokenFor("worker2", "worker"));

      expect(res.status).toBe(403);
      expect(store.get("escrows/job1")).toMatchObject({ status: "in_escrow" });
    });

    test("returns 403 for a client", async () => {
      expect((await complete("job1", clientAuth())).status).toBe(403);
    });

    test("returns 409 when work was already submitted", async () => {
      await complete();

      expect((await complete()).status).toBe(409);
    });

    test("returns 401 without a token", async () => {
      expect((await request(app).post("/api/escrow/job1/complete")).status).toBe(401);
    });
  });

  describe("POST /api/escrow/:jobId/confirm", () => {
    beforeEach(async () => {
      await complete();
    });

    test("completes the escrow and stamps completedAt", async () => {
      const res = await confirm();

      expect(res.status).toBe(200);
      expect(res.body.escrow).toMatchObject({ jobId: "job1", status: "completed" });
      expect(res.body.escrow.completedAt).toBeDefined();
      expect(store.get("escrows/job1")).toMatchObject({ status: "completed" });
    });

    test("releases the escrowed amount from the client to the worker", async () => {
      await confirm();

      expect(store.get("wallets/c1")).toMatchObject({ balance: 500, escrowBalance: 0 });
      expect(store.get("wallets/w1")).toMatchObject({ balance: 600, escrowBalance: 0 });
    });

    test("records the release in the transactions collection", async () => {
      await confirm();

      expect(store.get("transactions/release-job1")).toMatchObject({
        jobId: "job1",
        type: "escrow_release",
        amount: 500,
        currency: "KES",
        fromUserId: "client1",
        toUserId: "worker1",
      });
      expect(store.get("transactions/release-job1")!.createdAt).toBeDefined();
    });

    test("returns 409 and moves no money when the wallet currencies differ", async () => {
      store.set("wallets/w1", { ...store.get("wallets/w1")!, currency: "USD" });

      const res = await confirm();

      expect(res.status).toBe(409);
      expect(store.get("escrows/job1")).toMatchObject({ status: "work_submitted" });
      expect(store.get("wallets/c1")).toMatchObject({ balance: 500, escrowBalance: 500 });
      expect(store.get("wallets/w1")).toMatchObject({ balance: 100 });
      expect(store.has("transactions/release-job1")).toBe(false);
    });

    test("returns 409 and moves no money when the worker has not submitted work", async () => {
      store.set("escrows/job2", { ...store.get("escrows/job1")!, jobId: "job2", status: "in_escrow" });

      const res = await confirm("job2");

      expect(res.status).toBe(409);
      expect(store.get("wallets/c1")).toMatchObject({ balance: 500, escrowBalance: 500 });
      expect(store.get("wallets/w1")).toMatchObject({ balance: 100 });
    });

    test("returns 409 and pays only once when confirmed twice", async () => {
      await confirm();
      const res = await confirm();

      expect(res.status).toBe(409);
      expect(store.get("wallets/w1")).toMatchObject({ balance: 600 });
      expect([...store.keys()].filter((k) => k.startsWith("transactions/"))).toHaveLength(1);
    });

    test("returns 404 when the escrow does not exist", async () => {
      expect((await confirm("missing")).status).toBe(404);
    });

    test("returns 403 for a client who does not own the job", async () => {
      const res = await confirm("job1", tokenFor("client2", "client"));

      expect(res.status).toBe(403);
      expect(store.get("escrows/job1")).toMatchObject({ status: "work_submitted" });
    });

    test("returns 403 for a worker", async () => {
      expect((await confirm("job1", workerAuth())).status).toBe(403);
    });

    test("returns 404 and leaves the escrow untouched when the worker wallet is missing", async () => {
      store.delete("wallets/w1");

      const res = await confirm();

      expect(res.status).toBe(404);
      expect(store.get("escrows/job1")).toMatchObject({ status: "work_submitted" });
      expect(store.get("wallets/c1")).toMatchObject({ escrowBalance: 500 });
    });

    test("returns 401 without a token", async () => {
      expect((await request(app).post("/api/escrow/job1/confirm")).status).toBe(401);
    });
  });
});
