import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";

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

describe("trust score endpoints", () => {
  const app = createApp();
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    delete process.env.ML_SERVICE_URL;
    store.clear();
    store.set("workers/w1", { name: "Joe" });
    store.set("clients/c1", { name: "Jane", trustStats: { refund_rate: 0.5 } });
    fetchMock.mockReset().mockImplementation(() => flaskOk());
    global.fetch = fetchMock as unknown as typeof fetch;
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => errorSpy.mockRestore());

  const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body);

  it("returns a worker's own score using default features", async () => {
    const res = await request(app).get("/api/trust-score/me").set("Authorization", tokenFor("w1", "worker"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      userId: "w1",
      role: "worker",
      trustLevel: "High",
      probabilities: { High: 0.9, Low: 0.1 },
    });
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:5000/score");
    expect(sentBody()).toEqual({
      role: "worker",
      features: { job_completion_rate: 0.8, dispute_rate: 0.1, response_time_hours: 24 },
    });
  });

  it("lets stored trustStats override defaults for a client", async () => {
    const res = await request(app).get("/api/trust-score/me").set("Authorization", tokenFor("c1", "client"));

    expect(res.status).toBe(200);
    expect(sentBody()).toEqual({
      role: "client",
      features: { payment_completion_rate: 0.9, refund_rate: 0.5, escrow_release_time_hours: 24 },
    });
  });

  it("uses ML_SERVICE_URL when set", async () => {
    process.env.ML_SERVICE_URL = "http://ml.internal:9000/";
    await request(app).get("/api/trust-score/me").set("Authorization", tokenFor("w1", "worker"));
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
    const res = await request(app)
      .get("/api/trust-score/w1?role=worker")
      .set("Authorization", tokenFor("a1", "admin"));

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe("w1");
    expect(sentBody().role).toBe("worker");
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
    fetchMock.mockImplementation(impl);
    const res = await request(app).get("/api/trust-score/me").set("Authorization", tokenFor("w1", "worker"));
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("trust scoring unavailable");
  });
});
