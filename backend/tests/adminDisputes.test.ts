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

describe("GET /api/admin/disputes", () => {
  const app = createApp();

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    store.clear();
    store.set("clients/c1", { name: "Mary W." });
    store.set("workers/w1", { name: "Peter N." });
    store.set("jobs/job1", { title: "Plumbing repair" });
    store.set("jobs/job2", { title: "House painting" });
    store.set("disputes/job1", {
      jobId: "job1", clientId: "c1", workerId: "w1", amount: 12000, currency: "KES",
      raisedByRole: "client", reason: "The leak came back", status: "open", createdAt: at(1),
    });
    store.set("disputes/job2", {
      jobId: "job2", clientId: "c1", workerId: "w1", amount: 20000, currency: "KES",
      raisedByRole: "client", reason: "Half done", status: "resolved", createdAt: at(2),
    });
  });

  const list = (query = "", auth = tokenFor("a1", "admin")) =>
    request(app).get(`/api/admin/disputes${query}`).set("Authorization", auth);

  test("lists disputes newest first with job title and party names", async () => {
    const res = await list();

    expect(res.status).toBe(200);
    expect(res.body.disputes.map((d: any) => d.jobId)).toEqual(["job2", "job1"]);
    expect(res.body.disputes[1]).toMatchObject({
      jobTitle: "Plumbing repair", clientName: "Mary W.", workerName: "Peter N.", amount: 12000, reason: "The leak came back",
    });
    expect(res.body.nextCursor).toBeNull();
  });

  test("filters by status", async () => {
    const res = await list("?status=open");

    expect(res.body.disputes.map((d: any) => d.jobId)).toEqual(["job1"]);
  });

  test("pages with limit and cursor", async () => {
    const first = await list("?limit=1");
    expect(first.body.disputes.map((d: any) => d.jobId)).toEqual(["job2"]);
    expect(first.body.nextCursor).toBe(at(2).toISOString());

    const second = await list(`?limit=1&cursor=${first.body.nextCursor}`);
    expect(second.body.disputes.map((d: any) => d.jobId)).toEqual(["job1"]);
  });

  test("400 for an invalid status", async () => {
    expect((await list("?status=bogus")).status).toBe(400);
  });

  test("403 for non-admins", async () => {
    expect((await list("", tokenFor("c1", "client"))).status).toBe(403);
  });

  describe("with photos", () => {
    const photo = "data:image/png;base64,iVBORw0KGgo=";

    beforeEach(() => {
      store.set("disputes/job1", { ...store.get("disputes/job1")!, photos: [photo, photo] });
    });

    test("the list carries only the photo count", async () => {
      const res = await list("?status=open");

      expect(res.body.disputes[0].photoCount).toBe(2);
      expect(res.body.disputes[0]).not.toHaveProperty("photos");
    });

    test("the detail returns the photos with names and job title", async () => {
      const res = await request(app).get("/api/admin/disputes/job1").set("Authorization", tokenFor("a1", "admin"));

      expect(res.status).toBe(200);
      expect(res.body.dispute).toMatchObject({
        jobId: "job1",
        jobTitle: "Plumbing repair",
        clientName: "Mary W.",
        workerName: "Peter N.",
        photoCount: 2,
        photos: [photo, photo],
      });
    });

    test("detail is 404 for an unknown dispute and 403 for non-admins", async () => {
      const missing = await request(app).get("/api/admin/disputes/nope").set("Authorization", tokenFor("a1", "admin"));
      const client = await request(app).get("/api/admin/disputes/job1").set("Authorization", tokenFor("c1", "client"));

      expect(missing.status).toBe(404);
      expect(client.status).toBe(403);
    });
  });
});

