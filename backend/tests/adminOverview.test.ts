import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";

// In-memory stand-in for the Firestore calls the overview and trust score make.
const store = new Map<string, Record<string, any>>();

jest.mock("../src/config/firebase", () => ({
  getDb: () => ({
    collection: (name: string) => ({
      get: async () => ({
        docs: [...store.entries()]
          .filter(([path]) => path.startsWith(`${name}/`))
          .map(([path, data]) => ({ id: path.split("/")[1], data: () => data })),
      }),
      doc: (id: string) => ({
        id,
        get: async () => {
          const data = store.get(`${name}/${id}`);
          return { exists: data !== undefined, data: () => data };
        },
      }),
    }),
  }),
}));

const fetchMock = jest.fn();
const flask = (trust_level: string) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({ trust_level, probabilities: { [trust_level]: 1 } }),
  });

const tokenFor = (sub: string, role: "client" | "worker" | "admin") =>
  `Bearer ${signToken({ sub, role })}`;

describe("GET /api/admin/overview", () => {
  const app = createApp();
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    delete process.env.ML_SERVICE_URL;
    store.clear();
    fetchMock.mockReset().mockImplementation(() => flask("High"));
    global.fetch = fetchMock as unknown as typeof fetch;
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => errorSpy.mockRestore());

  const get = (auth?: string) => {
    const req = request(app).get("/api/admin/overview");
    return auth ? req.set("Authorization", auth) : req;
  };

  test("aggregates jobs, escrows, payments, withdrawals, disputes and refund requests", async () => {
    store.set("jobs/j1", { status: "open" });
    store.set("jobs/j2", { status: "assigned" });
    store.set("jobs/j3", { status: "assigned" });
    store.set("escrows/j2", { status: "in_escrow", amount: 100, currency: "KES" });
    store.set("escrows/j3", { status: "disputed", amount: 50, currency: "KES" });
    store.set("escrows/j4", { status: "completed", amount: 200, currency: "KES" });
    store.set("escrows/j5", { status: "refunded", amount: 30, currency: "USD" });
    store.set("payments/p1", { status: "pending" });
    store.set("payments/p2", { status: "completed" });
    store.set("withdrawals/x1", { status: "failed" });
    store.set("disputes/j3", { status: "open" });
    store.set("disputes/j6", { status: "resolved" });
    store.set("refundRequests/j5", { status: "approved" });
    store.set("refundRequests/j7", { status: "pending" });

    const res = await get(tokenFor("a1", "admin"));

    expect(res.status).toBe(200);
    expect(res.body.jobs).toEqual({ total: 3, byStatus: { open: 1, assigned: 2 } });
    expect(res.body.escrows).toEqual({
      total: 4,
      byStatus: { in_escrow: 1, disputed: 1, completed: 1, refunded: 1 },
      amounts: { held: { KES: 150 }, released: { KES: 200 }, refunded: { USD: 30 } },
    });
    expect(res.body.payments).toEqual({ total: 2, byStatus: { pending: 1, completed: 1 } });
    expect(res.body.withdrawals).toEqual({ total: 1, byStatus: { failed: 1 } });
    expect(res.body.disputes).toEqual({ total: 2, open: 1, resolved: 1 });
    expect(res.body.refundRequests).toEqual({ total: 2, pending: 1, approved: 1 });
  });

  test("counts trust levels per role and reports failed scoring as unavailable", async () => {
    // trustStats stands in for enough history to be scored by the model.
    store.set("clients/c1", { name: "Carol", trustStats: {} });
    store.set("clients/c2", { name: "Chege", trustStats: {} });
    store.set("workers/w1", { name: "Wanjiku", trustStats: {} });
    fetchMock.mockImplementation((_url: string, init: { body: string }) => {
      const { role } = JSON.parse(init.body);
      return role === "worker" ? Promise.reject(new TypeError("fetch failed")) : flask("High");
    });

    const res = await get(tokenFor("a1", "admin"));

    expect(res.status).toBe(200);
    expect(res.body.trust).toEqual({
      scored: 2,
      unavailable: 1,
      byLevel: { client: { High: 2 }, worker: {} },
      lowTrustUsers: [],
    });
  });

  test("returns zeros for an empty platform", async () => {
    const res = await get(tokenFor("a1", "admin"));

    expect(res.status).toBe(200);
    expect(res.body.jobs).toEqual({ total: 0, byStatus: {} });
    expect(res.body.disputes).toEqual({ total: 0, open: 0, resolved: 0 });
    expect(res.body.trust).toEqual({
      scored: 0,
      unavailable: 0,
      byLevel: { client: {}, worker: {} },
      lowTrustUsers: [],
    });
    expect(res.body.activity).toEqual({ paymentsToday: 0, failedPaymentsToday: 0, activeUsers: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("requires authentication", async () => {
    expect((await get()).status).toBe(401);
  });

  test.each(["client", "worker"] as const)("rejects a %s with 403", async (role) => {
    expect((await get(tokenFor("u1", role))).status).toBe(403);
  });

  test("reports today's payments, failures and active users, and lists low-trust users", async () => {
    store.set("clients/c1", { name: "Kevin", status: "active", trustStats: {} });
    store.set("clients/c2", { name: "Mary", status: "suspended", trustStats: {} });
    store.set("workers/w1", { name: "James", trustStats: {} });
    store.set("payments/p1", { status: "failed", createdAt: new Date() });
    store.set("payments/p2", { status: "completed", createdAt: new Date() });
    store.set("payments/p3", { status: "completed", createdAt: new Date("2020-01-01T00:00:00Z") });
    fetchMock.mockImplementation((_url: string, init: { body: string }) => {
      const { role } = JSON.parse(init.body);
      return flask(role === "worker" ? "Low" : "High");
    });

    const res = await get(tokenFor("a1", "admin"));

    expect(res.status).toBe(200);
    expect(res.body.activity).toEqual({ paymentsToday: 2, failedPaymentsToday: 1, activeUsers: 2 });
    expect(res.body.trust.lowTrustUsers).toEqual([{ id: "w1", role: "worker", name: "James" }]);
  });

  test("counts a split escrow's worker share as released and client share as refunded", async () => {
    store.set("escrows/e1", { status: "completed", amount: 100, currency: "KES" });
    store.set("escrows/e2", { status: "refunded", amount: 50, currency: "KES" });
    store.set("escrows/e3", { status: "split", amount: 500, currency: "KES", clientAmount: 200, workerAmount: 300 });

    const res = await get(tokenFor("a1", "admin"));

    expect(res.body.escrows.amounts.released).toEqual({ KES: 400 });
    expect(res.body.escrows.amounts.refunded).toEqual({ KES: 250 });
    expect(res.body.escrows.amounts.held).toEqual({});
  });
});

