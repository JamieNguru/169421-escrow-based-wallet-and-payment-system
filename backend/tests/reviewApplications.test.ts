import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";
import { clearTrustCache } from "../src/services/applicationService";

// Minimal in-memory stand-in for the Firestore calls listJobApplications makes.
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
      return {
        ...build([], null, Infinity),
        doc: (id: string) => ({
          get: async () => ({
            exists: store.has(`${name}/${id}`),
            id,
            data: () => store.get(`${name}/${id}`),
          }),
        }),
      };
    },
  }),
}));

const tokenFor = (sub: string, role: "client" | "worker" | "admin") =>
  `Bearer ${signToken({ sub, role })}`;

const at = (minute: number) => new Date(Date.UTC(2026, 9, 12, 8, minute));

const application = (jobId: string, workerId: string, minute: number, message?: string) => {
  store.set(`applications/${jobId}_${workerId}`, {
    jobId,
    workerId,
    ...(message ? { message } : {}),
    status: "pending",
    createdAt: at(minute),
  });
};

const fetchMock = jest.fn();
const scored = (trust_level: string) =>
  Promise.resolve({ ok: true, status: 200, json: async () => ({ trust_level, probabilities: { [trust_level]: 1 } }) });

describe("GET /api/jobs/:jobId/applications", () => {
  const app = createApp();
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    store.clear();
    clearTrustCache();
    fetchMock.mockReset().mockImplementation(() => scored("High"));
    global.fetch = fetchMock as unknown as typeof fetch;
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    store.set("jobs/job1", { clientId: "client1", title: "Job 1", status: "open", createdAt: at(0) });
    store.set("jobs/job2", { clientId: "client1", title: "Job 2", status: "open", createdAt: at(0) });
    for (const id of ["w1", "w2", "w3"]) {
      // trustStats stands in for enough history to be scored by the model.
      store.set(`workers/${id}`, { name: `Worker ${id}`, email: `${id}@example.com`, passwordHash: "secret-hash", trustStats: {} });
    }
    application("job1", "w1", 1, "I can start tomorrow");
    application("job1", "w2", 2);
    application("job1", "w3", 3);
    application("job2", "w1", 4);
  });

  afterEach(() => errorSpy.mockRestore());

  const review = (jobId = "job1", query = "", auth: string | null = tokenFor("client1", "client")) => {
    const req = request(app).get(`/api/jobs/${jobId}/applications${query}`);
    return auth ? req.set("Authorization", auth) : req;
  };

  const ids = (res: request.Response) => res.body.applications.map((a: { id: string }) => a.id);

  test("returns the job's applications newest first with applicant details", async () => {
    const res = await review();

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual(["job1_w3", "job1_w2", "job1_w1"]);
    expect(res.body.applications[2]).toMatchObject({
      jobId: "job1",
      workerId: "w1",
      message: "I can start tomorrow",
      status: "pending",
      worker: { id: "w1", name: "Worker w1", email: "w1@example.com", trustLevel: "High" },
    });
    expect(res.body.nextCursor).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain("secret-hash");
  });

  test("returns an empty list for a job with no applications", async () => {
    store.set("jobs/job3", { clientId: "client1", title: "Job 3", status: "open", createdAt: at(0) });

    const res = await review("job3");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ applications: [], nextCursor: null });
  });

  test("pages with limit and cursor", async () => {
    const first = await review("job1", "?limit=2");

    expect(ids(first)).toEqual(["job1_w3", "job1_w2"]);
    expect(first.body.nextCursor).toBe(first.body.applications[1].createdAt);

    const second = await review("job1", `?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`);

    expect(ids(second)).toEqual(["job1_w1"]);
    expect(second.body.nextCursor).toBeNull();
  });

  test.each([
    ["limit 0", "?limit=0", "limit must be at least 1"],
    ["limit over 100", "?limit=101", "limit must be at most 100"],
    ["non-numeric limit", "?limit=abc", "limit must be a number"],
    ["bad cursor", "?cursor=yesterday", "cursor must be an ISO date-time"],
  ])("rejects %s with 400", async (_name, query, message) => {
    const res = await review("job1", query);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain(message);
  });

  test("rejects a missing token with 401", async () => {
    const res = await review("job1", "", null);

    expect(res.status).toBe(401);
  });

  test.each(["worker", "admin"] as const)("rejects a %s with 403", async (role) => {
    const res = await review("job1", "", tokenFor("user1", role));

    expect(res.status).toBe(403);
  });

  test("rejects a client who does not own the job with 403", async () => {
    const res = await review("job1", "", tokenFor("client2", "client"));

    expect(res.status).toBe(403);
  });

  test("returns 404 for an unknown job", async () => {
    const res = await review("nope");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Job not found");
  });

  test("scores each worker once and reuses the result on the next load", async () => {
    await review();
    await review();

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("leaves the trust level out when the scoring service is down", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError("fetch failed")));

    const res = await review();

    expect(res.status).toBe(200);
    expect(res.body.applications).toHaveLength(3);
    expect(res.body.applications[0].worker).not.toHaveProperty("trustLevel");
  });

  test("shows a worker with no settled jobs as New, without asking the model", async () => {
    store.set("workers/w1", { name: "Worker w1", email: "w1@example.com" });

    const res = await review();

    expect(res.status).toBe(200);
    const byWorker = (id: string) => res.body.applications.find((a: any) => a.workerId === id).worker;
    expect(byWorker("w1").trustLevel).toBe("New");
    expect(byWorker("w2").trustLevel).toBe("High");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

