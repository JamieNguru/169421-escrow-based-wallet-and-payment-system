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
        update: (ref: { path: string }, data: Record<string, any>) =>
          writes.push([ref.path, { ...store.get(ref.path), ...data }]),
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
    store.set("jobs/job1", { clientId: "client1", title: "Logo", budget: 1000, currency: "KES", status: "open" });
    store.set("jobs/job2", { clientId: "client1", title: "Website", budget: 1000, currency: "KES", status: "funded" });
    store.set("workers/worker1", { name: "Wanjiru" });
    store.set("kyc/worker1", { status: "verified" });
  });

  const apply = (jobId = "job1", payload: unknown = { price: 800, deliveryHours: 24 }, auth = tokenFor("worker1", "worker")) => {
    const req = request(app).post(`/api/jobs/${jobId}/apply`).set("Authorization", auth);
    return req.send(payload as object);
  };

  test("creates a pending application for the calling worker", async () => {
    const res = await apply("job1", { price: 800, deliveryHours: 24, message: "  I can do this  " });

    expect(res.status).toBe(201);
    expect(res.body.application).toMatchObject({
      id: "job1_worker1",
      jobId: "job1",
      workerId: "worker1",
      price: 800,
      currency: "KES",
      message: "I can do this",
      status: "pending",
    });
    expect(store.get("applications/job1_worker1")).toMatchObject({
      jobId: "job1",
      workerId: "worker1",
      price: 800,
      deliveryHours: 24,
      currency: "KES",
      message: "I can do this",
      status: "pending",
    });
    expect(store.get("applications/job1_worker1")!.createdAt).toBeDefined();
  });

  test("copies the job's currency onto the quote, not from the request", async () => {
    store.set("jobs/job3", { clientId: "client1", title: "Mural", budget: 50, currency: "USD", status: "open" });
    const res = await apply("job3", { price: 40, deliveryHours: 24, currency: "KES" });

    expect(res.status).toBe(201);
    expect(store.get("applications/job3_worker1")).toMatchObject({ price: 40, currency: "USD" });
  });

  test("works without a message", async () => {
    const res = await apply("job1");

    expect(res.status).toBe(201);
    expect(res.body.application).toMatchObject({ jobId: "job1", workerId: "worker1", status: "pending" });
    expect(res.body.application.message).toBeUndefined();
    expect(store.get("applications/job1_worker1")).not.toHaveProperty("message");
  });

  test.each([
    ["non-string message", { price: 800, deliveryHours: 24, message: 42 }],
    ["message over 1000 characters", { price: 800, deliveryHours: 24, message: "x".repeat(1001) }],
    ["missing price", { deliveryHours: 24, message: "hi" }],
    ["missing delivery time", { price: 800 }],
    ["zero delivery time", { price: 800, deliveryHours: 0 }],
    ["delivery time over 30 days", { price: 800, deliveryHours: 721 }],
    ["string delivery time", { price: 800, deliveryHours: "24" }],
    ["zero price", { price: 0, deliveryHours: 24 }],
    ["negative price", { price: -5, deliveryHours: 24 }],
    ["string price", { price: "800", deliveryHours: 24 }],
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
    const res = await apply("job1", { price: 800, deliveryHours: 24 }, tokenFor("someone", role));

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

  test.each([
    ["has not submitted KYC", undefined],
    ["was rejected", { status: "rejected" }],
  ])("returns 403 when the worker %s", async (_name, kyc) => {
    if (kyc) store.set("kyc/worker1", kyc);
    else store.delete("kyc/worker1");

    const res = await apply("job1");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/verify your identity/i);
    expect(store.has("applications/job1_worker1")).toBe(false);
  });

  test("returns 404 when the worker record does not exist", async () => {
    const res = await apply("job1", { price: 800, deliveryHours: 24 }, tokenFor("worker2", "worker"));

    expect(res.status).toBe(404);
    expect(store.has("applications/job1_worker2")).toBe(false);
  });

  test("returns 409 on a duplicate application and keeps the original", async () => {
    await apply("job1", { price: 800, deliveryHours: 24, message: "first" });
    const res = await apply("job1", { price: 500, deliveryHours: 24, message: "second" });

    expect(res.status).toBe(409);
    expect(store.get("applications/job1_worker1")).toMatchObject({ price: 800, message: "first" });
  });

  test("lets different workers apply to the same job", async () => {
    store.set("workers/worker2", { name: "Otieno" });
    store.set("kyc/worker2", { status: "verified" });

    const first = await apply("job1");
    const second = await apply("job1", { price: 800, deliveryHours: 24 }, tokenFor("worker2", "worker"));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(store.has("applications/job1_worker2")).toBe(true);
  });

  describe("PATCH /api/jobs/:jobId/application", () => {
    const edit = (payload: unknown, jobId = "job1", auth = tokenFor("worker1", "worker")) =>
      request(app).patch(`/api/jobs/${jobId}/application`).set("Authorization", auth).send(payload as object);

    beforeEach(() => {
      store.set("applications/job1_worker1", {
        jobId: "job1",
        workerId: "worker1",
        price: 800,
        currency: "KES",
        status: "pending",
        createdAt: new Date(),
      });
    });

    test("changes the price while the application is pending and the job is open", async () => {
      const res = await edit({ price: 650, message: "Better offer" });

      expect(res.status).toBe(200);
      expect(res.body.application).toMatchObject({ price: 650, message: "Better offer", status: "pending" });
      expect(store.get("applications/job1_worker1")).toMatchObject({ price: 650, currency: "KES" });
    });

    test.each([
      ["nothing to change", {}],
      ["zero price", { price: 0 }],
      ["string price", { price: "650" }],
    ])("rejects %s with 400", async (_name, payload) => {
      const res = await edit(payload);

      expect(res.status).toBe(400);
      expect(store.get("applications/job1_worker1")).toMatchObject({ price: 800 });
    });

    test("409 once the application is no longer pending", async () => {
      store.set("applications/job1_worker1", { ...store.get("applications/job1_worker1"), status: "selected" });
      const res = await edit({ price: 650 });

      expect(res.status).toBe(409);
      expect(store.get("applications/job1_worker1")).toMatchObject({ price: 800 });
    });

    test("409 when the job is no longer open", async () => {
      store.set("jobs/job1", { ...store.get("jobs/job1"), status: "assigned" });
      const res = await edit({ price: 650 });

      expect(res.status).toBe(409);
    });

    test("404 when the worker has not applied", async () => {
      const res = await edit({ price: 650 }, "job1", tokenFor("worker2", "worker"));

      expect(res.status).toBe(404);
    });

    test("403 for a client", async () => {
      const res = await edit({ price: 650 }, "job1", tokenFor("client1", "client"));

      expect(res.status).toBe(403);
    });
  });
});
