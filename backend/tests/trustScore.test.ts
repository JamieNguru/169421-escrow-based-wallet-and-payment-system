import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";
import { MIN_FINISHED_JOBS } from "../src/services/trustScoreService";

const store = new Map<string, Record<string, any>>();

jest.mock("../src/config/firebase", () => ({
  getDb: () => ({
    collection: (name: string) => ({
      doc: (id: string) => ({
        id,
        get: async () => {
          const data = store.get(`${name}/${id}`);
          return { exists: data !== undefined, data: () => data };
        },
      }),
      where: (field: string, _op: string, value: unknown) => ({
        get: async () => ({
          docs: [...store.entries()]
            .filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value)
            .map(([path, data]) => ({ id: path.split("/")[1], data: () => data })),
        }),
      }),
    }),
  }),
}));

const fetchMock = jest.fn();
const flaskOk = (trust_level = "High") =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({ role: "x", trust_level, probabilities: { High: 0.9, Low: 0.1 } }),
  });

const tokenFor = (sub: string, role: "client" | "worker" | "admin") =>
  `Bearer ${signToken({ sub, role })}`;

const hoursAfter = (base: Date, hours: number) => new Date(base.getTime() + hours * 3_600_000);
const T0 = new Date(Date.UTC(2026, 9, 1, 8, 0));

// An escrow in a given state; funded at T0, work submitted `submitHours` later,
// released `releaseHours` after that.
const escrow = (id: string, status: string, who: { clientId?: string; workerId?: string }, submitHours = 10, releaseHours = 4) =>
  store.set(`escrows/${id}`, {
    jobId: id,
    clientId: "c1",
    workerId: "w1",
    amount: 500,
    currency: "KES",
    status,
    fundedAt: T0,
    workSubmittedAt: hoursAfter(T0, submitHours),
    ...(status === "completed" && { completedAt: hoursAfter(T0, submitHours + releaseHours) }),
    ...who,
  });

describe("trust score endpoints", () => {
  const app = createApp();
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    delete process.env.ML_SERVICE_URL;
    store.clear();
    store.set("workers/w1", { name: "Joe" });
    store.set("clients/c1", { name: "Jane" });
    fetchMock.mockReset().mockImplementation(() => flaskOk());
    global.fetch = fetchMock as unknown as typeof fetch;
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => errorSpy.mockRestore());

  const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body);
  const me = (id: string, role: "client" | "worker") =>
    request(app).get("/api/trust-score/me").set("Authorization", tokenFor(id, role));

  // A worker with enough history to be scored by the model.
  const seasonedWorker = () => {
    escrow("j1", "completed", {}, 8);
    escrow("j2", "completed", {}, 10);
    escrow("j3", "refunded", {}, 12);
    escrow("j4", "in_escrow", {}, 20); // still open: counts as a job, not as settled
    // Delivery times the worker promised: 8h, 8h, 10h and 10h.
    [8, 8, 10, 10].forEach((hours, i) =>
      store.set(`jobs/j${i + 1}`, { workerId: "w1", clientId: "c1", agreedDeliveryHours: hours }),
    );
  };

  describe("a user with little history", () => {
    it.each([
      ["a brand-new worker", "w1", "worker", 0],
      ["a brand-new client", "c1", "client", 0],
    ] as const)("%s is New, and the model is not asked", async (_label, id, role, finished) => {
      const res = await me(id, role);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        userId: id,
        role,
        trustLevel: "New",
        probabilities: {},
        finishedJobs: finished,
        jobsNeeded: MIN_FINISHED_JOBS,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("stays New until enough jobs are settled, and says how many are left", async () => {
      escrow("j1", "completed", {});
      escrow("j2", "refunded", {});
      escrow("j3", "in_escrow", {}); // not settled yet

      const res = await me("w1", "worker");

      expect(res.body).toMatchObject({ trustLevel: "New", finishedJobs: 2, jobsNeeded: MIN_FINISHED_JOBS - 2 });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("ignores other people's jobs", async () => {
      for (const id of ["a", "b", "c"]) escrow(id, "completed", { workerId: "someone-else" });

      expect((await me("w1", "worker")).body.trustLevel).toBe("New");
    });
  });

  describe("a worker with enough history", () => {
    it("is scored from their real jobs", async () => {
      seasonedWorker();
      store.set("disputes/j3", { jobId: "j3", workerId: "w1", clientId: "c1", raisedByRole: "client" });

      const res = await me("w1", "worker");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ userId: "w1", role: "worker", trustLevel: "High", probabilities: { High: 0.9, Low: 0.1 } });
      // The inputs and the settled-job count come back so the score can be explained.
      expect(res.body.finishedJobs).toBe(3);
      expect(res.body.features).toEqual(sentBody().features);
      expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:5000/score");
      const { role, features } = sentBody();
      expect(role).toBe("worker");
      // 2 of 3 settled jobs paid out; 1 dispute over 4 funded jobs; jobs submitted after 8, 10, 12 and 20 hours.
      expect(features.job_completion_rate).toBeCloseTo(2 / 3, 5);
      expect(features.dispute_rate).toBeCloseTo(1 / 4, 5);
      // Delivered after 8, 10, 12 and 20 hours against promises of 8, 8, 10 and 10: 0%, 25%, 20% and 100% over.
      expect(features.delivery_overrun).toBeCloseTo((0 + 0.25 + 0.2 + 1) / 4, 5);
      expect(features).not.toHaveProperty("response_time_hours");
    });

    it("counts a split payout as completed work", async () => {
      escrow("j1", "split", {});
      escrow("j2", "completed", {});
      escrow("j3", "completed", {});

      await me("w1", "worker");

      expect(sentBody().features.job_completion_rate).toBe(1);
    });
  });

  describe("a client with enough history", () => {
    it("is scored from their real payments, refund requests and disputes", async () => {
      escrow("j1", "completed", {}, 10, 2);
      escrow("j2", "completed", {}, 10, 6);
      escrow("j3", "refunded", {});
      store.set("refundRequests/j3", { jobId: "j3", clientId: "c1" });
      store.set("disputes/j2", { jobId: "j2", clientId: "c1", workerId: "w1", raisedByRole: "client" });
      // A dispute the worker raised against them is not held against the client's refund habits.
      store.set("disputes/j1", { jobId: "j1", clientId: "c1", workerId: "w1", raisedByRole: "worker" });

      const res = await me("c1", "client");

      expect(res.body.trustLevel).toBe("High");
      const { role, features } = sentBody();
      expect(role).toBe("client");
      expect(features.payment_completion_rate).toBeCloseTo(2 / 3, 5);
      expect(features.refund_rate).toBeCloseTo(2 / 3, 5); // 1 refund request + 1 dispute they raised, over 3 jobs
      expect(features.escrow_release_time_hours).toBeCloseTo((2 + 6) / 2, 5);
    });
  });

  it("does not penalise a worker whose jobs carry no delivery promise", async () => {
    escrow("j1", "completed", {}, 40);
    escrow("j2", "completed", {}, 40);
    escrow("j3", "completed", {}, 40);

    await me("w1", "worker");

    expect(sentBody().features.delivery_overrun).toBe(0);
  });

  it("lets stored trustStats stand in for history (demo accounts)", async () => {
    store.set("clients/c1", { name: "Jane", trustStats: { refund_rate: 0.5 } });

    const res = await me("c1", "client");

    expect(res.status).toBe(200);
    expect(res.body.trustLevel).toBe("High");
    expect(sentBody()).toEqual({
      role: "client",
      features: { payment_completion_rate: 0.99, refund_rate: 0.5, escrow_release_time_hours: 9 },
    });
  });

  it("uses ML_SERVICE_URL when set", async () => {
    process.env.ML_SERVICE_URL = "http://ml.internal:9000/";
    seasonedWorker();

    await me("w1", "worker");

    expect(fetchMock.mock.calls[0][0]).toBe("http://ml.internal:9000/score");
  });

  it("returns 401 without a token", async () => {
    expect((await request(app).get("/api/trust-score/me")).status).toBe(401);
    expect((await request(app).get("/api/trust-score/w1?role=worker")).status).toBe(401);
  });

  it("returns 403 for an admin on /me and a client on /:userId", async () => {
    expect((await request(app).get("/api/trust-score/me").set("Authorization", tokenFor("a1", "admin"))).status).toBe(403);
    expect(
      (await request(app).get("/api/trust-score/w1?role=worker").set("Authorization", tokenFor("c1", "client"))).status,
    ).toBe(403);
  });

  it("lets an admin look up a user by id and role", async () => {
    seasonedWorker();

    const res = await request(app)
      .get("/api/trust-score/w1?role=worker")
      .set("Authorization", tokenFor("a1", "admin"));

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe("w1");
    expect(sentBody().role).toBe("worker");
  });

  it("shows an admin a new user as New too", async () => {
    const res = await request(app)
      .get("/api/trust-score/w1?role=worker")
      .set("Authorization", tokenFor("a1", "admin"));

    expect(res.body).toMatchObject({ userId: "w1", trustLevel: "New" });
  });

  it("returns 400 for a missing or invalid role query", async () => {
    const auth = tokenFor("a1", "admin");
    expect((await request(app).get("/api/trust-score/w1").set("Authorization", auth)).status).toBe(400);
    const res = await request(app).get("/api/trust-score/w1?role=admin").set("Authorization", auth);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("role must be client or worker");
  });

  it("returns 404 for an unknown user", async () => {
    const res = await request(app)
      .get("/api/trust-score/nobody?role=client")
      .set("Authorization", tokenFor("a1", "admin"));
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["the request fails", () => Promise.reject(new TypeError("fetch failed"))],
    ["the request times out", () => Promise.reject(new DOMException("timed out", "TimeoutError"))],
    ["Flask responds 500", () => Promise.resolve({ ok: false, status: 500, json: async () => ({}) })],
    ["Flask returns an unexpected body", () => Promise.resolve({ ok: true, status: 200, json: async () => ({}) })],
  ])("returns 503 when %s", async (_name, impl) => {
    seasonedWorker();
    fetchMock.mockImplementation(impl);

    const res = await me("w1", "worker");

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("trust scoring unavailable");
  });
});
