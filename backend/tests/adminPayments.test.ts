import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";

const store = new Map<string, Record<string, any>>();

jest.mock("../src/config/firebase", () => ({
  getDb: () => ({
    collection: (name: string) => {
      const build = (filters: Array<[string, string, any]>, max: number) => ({
        where: (field: string, op: string, value: unknown) => build([...filters, [field, op, value]], max),
        orderBy: () => build(filters, max),
        limit: (n: number) => build(filters, n),
        get: async () => {
          const docs = [...store.entries()]
            .filter(([path]) => path.startsWith(`${name}/`))
            .map(([path, data]) => ({ id: path.split("/")[1], data: () => data }))
            .filter(({ data }) =>
              filters.every(([field, op, value]) => (op === "==" ? data()[field] === value : data()[field] < value)),
            )
            .sort((a, b) => b.data().createdAt - a.data().createdAt);
          return { empty: docs.length === 0, docs: docs.slice(0, max) };
        },
      });
      return {
        ...build([], Infinity),
        doc: (id: string) => ({
          get: async () => {
            const data = store.get(`${name}/${id}`);
            return { exists: data !== undefined, data: () => data };
          },
        }),
      };
    },
  }),
}));

const tokenFor = (sub: string, role: "client" | "worker" | "admin") =>
  `Bearer ${signToken({ sub, role })}`;

const at = (minute: number) => new Date(Date.UTC(2026, 9, 12, 8, minute));

describe("GET /api/admin/payments", () => {
  const app = createApp();

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    store.clear();
    store.set("clients/c1", { name: "David" });
    store.set("workers/w1", { name: "Evans" });
    store.set("payments/p1", { jobId: "job1", clientId: "c1", workerId: "w1", amount: 3500, currency: "KES", phone: "254712345678", status: "completed", createdAt: at(1) });
    store.set("payments/p2", { jobId: "job2", clientId: "c1", workerId: "w1", amount: 9000, currency: "KES", phone: "254712345678", status: "failed", failureReason: "Request cancelled by user", createdAt: at(3) });
    store.set("withdrawals/x1", { workerId: "w1", amount: 6000, currency: "KES", phone: "254700000000", status: "completed", createdAt: at(2) });
  });

  const list = (query = "", auth = tokenFor("a1", "admin")) =>
    request(app).get(`/api/admin/payments${query}`).set("Authorization", auth);

  test("merges STK pushes and withdrawals newest first with user names", async () => {
    const res = await list();

    expect(res.status).toBe(200);
    expect(res.body.payments.map((p: any) => p.id)).toEqual(["p2", "x1", "p1"]);
    expect(res.body.payments[0]).toMatchObject({
      kind: "payment", status: "failed", userName: "David", failureReason: "Request cancelled by user",
    });
    expect(res.body.payments[1]).toMatchObject({ kind: "withdrawal", userId: "w1", userName: "Evans", amount: 6000 });
    expect(res.body.nextCursor).toBeNull();
  });

  test("filters by status", async () => {
    const res = await list("?status=failed");

    expect(res.body.payments.map((p: any) => p.id)).toEqual(["p2"]);
  });

  test("limits the page and returns a cursor", async () => {
    const res = await list("?limit=2");

    expect(res.body.payments.map((p: any) => p.id)).toEqual(["p2", "x1"]);
    expect(res.body.nextCursor).toBe(at(2).toISOString());
  });

  test("400 for an invalid status", async () => {
    expect((await list("?status=bogus")).status).toBe(400);
  });

  test("403 for non-admins", async () => {
    expect((await list("", tokenFor("w1", "worker"))).status).toBe(403);
  });
});
