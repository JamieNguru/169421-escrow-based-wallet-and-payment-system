import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";
import { maskIdNumber, runChecks } from "../src/services/kycService";

// Minimal in-memory stand-in for the Firestore calls the KYC code makes.
const store = new Map<string, Record<string, any>>();
let autoId = 0;

const refFor = (name: string, id: string) => ({
  id,
  path: `${name}/${id}`,
  get: async () => {
    const data = store.get(`${name}/${id}`);
    return { id, exists: data !== undefined, data: () => data };
  },
});

jest.mock("../src/config/firebase", () => ({
  getDb: () => ({
    collection: (name: string) => {
      const build = (filters: Array<[string, any]>, max: number) => ({
        where: (field: string, _op: string, value: unknown) => build([...filters, [field, value]], max),
        orderBy: () => build(filters, max),
        limit: (n: number) => build(filters, n),
        get: async () => ({
          docs: [...store.entries()]
            .filter(([path]) => path.startsWith(`${name}/`))
            .map(([path, data]) => ({ id: path.slice(name.length + 1), data: () => data }))
            .filter(({ data }) => filters.every(([field, value]) => data()[field] === value))
            .slice(0, max),
        }),
      });
      return {
        ...build([], Infinity),
        doc: (id: string) => refFor(name, id),
        add: async (data: Record<string, any>) => {
          store.set(`${name}/auto${++autoId}`, data);
        },
      };
    },
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

const IMG = "data:image/png;base64,iVBORw0KGgo=";

const valid = (overrides: Record<string, unknown> = {}) => ({
  fullName: "Wanjiru Kamau",
  idType: "national_id",
  idNumber: "12345678",
  dateOfBirth: "1995-04-12",
  consent: true,
  images: { front: IMG, back: IMG, selfie: IMG },
  ...overrides,
});

describe("worker KYC", () => {
  const app = createApp();

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    store.clear();
    store.set("workers/worker1", { name: "Wanjiru Kamau" });
    store.set("workers/worker2", { name: "Otieno Odhiambo" });
  });

  const submit = (payload: unknown = valid(), auth = tokenFor("worker1", "worker")) =>
    request(app).post("/api/kyc").set("Authorization", auth).send(payload as object);

  describe("POST /api/kyc", () => {
    test("verifies a worker when every check passes", async () => {
      const res = await submit();

      expect(res.status).toBe(201);
      expect(res.body.kyc).toMatchObject({ status: "verified", reasons: [], idNumber: "*****678" });
      expect(res.body.kyc.verifiedAt).toBeDefined();
      expect(store.get("kyc/worker1")).toMatchObject({ status: "verified", idNumber: "12345678", consent: true });
      expect(store.get("kycFiles/worker1")!.images.selfie).toBe(IMG);
    });

    test("keeps images out of the kyc document", async () => {
      await submit();

      expect(JSON.stringify(store.get("kyc/worker1"))).not.toContain("base64");
    });

    test("accepts a passport with the page and a selfie only", async () => {
      const res = await submit(valid({ idType: "passport", idNumber: "ab123456", images: { front: IMG, selfie: IMG } }));

      expect(res.body.kyc.status).toBe("verified");
    });

    test.each([
      ["a badly formatted ID number", { idNumber: "123" }, /7 or 8 digits/],
      ["a worker under 18", { dateOfBirth: new Date(Date.now() - 10 * 365 * 24 * 3600 * 1000).toISOString().slice(0, 10) }, /18 or older/],
      ["a name that does not match the account", { fullName: "Someone Else" }, /must match the name/],
      ["a missing national ID back", { images: { front: IMG, selfie: IMG } }, /back of the ID/],
      ["a missing selfie", { images: { front: IMG, back: IMG } }, /selfie/i],
      ["no consent", { consent: false }, /consent/i],
    ])("rejects %s with a plain reason", async (_name, overrides, reason) => {
      const res = await submit(valid(overrides));

      expect(res.status).toBe(201);
      expect(res.body.kyc.status).toBe("rejected");
      expect(res.body.kyc.reasons.join(" ")).toMatch(reason);
      expect(res.body.kyc.verifiedAt).toBeUndefined();
    });

    test("rejects an ID already registered to another account", async () => {
      store.set("workers/worker2", { name: "Wanjiru Kamau" });
      await submit();

      const res = await submit(valid(), tokenFor("worker2", "worker"));

      expect(res.body.kyc.status).toBe("rejected");
      expect(res.body.kyc.reasons).toContain("This ID is already registered to another account.");
      expect(store.get("kyc/worker2")!.status).toBe("rejected");
    });

    test("lets a rejected worker resubmit and get verified", async () => {
      expect((await submit(valid({ consent: false }))).body.kyc.status).toBe("rejected");

      const res = await submit();

      expect(res.body.kyc.status).toBe("verified");
      expect(store.get("kyc/worker1")!.status).toBe("verified");
    });

    test("does not let a rejected attempt lock the ID number", async () => {
      store.set("workers/worker2", { name: "Otieno Odhiambo" });
      await submit(valid({ consent: false }));

      const res = await submit(valid({ fullName: "Otieno Odhiambo" }), tokenFor("worker2", "worker"));

      expect(res.body.kyc.status).toBe("verified");
    });

    test("returns 409 when the worker is already verified", async () => {
      await submit();

      expect((await submit()).status).toBe(409);
    });

    test.each([
      ["unknown idType", { idType: "driving_licence" }],
      ["missing idNumber", { idNumber: undefined }],
      ["bad dateOfBirth format", { dateOfBirth: "12/04/1995" }],
      ["non-boolean consent", { consent: "yes" }],
      ["a non-image photo", { images: { front: "not-an-image" } }],
    ])("returns 400 for %s", async (_name, overrides) => {
      const res = await submit(valid(overrides));

      expect(res.status).toBe(400);
      expect(store.has("kyc/worker1")).toBe(false);
    });

    test("returns 401 without a token", async () => {
      expect((await request(app).post("/api/kyc")).status).toBe(401);
    });

    test.each(["client", "admin"] as const)("returns 403 for a %s", async (role) => {
      expect((await submit(valid(), tokenFor("someone", role))).status).toBe(403);
    });
  });

  describe("GET /api/kyc/me", () => {
    const me = (auth = tokenFor("worker1", "worker")) => request(app).get("/api/kyc/me").set("Authorization", auth);

    test("returns null before submitting", async () => {
      const res = await me();

      expect(res.status).toBe(200);
      expect(res.body.kyc).toBeNull();
    });

    test("returns the status and reasons without images or the full number", async () => {
      await submit(valid({ consent: false }));

      const res = await me();

      expect(res.body.kyc).toMatchObject({ status: "rejected", idNumber: "*****678" });
      expect(res.body.kyc.reasons.length).toBeGreaterThan(0);
      expect(JSON.stringify(res.body)).not.toContain("12345678");
      expect(JSON.stringify(res.body)).not.toContain("base64");
    });

    test("is worker only", async () => {
      expect((await me(tokenFor("client1", "client"))).status).toBe(403);
    });
  });

  describe("client view of applicants", () => {
    const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, n));

    beforeEach(() => {
      store.set("jobs/job1", { clientId: "client1", title: "Logo", status: "open", createdAt: at(0) });
      store.set("applications/job1_worker1", { jobId: "job1", workerId: "worker1", status: "pending", createdAt: at(1) });
      store.set("applications/job1_worker2", { jobId: "job1", workerId: "worker2", status: "pending", createdAt: at(2) });
      jest.spyOn(global, "fetch").mockRejectedValue(new TypeError("fetch failed"));
      jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => jest.restoreAllMocks());

    test("shows only the limited summary for a verified worker and null otherwise", async () => {
      await submit();

      const res = await request(app).get("/api/jobs/job1/applications").set("Authorization", tokenFor("client1", "client"));

      expect(res.status).toBe(200);
      const byWorker = Object.fromEntries(res.body.applications.map((a: any) => [a.workerId, a.worker.kyc]));
      expect(byWorker.worker1).toMatchObject({
        verified: true,
        name: "Wanjiru Kamau",
        idType: "national_id",
        idNumberMasked: "*****678",
      });
      expect(byWorker.worker1.verifiedAt).toBeDefined();
      expect(Object.keys(byWorker.worker1).sort()).toEqual(["idNumberMasked", "idType", "name", "verified", "verifiedAt"]);
      expect(byWorker.worker2).toBeNull();
      expect(JSON.stringify(res.body)).not.toContain("12345678");
      expect(JSON.stringify(res.body)).not.toContain("base64");
      expect(JSON.stringify(res.body)).not.toContain("1995-04-12");
    });
  });

  describe("admin access", () => {
    let admin: string;

    beforeEach(async () => {
      admin = tokenFor("admin1", "admin");
      await submit();
      store.set("disputes/job1", { jobId: "job1", clientId: "client1", workerId: "worker1", status: "open", reason: "x", createdAt: new Date() });
      store.set("jobs/job1", { title: "Logo" });
    });

    test("lists only workers who have a dispute", async () => {
      store.set("kyc/worker2", { status: "verified", fullName: "Otieno", idType: "national_id", idNumber: "87654321" });

      const res = await request(app).get("/api/admin/kyc").set("Authorization", admin);

      expect(res.status).toBe(200);
      expect(res.body.workers.map((w: any) => w.workerId)).toEqual(["worker1"]);
      expect(JSON.stringify(res.body)).not.toContain("12345678");
    });

    test("returns the full KYC with images for a disputed worker and logs the view", async () => {
      const res = await request(app).get("/api/admin/kyc/worker1").set("Authorization", admin);

      expect(res.status).toBe(200);
      expect(res.body.kyc).toMatchObject({
        workerId: "worker1",
        idNumber: "12345678",
        dateOfBirth: "1995-04-12",
        consent: true,
        images: { front: IMG, back: IMG, selfie: IMG },
      });
      const logs = [...store.entries()].filter(([path]) => path.startsWith("kycAccessLog/"));
      expect(logs).toHaveLength(1);
      expect(logs[0][1]).toMatchObject({ adminId: "admin1", workerId: "worker1" });
    });

    test("returns 403 and logs nothing for a worker with no dispute", async () => {
      store.set("kyc/worker2", { status: "verified", fullName: "Otieno", idType: "national_id", idNumber: "87654321" });

      const res = await request(app).get("/api/admin/kyc/worker2").set("Authorization", admin);

      expect(res.status).toBe(403);
      expect([...store.keys()].some((path) => path.startsWith("kycAccessLog/"))).toBe(false);
    });

    test("embeds a limited KYC summary in the dispute detail", async () => {
      const res = await request(app).get("/api/admin/disputes/job1").set("Authorization", admin);

      expect(res.status).toBe(200);
      expect(res.body.dispute.workerKyc).toMatchObject({ verified: true, idNumberMasked: "*****678" });
      expect(JSON.stringify(res.body)).not.toContain("12345678");
    });

    test("is admin only", async () => {
      for (const role of ["client", "worker"] as const) {
        const res = await request(app).get("/api/admin/kyc/worker1").set("Authorization", tokenFor("u", role));
        expect(res.status).toBe(403);
      }
    });
  });
});

describe("kyc helpers", () => {
  test("maskIdNumber keeps only the last 3 characters", () => {
    expect(maskIdNumber("12345678")).toBe("*****678");
    expect(maskIdNumber("AB1")).toBe("AB1");
  });

  test("runChecks computes age on the birthday", () => {
    const input = valid({ dateOfBirth: "2008-06-15" }) as any;
    expect(runChecks(input, "Wanjiru Kamau", false, new Date("2026-06-14T00:00:00Z"))).toContain("You must be 18 or older.");
    expect(runChecks(input, "Wanjiru Kamau", false, new Date("2026-06-15T00:00:00Z"))).toEqual([]);
  });
});
