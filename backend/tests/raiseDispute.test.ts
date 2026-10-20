import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";

// Minimal in-memory stand-in for the Firestore calls raiseDispute makes.
const store = new Map<string, Record<string, any>>();

const refFor = (name: string, id: string) => ({ id, path: `${name}/${id}` });

jest.mock("../src/config/firebase", () => ({
  getDb: () => ({
    collection: (name: string) => ({
      doc: (id: string) => refFor(name, id),
    }),
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => {
      const writes: Array<[string, Record<string, any>, boolean]> = [];
      const result = await fn({
        get: async (ref: { path: string }) => {
          const data = store.get(ref.path);
          return { exists: data !== undefined, data: () => data };
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

describe("POST /api/escrow/:jobId/dispute", () => {
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

  const raise = (body: unknown = { reason: "Work does not match the brief" }, jobId = "job1", auth = clientAuth()) =>
    request(app).post(`/api/escrow/${jobId}/dispute`).set("Authorization", auth).send(body as object);

  test.each([
    ["client", clientAuth, "client1"],
    ["worker", workerAuth, "worker1"],
  ] as const)("a %s can dispute an in_escrow or work_submitted escrow", async (role, auth, userId) => {
    for (const status of ["in_escrow", "work_submitted"]) {
      seedEscrow("job1", status);

      const res = await raise(undefined, "job1", auth());

      expect(res.status).toBe(201);
      expect(res.body.dispute).toMatchObject({
        jobId: "job1",
        clientId: "client1",
        workerId: "worker1",
        amount: 500,
        currency: "KES",
        raisedBy: userId,
        raisedByRole: role,
        reason: "Work does not match the brief",
        previousStatus: status,
        status: "open",
      });
      expect(store.get("disputes/job1")).toMatchObject({ raisedByRole: role, previousStatus: status });
      expect(store.get("escrows/job1")).toMatchObject({ status: "disputed" });
      expect(store.get("escrows/job1")!.disputedAt).toBeDefined();
      store.delete("disputes/job1");
    }
  });

  test("changes no wallet or ledger entry", async () => {
    await raise();

    expect(store.get("wallets/c1")).toMatchObject({ balance: 0, escrowBalance: 500 });
    expect([...store.keys()].filter((k) => k.startsWith("transactions/"))).toHaveLength(0);
  });

  test("trims the reason", async () => {
    const res = await raise({ reason: "  Not delivered  " });

    expect(res.body.dispute.reason).toBe("Not delivered");
  });

  test.each([
    ["missing", {}],
    ["empty", { reason: "   " }],
    ["not a string", { reason: 42 }],
    ["too long", { reason: "x".repeat(1001) }],
  ])("returns 400 when the reason is %s", async (_label, body) => {
    const res = await raise(body);

    expect(res.status).toBe(400);
    expect(store.has("disputes/job1")).toBe(false);
    expect(store.get("escrows/job1")).toMatchObject({ status: "in_escrow" });
  });

  test("returns 404 when the escrow does not exist", async () => {
    expect((await raise(undefined, "missing")).status).toBe(404);
  });

  test.each([
    ["a client who does not own the job", () => tokenFor("client2", "client")],
    ["a worker who is not assigned", () => tokenFor("worker2", "worker")],
    ["an admin", () => tokenFor("admin1", "admin")],
  ])("returns 403 for %s", async (_label, auth) => {
    const res = await raise(undefined, "job1", auth());

    expect(res.status).toBe(403);
    expect(store.has("disputes/job1")).toBe(false);
    expect(store.get("escrows/job1")).toMatchObject({ status: "in_escrow" });
  });

  test.each(["pending", "disputed", "completed", "refunded"])(
    "returns 409 for an escrow that is %s",
    async (status) => {
      seedEscrow("job1", status);

      const res = await raise();

      expect(res.status).toBe(409);
      expect(store.has("disputes/job1")).toBe(false);
    },
  );

  test("returns 409 and keeps the original when already disputed", async () => {
    await raise({ reason: "First reason" });
    const res = await raise({ reason: "Second reason" }, "job1", workerAuth());

    expect(res.status).toBe(409);
    expect(store.get("disputes/job1")).toMatchObject({ reason: "First reason", raisedByRole: "client" });
  });

  test("returns 401 without a token", async () => {
    expect((await request(app).post("/api/escrow/job1/dispute").send({ reason: "x" })).status).toBe(401);
  });

  describe("photos", () => {
    const photo = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

    test("stores evidence photos on the dispute but only returns their count", async () => {
      const res = await raise({ reason: "Gate half painted", photos: [photo, photo] });

      expect(res.status).toBe(201);
      expect(res.body.dispute.photoCount).toBe(2);
      expect(res.body.dispute).not.toHaveProperty("photos");
      expect(store.get("disputes/job1")!.photos).toEqual([photo, photo]);
    });

    test("a dispute without photos stores none", async () => {
      await raise();

      expect(store.get("disputes/job1")).not.toHaveProperty("photos");
    });

    test.each([
      ["a non-image data URL", { photos: ["data:text/html;base64,PGgxPg=="] }],
      ["a plain string", { photos: ["https://example.com/a.jpg"] }],
      ["more than three photos", { photos: [photo, photo, photo, photo] }],
      ["an oversized photo", { photos: [`data:image/png;base64,${"A".repeat(300_001)}`] }],
    ])("rejects %s with 400 and creates no dispute", async (_label, extra) => {
      const res = await raise({ reason: "Bad", ...extra });

      expect(res.status).toBe(400);
      expect(store.has("disputes/job1")).toBe(false);
      expect(store.get("escrows/job1")).toMatchObject({ status: "in_escrow" });
    });
  });
});

