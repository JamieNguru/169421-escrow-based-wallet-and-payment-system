import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";

// In-memory stand-in for the Firestore calls the payment service makes,
// including transactions (writes apply only if the callback finishes).
const store = new Map<string, Record<string, any>>();

const refFor = (name: string, id: string) => ({ id, path: `${name}/${id}` });

jest.mock("../src/config/firebase", () => ({
  getDb: () => ({
    collection: (name: string) => ({
      doc: (id: string) => ({
        ...refFor(name, id),
        get: async () => {
          const data = store.get(`${name}/${id}`);
          return { exists: data !== undefined, data: () => data };
        },
        set: async (data: Record<string, any>) => {
          store.set(`${name}/${id}`, data);
        },
      }),
      where: (field: string, _op: string, value: unknown) => {
        const query = { name, field, value, limit: () => query };
        return query;
      },
    }),
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => {
      const writes: Array<[string, Record<string, any>, boolean]> = [];
      const result = await fn({
        get: async (target: any) => {
          if (target.path) {
            const data = store.get(target.path);
            return { exists: data !== undefined, data: () => data };
          }
          const docs = [...store.entries()]
            .filter(([path, data]) => path.startsWith(`${target.name}/`) && data[target.field] === target.value)
            .map(([path, data]) => ({
              id: path.split("/")[1],
              ref: refFor(target.name, path.split("/")[1]),
              data: () => data,
            }));
          return { empty: docs.length === 0, docs };
        },
        set: (ref: { path: string }, data: Record<string, any>) => writes.push([ref.path, data, false]),
        update: (ref: { path: string }, data: Record<string, any>) => writes.push([ref.path, data, true]),
      });
      writes.forEach(([path, data, merge]) => store.set(path, merge ? { ...store.get(path), ...data } : data));
      return result;
    },
  }),
}));

const tokenFor = (sub: string, role: "client" | "worker" | "admin") =>
  `Bearer ${signToken({ sub, role })}`;

const SECRET = "stk-secret";
const ID = "ws_CO_1";

const callback = (overrides: Record<string, unknown> = {}, amount: number | null = 500) => ({
  Body: {
    stkCallback: {
      MerchantRequestID: "mr-1",
      CheckoutRequestID: ID,
      ResultCode: 0,
      ResultDesc: "The service request is processed successfully.",
      ...(amount !== null && {
        CallbackMetadata: {
          Item: [
            { Name: "Amount", Value: amount },
            { Name: "MpesaReceiptNumber", Value: "QFK7H2L9P1" },
            { Name: "PhoneNumber", Value: 254708374149 },
          ],
        },
      }),
      ...overrides,
    },
  },
});

const ledger = () => [...store.keys()].filter((k) => k.startsWith("transactions/")).sort();

describe("settling M-Pesa payments", () => {
  const app = createApp();

  const seedPayment = (overrides: Record<string, unknown> = {}, id = ID) =>
    store.set(`payments/${id}`, {
      checkoutRequestId: id,
      merchantRequestId: "mr-1",
      kind: "escrow",
      jobId: "job1",
      workerId: "worker1",
      clientId: "client1",
      amount: 500,
      currency: "KES",
      phone: "254708374149",
      status: "pending",
      createdAt: new Date(),
      ...overrides,
    });

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DARAJA_STK_CALLBACK_SECRET = SECRET;
    delete process.env.DARAJA_SIMULATE;
    process.env.NODE_ENV = "test";
    store.clear();
    store.set("wallets/w-client1", { ownerId: "client1", ownerRole: "client", currency: "KES", balance: 100, escrowBalance: 0 });
    store.set("workers/worker1", { name: "Peter" });
    store.set("jobs/job1", { clientId: "client1", workerId: "worker1", title: "Fix sink", status: "assigned" });
    seedPayment();
  });

  const post = (body: unknown, secret = SECRET) =>
    request(app).post(`/api/payments/stk/callback/${secret}`).send(body as object);

  describe("POST /api/payments/stk/callback/:secret", () => {
    test("a successful job payment is credited and moved into the job's escrow", async () => {
      const res = await post(callback());

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ResultCode: 0, ResultDesc: "Accepted" });
      expect(store.get("payments/ws_CO_1")).toMatchObject({
        status: "completed",
        settlement: "escrow_funded",
        receipt: "QFK7H2L9P1",
      });
      expect(store.get("payments/ws_CO_1")!.settledAt).toBeDefined();
      // Credited 500 then moved to escrow: the balance is untouched and escrowBalance grows.
      expect(store.get("wallets/w-client1")).toMatchObject({ balance: 100, escrowBalance: 500 });
      expect(store.get("escrows/job1")).toMatchObject({
        jobId: "job1",
        clientId: "client1",
        workerId: "worker1",
        amount: 500,
        currency: "KES",
        status: "in_escrow",
      });
      expect(ledger()).toEqual(["transactions/fund-job1", "transactions/topup-ws_CO_1"]);
      expect(store.get("transactions/topup-ws_CO_1")).toMatchObject({
        type: "wallet_topup",
        amount: 500,
        fromUserId: "mpesa",
        toUserId: "client1",
      });
      expect(store.get("transactions/fund-job1")).toMatchObject({ type: "escrow_fund", fromUserId: "client1", toUserId: "worker1" });
    });

    test("a top-up only adds the money to the wallet", async () => {
      seedPayment({ kind: "top_up", jobId: undefined, workerId: undefined });

      await post(callback());

      expect(store.get("payments/ws_CO_1")).toMatchObject({ status: "completed", settlement: "wallet_credited" });
      expect(store.get("wallets/w-client1")).toMatchObject({ balance: 600, escrowBalance: 0 });
      expect(store.has("escrows/job1")).toBe(false);
      expect(ledger()).toEqual(["transactions/topup-ws_CO_1"]);
    });

    test("a repeated callback changes nothing, so the money is never credited twice", async () => {
      await post(callback());
      const again = await post(callback());

      expect(again.status).toBe(200);
      expect(store.get("wallets/w-client1")).toMatchObject({ balance: 100, escrowBalance: 500 });
      expect(ledger()).toHaveLength(2);
    });

    test("a cancelled payment is marked failed with Daraja's reason and moves no money", async () => {
      const res = await post(callback({ ResultCode: 1032, ResultDesc: "Request cancelled by user" }, null));

      expect(res.status).toBe(200);
      expect(store.get("payments/ws_CO_1")).toMatchObject({ status: "failed", failureReason: "Request cancelled by user" });
      expect(store.get("wallets/w-client1")).toMatchObject({ balance: 100, escrowBalance: 0 });
      expect(store.has("escrows/job1")).toBe(false);
      expect(ledger()).toEqual([]);
    });

    test("a success for a different amount is not trusted and credits nothing", async () => {
      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      await post(callback({}, 5));

      expect(store.get("payments/ws_CO_1")).toMatchObject({ status: "failed" });
      expect(store.get("payments/ws_CO_1")!.failureReason).toMatch(/amount/i);
      expect(store.get("wallets/w-client1")).toMatchObject({ balance: 100, escrowBalance: 0 });
      expect(ledger()).toEqual([]);
      errorSpy.mockRestore();
    });

    test.each([
      ["the job belongs to someone else", { clientId: "other" }],
      ["a different worker was chosen", { workerId: "worker2" }],
    ])("keeps the money in the wallet when %s", async (_label, jobChange) => {
      store.set("jobs/job1", { ...store.get("jobs/job1")!, ...jobChange });

      await post(callback());

      expect(store.get("payments/ws_CO_1")).toMatchObject({ status: "completed", settlement: "wallet_credited" });
      expect(store.get("wallets/w-client1")).toMatchObject({ balance: 600, escrowBalance: 0 });
      expect(store.has("escrows/job1")).toBe(false);
    });

    test("keeps the money in the wallet when the job's escrow is already funded", async () => {
      store.set("escrows/job1", { jobId: "job1", status: "in_escrow", amount: 300 });

      await post(callback());

      expect(store.get("payments/ws_CO_1")).toMatchObject({ settlement: "wallet_credited" });
      expect(store.get("wallets/w-client1")).toMatchObject({ balance: 600, escrowBalance: 0 });
      expect(store.get("escrows/job1")).toMatchObject({ amount: 300 });
    });

    test("fails the payment when the client has no wallet", async () => {
      store.delete("wallets/w-client1");

      await post(callback());

      expect(store.get("payments/ws_CO_1")).toMatchObject({ status: "failed", failureReason: "Client wallet not found" });
    });

    test("ignores an unknown payment and a malformed body, still answering Daraja", async () => {
      store.delete("payments/ws_CO_1");

      expect((await post(callback())).status).toBe(200);
      expect((await post({ nonsense: true })).status).toBe(200);
      expect((await post({})).status).toBe(200);
      expect(ledger()).toEqual([]);
    });

    test("a wrong secret looks like a missing route and changes nothing", async () => {
      const res = await post(callback(), "not-the-secret");

      expect(res.status).toBe(404);
      expect(store.get("payments/ws_CO_1")).toMatchObject({ status: "pending" });
    });
  });

  describe("GET /api/payments/:checkoutRequestId", () => {
    const get = (id = ID, auth = tokenFor("client1", "client")) =>
      request(app).get(`/api/payments/${id}`).set("Authorization", auth);

    test("returns the client's own payment", async () => {
      const res = await get();

      expect(res.status).toBe(200);
      expect(res.body.payment).toMatchObject({ checkoutRequestId: ID, status: "pending", amount: 500, kind: "escrow" });
    });

    test("shows the result once settled", async () => {
      await post(callback({ ResultCode: 1, ResultDesc: "Insufficient funds" }, null));

      expect((await get()).body.payment).toMatchObject({ status: "failed", failureReason: "Insufficient funds" });
    });

    test("is 404 for an unknown payment, 403 for someone else's, 403 for non-clients", async () => {
      expect((await get("nope")).status).toBe(404);
      expect((await get(ID, tokenFor("client2", "client"))).status).toBe(403);
      expect((await get(ID, tokenFor("worker1", "worker"))).status).toBe(403);
      expect((await request(app).get(`/api/payments/${ID}`)).status).toBe(401);
    });
  });

  describe("test mode (DARAJA_SIMULATE=true)", () => {
    const simulate = (outcome: unknown, id = "sim-abcdefghijklmnop", auth = tokenFor("client1", "client")) =>
      request(app).post(`/api/payments/${id}/simulate`).set("Authorization", auth).send({ outcome });

    beforeEach(() => {
      process.env.DARAJA_SIMULATE = "true";
      // No Daraja settings at all: test mode must not need them.
      for (const name of ["DARAJA_CONSUMER_KEY", "DARAJA_CONSUMER_SECRET", "DARAJA_SHORTCODE", "DARAJA_PASSKEY", "DARAJA_CALLBACK_URL"]) {
        delete process.env[name];
      }
      store.set("clients/client1", { name: "David", phone: "254712345678" });
    });

    test("stk-push sends no real prompt and records a simulated pending payment", async () => {
      const fetchSpy = jest.spyOn(global, "fetch");

      const res = await request(app)
        .post("/api/payments/stk-push")
        .set("Authorization", tokenFor("client1", "client"))
        .send({ jobId: "job1", workerId: "worker1", amount: 500 });

      expect(res.status).toBe(202);
      expect(res.body.simulated).toBe(true);
      expect(res.body.payment).toMatchObject({ kind: "escrow", status: "pending", simulated: true, phone: "254712345678" });
      expect(res.body.payment.checkoutRequestId).toMatch(/^sim-/);
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    test("a simulated payment can be completed, which funds the escrow", async () => {
      const created = await request(app)
        .post("/api/payments/stk-push")
        .set("Authorization", tokenFor("client1", "client"))
        .send({ jobId: "job1", workerId: "worker1", amount: 500 });
      const id = created.body.payment.checkoutRequestId;

      const res = await simulate("success", id);

      expect(res.status).toBe(200);
      expect(res.body.payment).toMatchObject({ status: "completed", settlement: "escrow_funded" });
      expect(res.body.payment.receipt).toMatch(/^SIM/);
      expect(store.get("escrows/job1")).toMatchObject({ status: "in_escrow", amount: 500 });
      expect(store.get("wallets/w-client1")).toMatchObject({ balance: 100, escrowBalance: 500 });
    });

    test("a simulated payment can be failed", async () => {
      const created = await request(app)
        .post("/api/payments/top-up")
        .set("Authorization", tokenFor("client1", "client"))
        .send({ amount: 300 });
      const id = created.body.payment.checkoutRequestId;

      const res = await simulate("failure", id);

      expect(res.body.payment).toMatchObject({ status: "failed" });
      expect(res.body.payment.failureReason).toMatch(/cancelled/i);
      expect(store.get("wallets/w-client1")).toMatchObject({ balance: 100 });
    });

    test("cannot simulate a real payment, someone else's payment, or with a bad outcome", async () => {
      seedPayment({ simulated: undefined }, "sim-realpayment0000");
      store.set("payments/sim-other00000000", { ...store.get("payments/ws_CO_1")!, clientId: "client2", simulated: true });

      expect((await simulate("success", "sim-realpayment0000")).status).toBe(409);
      expect((await simulate("success", "sim-other00000000")).status).toBe(403);
      expect((await simulate("maybe", "sim-other00000000")).status).toBe(400);
      expect((await simulate("success", "sim-missing0000000")).status).toBe(404);
    });

    test("is switched off in production, whatever DARAJA_SIMULATE says", async () => {
      process.env.NODE_ENV = "production";
      store.set("payments/sim-abcdefghijklmnop", { ...store.get("payments/ws_CO_1")!, simulated: true });

      expect((await simulate("success")).status).toBe(404);
      expect(store.get("payments/sim-abcdefghijklmnop")).toMatchObject({ status: "pending" });
    });

    test("is off unless DARAJA_SIMULATE is true", async () => {
      process.env.DARAJA_SIMULATE = "false";
      store.set("payments/sim-abcdefghijklmnop", { ...store.get("payments/ws_CO_1")!, simulated: true });

      expect((await simulate("success")).status).toBe(404);
    });
  });
});
