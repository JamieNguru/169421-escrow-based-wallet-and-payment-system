import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";

// Minimal in-memory stand-in for the Firestore query calls listTransactions makes.
const store = new Map<string, Record<string, any>>();

jest.mock("../src/config/firebase", () => ({
  getDb: () => ({
    collection: (name: string) => {
      const build = (filters: Array<[string, string, any]>, order: "asc" | "desc" | null, max: number) => ({
        where: (field: string, op: string, value: unknown) => build([...filters, [field, op, value]], order, max),
        orderBy: (_field: string, dir: "asc" | "desc" = "asc") => build(filters, dir, max),
        limit: (n: number) => build(filters, order, n),
        get: async () => {
          let docs = [...store.entries()]
            .filter(([path]) => path.startsWith(`${name}/`))
            .map(([path, data]) => ({ id: path.split("/")[1], data: () => data }))
            .filter(({ data }) =>
              filters.every(([field, op, value]) =>
                op === "==" ? data()[field] === value : data()[field] < value,
              ),
            );
          if (order) {
            const sign = order === "desc" ? -1 : 1;
            docs = docs.sort((a, b) => sign * (a.data().createdAt - b.data().createdAt));
          }
          return { empty: docs.length === 0, docs: docs.slice(0, max) };
        },
      });
      return build([], null, Infinity);
    },
  }),
}));

const tokenFor = (sub: string, role: "client" | "worker" | "admin") =>
  `Bearer ${signToken({ sub, role })}`;

const tx = (id: string, minute: number, from: string, to: string, type = "escrow_release") => {
  store.set(`transactions/${id}`, {
    jobId: id,
    type,
    amount: 500,
    currency: "KES",
    fromUserId: from,
    toUserId: to,
    createdAt: new Date(Date.UTC(2026, 9, 12, 8, minute)),
  });
};

describe("GET /api/transactions", () => {
  const app = createApp();

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    store.clear();
    tx("fund-job1", 1, "client1", "worker1", "escrow_fund");
    tx("release-job1", 2, "client1", "worker1");
    tx("fund-job2", 3, "client1", "worker2", "escrow_fund");
    tx("release-job9", 4, "client2", "worker2");
  });

  const list = (query = "", auth = tokenFor("client1", "client")) =>
    request(app).get(`/api/transactions${query}`).set("Authorization", auth);

  test("returns the caller's transactions newest first", async () => {
    const res = await list();

    expect(res.status).toBe(200);
    expect(res.body.transactions.map((t: any) => t.id)).toEqual(["fund-job2", "release-job1", "fund-job1"]);
    expect(res.body.transactions[0]).toMatchObject({
      type: "escrow_fund",
      amount: 500,
      currency: "KES",
      fromUserId: "client1",
      toUserId: "worker2",
    });
    expect(res.body.nextCursor).toBeNull();
  });

  test("includes transactions where the caller is the payee", async () => {
    const res = await list("", tokenFor("worker1", "worker"));

    expect(res.body.transactions.map((t: any) => t.id)).toEqual(["release-job1", "fund-job1"]);
  });

  test("never includes other users' transactions", async () => {
    const res = await list("", tokenFor("client2", "client"));

    expect(res.body.transactions.map((t: any) => t.id)).toEqual(["release-job9"]);
  });

  test("returns an empty list for a user with no history", async () => {
    const res = await list("", tokenFor("nobody", "client"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ transactions: [], nextCursor: null });
  });

  test("respects limit and returns a cursor for the next page", async () => {
    const first = await list("?limit=2");

    expect(first.body.transactions.map((t: any) => t.id)).toEqual(["fund-job2", "release-job1"]);
    expect(first.body.nextCursor).toBe(first.body.transactions[1].createdAt);

    const second = await list(`?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`);

    expect(second.body.transactions.map((t: any) => t.id)).toEqual(["fund-job1"]);
    expect(second.body.nextCursor).toBeNull();
  });

  test("a transaction between two users in the same query is not duplicated", async () => {
    tx("self", 5, "client1", "client1");
    const res = await list();

    expect(res.body.transactions.filter((t: any) => t.id === "self")).toHaveLength(1);
  });

  test.each(["0", "101", "abc", "1.5"])("rejects limit=%s with 400", async (limit) => {
    expect((await list(`?limit=${limit}`)).status).toBe(400);
  });

  test("rejects an invalid cursor with 400", async () => {
    expect((await list("?cursor=yesterday")).status).toBe(400);
  });

  test("rejects a request without a token with 401", async () => {
    expect((await request(app).get("/api/transactions")).status).toBe(401);
  });

  test("lets an admin view another user's history with userId", async () => {
    const res = await list("?userId=worker1", tokenFor("admin1", "admin"));

    expect(res.status).toBe(200);
    expect(res.body.transactions.map((t: any) => t.id)).toEqual(["release-job1", "fund-job1"]);
  });

  test("an admin without userId sees their own (empty) history", async () => {
    const res = await list("", tokenFor("admin1", "admin"));

    expect(res.body.transactions).toEqual([]);
  });

  test("rejects userId from a non-admin with 403", async () => {
    const res = await list("?userId=worker1");

    expect(res.status).toBe(403);
  });
});
