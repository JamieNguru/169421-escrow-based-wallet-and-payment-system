import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";

// Minimal in-memory stand-in for the Firestore query calls listOpenJobs makes.
const store = new Map<string, Record<string, any>>();

jest.mock("../src/config/firebase", () => ({
  getDb: () => ({
    collection: (name: string) => {
      const doc = (id: string) => ({
        get: async () => {
          const data = store.get(`${name}/${id}`);
          return { exists: data !== undefined, data: () => data };
        },
      });
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
      return { ...build([], null, Infinity), doc };
    },
  }),
}));

const tokenFor = (sub: string, role: "client" | "worker" | "admin") =>
  `Bearer ${signToken({ sub, role })}`;

const job = (id: string, minute: number, overrides: Record<string, any> = {}) => {
  store.set(`jobs/${id}`, {
    clientId: "client1",
    title: `Job ${id}`,
    description: "Details",
    budget: 1000,
    currency: "KES",
    status: "open",
    createdAt: new Date(Date.UTC(2026, 9, 12, 8, minute)),
    ...overrides,
  });
};

describe("GET /api/jobs", () => {
  const app = createApp();

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    store.clear();
    job("job1", 1);
    job("job2", 2, { currency: "USD" });
    job("job3", 3, { status: "funded" });
    job("job4", 4);
  });

  const browse = (query = "", auth: string | null = tokenFor("worker1", "worker")) => {
    const req = request(app).get(`/api/jobs${query}`);
    return auth ? req.set("Authorization", auth) : req;
  };

  test("returns open jobs newest first, skipping other statuses", async () => {
    const res = await browse();

    expect(res.status).toBe(200);
    expect(res.body.jobs.map((j: { id: string }) => j.id)).toEqual(["job4", "job2", "job1"]);
    expect(res.body.jobs[0]).toMatchObject({ clientId: "client1", title: "Job job4", status: "open" });
    expect(res.body.nextCursor).toBeNull();
  });

  test("returns the calling worker's own quote on each job they applied to", async () => {
    store.set("applications/job2_worker1", { price: 40, currency: "USD", message: "Hi", status: "pending" });
    store.set("applications/job1_worker2", { price: 10, currency: "KES", status: "pending" });
    const res = await browse();

    const byId = Object.fromEntries(res.body.jobs.map((j: { id: string }) => [j.id, j]));
    expect(byId.job2.myApplication).toEqual({ price: 40, currency: "USD", message: "Hi", status: "pending" });
    expect(byId.job1.myApplication).toBeUndefined();
    expect(byId.job4.myApplication).toBeUndefined();
  });

  test("filters by currency, case-insensitively", async () => {
    const res = await browse("?currency=usd");

    expect(res.status).toBe(200);
    expect(res.body.jobs.map((j: { id: string }) => j.id)).toEqual(["job2"]);
  });

  test("pages with limit and cursor", async () => {
    const first = await browse("?limit=2");

    expect(first.body.jobs.map((j: { id: string }) => j.id)).toEqual(["job4", "job2"]);
    expect(first.body.nextCursor).toBe(first.body.jobs[1].createdAt);

    const second = await browse(`?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`);

    expect(second.body.jobs.map((j: { id: string }) => j.id)).toEqual(["job1"]);
    expect(second.body.nextCursor).toBeNull();
  });

  test.each([
    ["limit 0", "?limit=0", "limit must be at least 1"],
    ["limit over 100", "?limit=101", "limit must be at most 100"],
    ["non-numeric limit", "?limit=abc", "limit must be a number"],
    ["bad cursor", "?cursor=yesterday", "cursor must be an ISO date-time"],
    ["unsupported currency", "?currency=EUR", "currency must be one of"],
  ])("rejects %s with 400", async (_name, query, message) => {
    const res = await browse(query);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain(message);
  });

  test("rejects a missing token with 401", async () => {
    const res = await browse("", null);

    expect(res.status).toBe(401);
  });

  test.each(["client", "admin"] as const)("rejects a %s with 403", async (role) => {
    const res = await browse("", tokenFor("user1", role));

    expect(res.status).toBe(403);
  });
});
