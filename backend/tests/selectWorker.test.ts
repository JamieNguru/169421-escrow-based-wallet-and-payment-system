import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";

// Minimal in-memory stand-in for the Firestore calls selectWorker makes.
const store = new Map<string, Record<string, any>>();

const refFor = (name: string, id: string) => ({ id, path: `${name}/${id}` });

jest.mock("../src/config/firebase", () => ({
  getDb: () => ({
    collection: (name: string) => {
      const query = (filters: Array<[string, any]>) => ({
        isQuery: true,
        where: (field: string, _op: string, value: unknown) => query([...filters, [field, value]]),
        run: () =>
          [...store.entries()]
            .filter(([path]) => path.startsWith(`${name}/`))
            .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
            .map(([path, data]) => ({ id: path.split("/")[1], ref: { path }, data: () => data })),
      });
      return { ...query([]), doc: (id: string) => refFor(name, id) };
    },
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => {
      const writes: Array<[string, Record<string, any>]> = [];
      const result = await fn({
        get: async (target: { path?: string; isQuery?: boolean; run?: () => any[] }) => {
          if (target.isQuery) return { docs: target.run!() };
          const data = store.get(target.path!);
          return { exists: data !== undefined, data: () => data };
        },
        update: (ref: { path: string }, changes: Record<string, any>) =>
          writes.push([ref.path, { ...store.get(ref.path), ...changes }]),
      });
      writes.forEach(([path, data]) => store.set(path, data));
      return result;
    },
  }),
}));

const tokenFor = (sub: string, role: "client" | "worker" | "admin") =>
  `Bearer ${signToken({ sub, role })}`;

const application = (jobId: string, workerId: string) => {
  store.set(`applications/${jobId}_${workerId}`, {
    jobId,
    workerId,
    price: workerId === "w2" ? 700 : 900,
    deliveryHours: workerId === "w2" ? 48 : 12,
    currency: "KES",
    status: "pending",
    createdAt: new Date(Date.UTC(2026, 9, 12, 8, 0)),
  });
};

describe("POST /api/jobs/:jobId/select", () => {
  const app = createApp();

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    store.clear();
    store.set("jobs/job1", { clientId: "client1", title: "Logo", status: "open" });
    store.set("jobs/job2", { clientId: "client1", title: "Website", status: "assigned", workerId: "w9" });
    for (const id of ["w1", "w2", "w3"]) application("job1", id);
    application("job2", "w1");
  });

  const select = (
    jobId = "job1",
    payload: unknown = { workerId: "w2" },
    auth: string | null = tokenFor("client1", "client"),
  ) => {
    const req = request(app).post(`/api/jobs/${jobId}/select`);
    const authed = auth ? req.set("Authorization", auth) : req;
    return payload === undefined ? authed : authed.send(payload as object);
  };

  test("assigns the job, selects the chosen applicant and rejects the rest", async () => {
    const res = await select();

    expect(res.status).toBe(200);
    expect(res.body.job).toMatchObject({ id: "job1", status: "assigned", workerId: "w2" });
    expect(res.body.application).toMatchObject({ id: "job1_w2", workerId: "w2", status: "selected" });
    expect(store.get("jobs/job1")).toMatchObject({ status: "assigned", workerId: "w2" });
    expect(store.get("applications/job1_w2")!.status).toBe("selected");
    expect(store.get("applications/job1_w1")!.status).toBe("rejected");
    expect(store.get("applications/job1_w3")!.status).toBe("rejected");
  });

  test("copies the chosen quote onto the job as the locked price", async () => {
    const res = await select();

    expect(res.body.job).toMatchObject({ agreedPrice: 700, agreedCurrency: "KES" });
    expect(store.get("jobs/job1")).toMatchObject({ agreedPrice: 700, agreedCurrency: "KES" });
  });

  test("copies the chosen quote's delivery promise onto the job", async () => {
    const res = await select();

    expect(res.body.job).toMatchObject({ agreedDeliveryHours: 48 });
    expect(store.get("jobs/job1")).toMatchObject({ agreedDeliveryHours: 48 });
  });

  test("an application from before quotes existed leaves the job on its budget", async () => {
    store.set("applications/job1_w2", { jobId: "job1", workerId: "w2", status: "pending", createdAt: new Date() });
    const res = await select();

    expect(res.status).toBe(200);
    expect(store.get("jobs/job1")).not.toHaveProperty("agreedPrice");
  });

  test("leaves other jobs' applications alone", async () => {
    await select();

    expect(store.get("applications/job2_w1")!.status).toBe("pending");
  });

  test.each([
    ["missing workerId", {}],
    ["empty workerId", { workerId: "" }],
    ["non-string workerId", { workerId: 42 }],
  ])("rejects %s with 400", async (_name, payload) => {
    const res = await select("job1", payload);

    expect(res.status).toBe(400);
    expect(store.get("jobs/job1")!.status).toBe("open");
  });

  test("rejects a missing token with 401", async () => {
    const res = await select("job1", undefined, null);

    expect(res.status).toBe(401);
  });

  test.each(["worker", "admin"] as const)("rejects a %s with 403", async (role) => {
    const res = await select("job1", { workerId: "w2" }, tokenFor("user1", role));

    expect(res.status).toBe(403);
    expect(store.get("jobs/job1")!.status).toBe("open");
  });

  test("rejects a client who does not own the job with 403", async () => {
    const res = await select("job1", { workerId: "w2" }, tokenFor("client2", "client"));

    expect(res.status).toBe(403);
    expect(store.get("jobs/job1")!.status).toBe("open");
  });

  test("returns 404 for an unknown job", async () => {
    const res = await select("ghost");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Job not found");
  });

  test("returns 404 for a worker who did not apply", async () => {
    const res = await select("job1", { workerId: "stranger" });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Application not found");
    expect(store.get("jobs/job1")!.status).toBe("open");
  });

  test("returns 409 when the job already has a worker", async () => {
    const res = await select("job2", { workerId: "w1" });

    expect(res.status).toBe(409);
    expect(store.get("jobs/job2")).toMatchObject({ status: "assigned", workerId: "w9" });
    expect(store.get("applications/job2_w1")!.status).toBe("pending");
  });
});
