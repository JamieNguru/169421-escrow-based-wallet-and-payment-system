import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";

// Minimal in-memory stand-in for the Firestore calls applyToJob makes.
const store = new Map<string, Record<string, any>>();

const refFor = (name: string, id: string) => ({ id, path: `${name}/${id}` });

jest.mock("../src/config/firebase", () => ({
  getDb: () => ({
    collection: (name: string) => ({
      doc: (id: string) => refFor(name, id),
    }),
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => {
      const writes: Array<[string, Record<string, any>]> = [];
      const result = await fn({
        get: async (target: { path: string }) => {
          const data = store.get(target.path);
          return { exists: data !== undefined, data: () => data };
        },
        set: (ref: { path: string }, data: Record<string, any>) => writes.push([ref.path, data]),
      });
      writes.forEach(([path, data]) => store.set(path, data));
      return result;
    },
  }),
}));

const tokenFor = (sub: string, role: "client" | "worker" | "admin") =>
  `Bearer ${signToken({ sub, role })}`;

describe("POST /api/jobs/:jobId/apply", () => {
  const app = createApp();

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    store.clear();
    store.set("jobs/job1", { clientId: "client1", title: "Logo", status: "open" });
    store.set("jobs/job2", { clientId: "client1", title: "Website", status: "funded" });
    store.set("workers/worker1", { name: "Wanjiru" });
  });

  const apply = (jobId = "job1", payload?: unknown, auth = tokenFor("worker1", "worker")) => {
    const req = request(app).post(`/api/jobs/${jobId}/apply`).set("Authorization", auth);
    return payload === undefined ? req : req.send(payload as object);
  };

  test("creates a pending application for the calling worker", async () => {
    const res = await apply("job1", { message: "  I can do this  " });

    expect(res.status).toBe(201);
    expect(res.body.application).toMatchObject({
      id: "job1_worker1",
      jobId: "job1",
      workerId: "worker1",
      message: "I can do this",
      status: "pending",
    });
    expect(store.get("applications/job1_worker1")).toMatchObject({
      jobId: "job1",
      workerId: "worker1",
      message: "I can do this",
      status: "pending",
    });
    expect(store.get("applications/job1_worker1")!.createdAt).toBeDefined();
  });

  test("works without a message", async () => {
    const res = await apply("job1");

    expect(res.status).toBe(201);
    expect(res.body.application).toMatchObject({ jobId: "job1", workerId: "worker1", status: "pending" });
    expect(res.body.application.message).toBeUndefined();
    expect(store.get("applications/job1_worker1")).not.toHaveProperty("message");
  });

  test.each([
    ["non-string message", { message: 42 }],
    ["message over 1000 characters", { message: "x".repeat(1001) }],
  ])("rejects %s with 400", async (_name, payload) => {
    const res = await apply("job1", payload);

    expect(res.status).toBe(400);
    expect(store.has("applications/job1_worker1")).toBe(false);
  });

  test("rejects a request without a token with 401", async () => {
    const res = await request(app).post("/api/jobs/job1/apply");

    expect(res.status).toBe(401);
  });

  test.each(["client", "admin"] as const)("rejects a %s with 403", async (role) => {
    const res = await apply("job1", undefined, tokenFor("someone", role));

    expect(res.status).toBe(403);
    expect(store.has("applications/job1_someone")).toBe(false);
  });

  test("returns 404 for an unknown job", async () => {
    const res = await apply("ghost");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Job not found");
  });

  test("returns 409 when the job is no longer open", async () => {
    const res = await apply("job2");

    expect(res.status).toBe(409);
    expect(store.has("applications/job2_worker1")).toBe(false);
  });

  test("returns 404 when the worker record does not exist", async () => {
    const res = await apply("job1", undefined, tokenFor("worker2", "worker"));

    expect(res.status).toBe(404);
    expect(store.has("applications/job1_worker2")).toBe(false);
  });

  test("returns 409 on a duplicate application and keeps the original", async () => {
    await apply("job1", { message: "first" });
    const res = await apply("job1", { message: "second" });

    expect(res.status).toBe(409);
    expect(store.get("applications/job1_worker1")).toMatchObject({ message: "first" });
  });

  test("lets different workers apply to the same job", async () => {
    store.set("workers/worker2", { name: "Otieno" });

    const first = await apply("job1");
    const second = await apply("job1", undefined, tokenFor("worker2", "worker"));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(store.has("applications/job1_worker2")).toBe(true);
  });
});
