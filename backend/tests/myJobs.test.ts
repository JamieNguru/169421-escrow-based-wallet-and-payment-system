import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";

const store = new Map<string, Record<string, any>>();

jest.mock("../src/config/firebase", () => ({
  getDb: () => ({
    collection: (name: string) => {
      const build = (filters: Array<[string, any]>, max: number) => ({
        where: (field: string, _op: string, value: unknown) => build([...filters, [field, value]], max),
        orderBy: () => build(filters, max),
        limit: (n: number) => build(filters, n),
        get: async () => {
          const docs = [...store.entries()]
            .filter(([path]) => path.startsWith(`${name}/`))
            .map(([path, data]) => ({ id: path.split("/")[1], data: () => data }))
            .filter(({ data }) => filters.every(([field, value]) => data()[field] === value))
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

const job = (id: string, minute: number, overrides: Record<string, any> = {}) =>
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

describe("GET /api/jobs/mine", () => {
  const app = createApp();

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    store.clear();
    store.set("clients/client1", { name: "David" });
    store.set("workers/worker1", { name: "Grace A." });
    job("job1", 1);
    job("job2", 2, { status: "assigned", workerId: "worker1" });
    job("job3", 3, { clientId: "client2" });
    store.set("applications/job1_w1", { jobId: "job1", workerId: "w1" });
    store.set("applications/job1_w2", { jobId: "job1", workerId: "w2" });
    store.set("escrows/job2", { status: "in_escrow", clientId: "client1", workerId: "worker1" });
  });

  const mine = (auth: string) => request(app).get("/api/jobs/mine").set("Authorization", auth);

  test("a client sees only their jobs, newest first, with applicants, worker and escrow status", async () => {
    const res = await mine(tokenFor("client1", "client"));

    expect(res.status).toBe(200);
    expect(res.body.jobs.map((j: any) => j.id)).toEqual(["job2", "job1"]);
    expect(res.body.jobs[0]).toMatchObject({ escrowStatus: "in_escrow", counterpartyName: "Grace A." });
    expect(res.body.jobs[1]).toMatchObject({ applicantCount: 2 });
    expect(res.body.jobs[1].escrowStatus).toBeUndefined();
  });

  test("a worker sees jobs assigned to them with the client's name", async () => {
    const res = await mine(tokenFor("worker1", "worker"));

    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0]).toMatchObject({ id: "job2", counterpartyName: "David", escrowStatus: "in_escrow" });
  });

  test("403 for admins", async () => {
    expect((await mine(tokenFor("admin1", "admin"))).status).toBe(403);
  });

  test("401 without a token", async () => {
    expect((await request(app).get("/api/jobs/mine")).status).toBe(401);
  });
});
