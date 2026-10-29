import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";
import { buildStatement, detectFlags, type EscrowRecord } from "../src/services/complianceService";

jest.mock("../src/middleware/requireTerms", () => ({
  requireTerms: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const store = new Map<string, Record<string, any>>();

jest.mock("../src/config/firebase", () => ({
  getDb: () => ({
    collection: (name: string) => {
      const rows = (filter: (data: Record<string, any>) => boolean = () => true) =>
        [...store.entries()]
          .filter(([path, data]) => path.startsWith(`${name}/`) && filter(data))
          .map(([path, data]) => ({ id: path.split("/")[1], data: () => data }));
      return {
        get: async () => ({ docs: rows() }),
        where: (field: string, _op: string, value: unknown) => ({
          get: async () => ({ docs: rows((data) => data[field] === value) }),
        }),
        doc: (id: string) => ({
          id,
          get: async () => ({ exists: store.has(`${name}/${id}`), data: () => store.get(`${name}/${id}`) }),
          update: async (data: Record<string, any>) => store.set(`${name}/${id}`, { ...store.get(`${name}/${id}`), ...data }),
        }),
      };
    },
  }),
}));

const tokenFor = (sub: string, role: "client" | "worker" | "admin") => `Bearer ${signToken({ sub, role })}`;
const at = (iso: string) => new Date(iso);

describe("buildStatement", () => {
  const entry = (id: string, type: string, from: string, to: string, amount: number, iso: string, jobId?: string) => ({
    id,
    type,
    amount,
    fromUserId: from,
    toUserId: to,
    createdAt: at(iso),
    ...(jobId && { jobId }),
  });

  it("totals a worker's payouts and withdrawals by month, and ignores other years", () => {
    const statement = buildStatement(
      "worker",
      2026,
      [
        entry("1", "escrow_release", "c1", "w1", 1000, "2026-01-10T10:00:00Z", "j1"),
        entry("2", "escrow_release", "c1", "w1", 500, "2026-01-20T10:00:00Z", "j2"),
        entry("3", "escrow_release", "c1", "w1", 700, "2026-03-05T10:00:00Z", "j3"),
        entry("4", "withdrawal", "w1", "mpesa", 900, "2026-03-06T10:00:00Z"),
        entry("5", "withdrawal_reversal", "mpesa", "w1", 200, "2026-03-07T10:00:00Z"),
        entry("6", "escrow_release", "c1", "w1", 9999, "2025-12-31T10:00:00Z", "old"),
      ],
      "w1",
    );

    expect(statement.months[0]).toMatchObject({ month: 1, received: 1500, jobs: 2 });
    expect(statement.months[2]).toMatchObject({ month: 3, received: 700, withdrawn: 700, jobs: 1 });
    expect(statement.totals).toEqual({ received: 2200, withdrawn: 700, jobs: 3 });
  });

  it("follows Kenyan time: 22:00 UTC on 31 Dec is already January", () => {
    const statement = buildStatement(
      "worker",
      2027,
      [entry("1", "escrow_release", "c1", "w1", 100, "2026-12-31T22:00:00Z", "j1")],
      "w1",
    );

    expect(statement.totals.received).toBe(100);
    expect(statement.months[0].received).toBe(100);
  });

  it("totals a client's payments and refunds", () => {
    const statement = buildStatement(
      "client",
      2026,
      [
        entry("1", "escrow_fund", "c1", "w1", 1000, "2026-02-01T10:00:00Z", "j1"),
        entry("2", "escrow_fund", "c1", "w1", 600, "2026-02-02T10:00:00Z", "j2"),
        entry("3", "escrow_refund", "c1", "c1", 300, "2026-02-09T10:00:00Z", "j2"),
        entry("4", "wallet_topup", "mpesa", "c1", 5000, "2026-02-01T09:00:00Z"),
      ],
      "c1",
    );

    expect(statement.totals).toEqual({ paid: 1600, refunded: 300, jobs: 2 });
  });
});

describe("detectFlags", () => {
  const names = {
    clients: new Map([["c1", "Carol"]]),
    workers: new Map([
      ["w1", "Wanjiku"],
      ["w2", "Wafula"],
    ]),
  };
  const escrow = (n: number, over: Partial<EscrowRecord> = {}): EscrowRecord => ({
    jobId: `j${n}`,
    clientId: "c1",
    workerId: "w1",
    amount: 9500,
    status: "completed",
    fundedAt: at("2026-06-01T08:00:00Z"),
    ...over,
  });
  const now = at("2026-10-29T08:00:00Z");
  const run = (escrows: EscrowRecord[], taxPinWorkerIds: string[] = []) =>
    detectFlags({ escrows, names, taxPinWorkerIds: new Set(taxPinWorkerIds), now });

  it("flags many just-under-the-limit jobs between the same two people in a short time", () => {
    const jobs = Array.from({ length: 6 }, (_, i) => escrow(i, { fundedAt: at(`2026-06-0${i + 1}T08:00:00Z`) }));

    const flags = run(jobs, ["w1"]);

    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      type: "possible_splitting",
      subject: { id: "w1", name: "Wanjiku" },
      counterparty: { id: "c1", name: "Carol" },
      jobCount: 6,
      amount: 57_000,
    });
  });

  it("does not flag the same jobs spread over months, or jobs at or over the per-job limit", () => {
    const spread = Array.from({ length: 6 }, (_, i) => escrow(i, { fundedAt: at(`2026-0${i + 1}-01T08:00:00Z`) }));
    const large = Array.from({ length: 6 }, (_, i) =>
      escrow(i, { amount: 10_000, fundedAt: at(`2026-06-0${i + 1}T08:00:00Z`) }),
    );

    expect(run(spread, ["w1"]).filter((f) => f.type === "possible_splitting")).toEqual([]);
    expect(run(large, ["w1"]).filter((f) => f.type === "possible_splitting")).toEqual([]);
  });

  it("flags repeated refunds after the work was delivered, but not refunds before it", () => {
    const delivered = [1, 2].map((n) =>
      escrow(n, { status: "refunded", amount: 2000, workSubmittedAt: at("2026-06-02T08:00:00Z") }),
    );
    const undelivered = [3, 4].map((n) => escrow(n, { status: "refunded", amount: 2000 }));

    expect(run(delivered)[0]).toMatchObject({ type: "refund_after_delivery", jobCount: 2, amount: 4000 });
    expect(run(undelivered)).toEqual([]);
  });

  it("flags a worker over the yearly limit with no tax PIN, counting a split by the worker's share only", () => {
    const jobs = [
      escrow(1, { amount: 60_000, fundedAt: at("2026-02-01T08:00:00Z") }),
      escrow(2, { amount: 80_000, status: "split", workerAmount: 40_000, fundedAt: at("2026-04-01T08:00:00Z") }),
      escrow(3, { amount: 50_000, workerId: "w2", fundedAt: at("2026-05-01T08:00:00Z") }),
      escrow(4, { amount: 500_000, fundedAt: at("2025-05-01T08:00:00Z") }), // last year: not counted
    ];

    const flags = run(jobs);

    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ type: "no_tax_pin", subject: { id: "w1" }, jobCount: 2, amount: 100_000 });
    expect(run(jobs, ["w1"])).toEqual([]);
  });
});

describe("compliance endpoints", () => {
  const app = createApp();

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    store.clear();
  });

  it("returns a worker's statement for a year, with their tax PIN masked", async () => {
    const year = new Date().getUTCFullYear();
    store.set("kyc/w1", { status: "verified", taxPin: "A123456789Z" });
    store.set("transactions/release-j1", {
      jobId: "j1",
      type: "escrow_release",
      amount: 1200,
      fromUserId: "c1",
      toUserId: "w1",
      createdAt: new Date(Date.UTC(year, 5, 15, 12)),
    });

    const res = await request(app).get(`/api/wallet/statement?year=${year}`).set("Authorization", tokenFor("w1", "worker"));

    expect(res.status).toBe(200);
    expect(res.body.statement).toMatchObject({ year, role: "worker", totals: { received: 1200, jobs: 1 } });
    expect(res.body.statement.tax).toEqual({ taxPin: "A*********Z", thresholdKes: 100_000 });
  });

  it("rejects a bad year and an admin asking for a statement", async () => {
    const bad = await request(app).get("/api/wallet/statement?year=abc").set("Authorization", tokenFor("w1", "worker"));
    const admin = await request(app).get("/api/wallet/statement").set("Authorization", tokenFor("a1", "admin"));

    expect(bad.status).toBe(400);
    expect(admin.status).toBe(403);
  });

  it("lets only an admin read the flags", async () => {
    const worker = await request(app).get("/api/admin/compliance").set("Authorization", tokenFor("w1", "worker"));
    expect(worker.status).toBe(403);

    const res = await request(app).get("/api/admin/compliance").set("Authorization", tokenFor("a1", "admin"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ flags: [], thresholdKes: 100_000 });
  });

  describe("adding a tax PIN", () => {
    const add = (body: unknown, who = "w1") =>
      request(app).post("/api/kyc/tax-pin").set("Authorization", tokenFor(who, "worker")).send(body as object);

    it("stores it on a verified record and returns it masked", async () => {
      store.set("kyc/w1", {
        status: "verified",
        fullName: "Wanjiku",
        idType: "national_id",
        idNumber: "12345678",
        submittedAt: new Date(),
      });

      const res = await add({ taxPin: " a123456789z " });

      expect(res.status).toBe(200);
      expect(res.body.kyc.taxPin).toBe("A*********Z");
      expect(store.get("kyc/w1")!.taxPin).toBe("A123456789Z");
    });

    it("refuses a malformed PIN and a worker who is not verified", async () => {
      store.set("kyc/w1", { status: "verified", idNumber: "12345678", submittedAt: new Date() });
      store.set("kyc/w2", { status: "rejected", idNumber: "12345678", submittedAt: new Date() });

      expect((await add({ taxPin: "123" })).status).toBe(400);
      expect((await add({})).status).toBe(400);
      expect((await add({ taxPin: "A123456789Z" }, "w2")).status).toBe(409);
      expect((await add({ taxPin: "A123456789Z" }, "nobody")).status).toBe(409);
    });
  });
});
