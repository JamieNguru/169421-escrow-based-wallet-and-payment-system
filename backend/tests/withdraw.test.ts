import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";
import { resetDarajaTokenCache } from "../src/services/darajaService";

// In-memory stand-in for the Firestore calls the withdrawal flow makes.
const store = new Map<string, Record<string, any>>();

const refFor = (name: string, id: string) => ({
  id,
  path: `${name}/${id}`,
  get: async () => ({ exists: store.has(`${name}/${id}`), data: () => store.get(`${name}/${id}`) }),
  update: async (data: Record<string, any>) => {
    store.set(`${name}/${id}`, { ...store.get(`${name}/${id}`), ...data });
  },
});

jest.mock("../src/config/firebase", () => ({
  getDb: () => ({
    collection: (name: string) => ({
      doc: (id: string) => refFor(name, id),
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

const workerAuth = () => `Bearer ${signToken({ sub: "worker1", role: "worker" })}`;
const clientAuth = () => `Bearer ${signToken({ sub: "client1", role: "client" })}`;

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

const b2cSuccess = {
  ConversationID: "AG_1",
  OriginatorConversationID: "ignored",
  ResponseCode: "0",
  ResponseDescription: "Accept the service request successfully.",
};

const walletBalance = () => store.get("wallets/w1")!.balance;
const withdrawals = () => [...store.entries()].filter(([path]) => path.startsWith("withdrawals/"));
const ledger = () => [...store.keys()].filter((path) => path.startsWith("transactions/"));

describe("worker withdrawals (Daraja B2C)", () => {
  const app = createApp();
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DARAJA_CONSUMER_KEY = "key";
    process.env.DARAJA_CONSUMER_SECRET = "secret";
    process.env.DARAJA_B2C_SHORTCODE = "600986";
    process.env.DARAJA_INITIATOR_NAME = "testapi";
    process.env.DARAJA_SECURITY_CREDENTIAL = "cred";
    process.env.DARAJA_B2C_RESULT_URL = "https://example.test/result";
    process.env.DARAJA_B2C_TIMEOUT_URL = "https://example.test/timeout";
    process.env.DARAJA_B2C_CALLBACK_SECRET = "s3cret";
    delete process.env.DARAJA_BASE_URL;
    resetDarajaTokenCache();
    store.clear();
    store.set("workers/worker1", { name: "Wanjiru", phone: "0708374149" });
    store.set("wallets/w1", { ownerId: "worker1", ownerRole: "worker", currency: "KES", balance: 1000, escrowBalance: 0 });

    fetchMock = jest.spyOn(global, "fetch").mockImplementation(async (url) =>
      String(url).includes("/oauth/")
        ? jsonResponse({ access_token: "tok", expires_in: "3599" })
        : jsonResponse(b2cSuccess),
    );
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  const withdraw = (payload: unknown = { amount: 400 }, auth = workerAuth()) =>
    request(app).post("/api/payments/withdraw").set("Authorization", auth).send(payload as object);

  const callback = (kind: "result" | "timeout", id: string, code = 0, secret = "s3cret") =>
    request(app)
      .post(`/api/payments/b2c/${kind}/${secret}`)
      .send({
        Result: {
          ResultCode: code,
          ResultDesc: code === 0 ? "Success" : "The balance is insufficient",
          OriginatorConversationID: id,
          TransactionID: "RCP123",
        },
      });

  const initiate = async () => {
    const res = await withdraw();
    return res.body.withdrawal.originatorConversationId as string;
  };

  test("debits the wallet, records a pending withdrawal and the ledger entry", async () => {
    const res = await withdraw();

    expect(res.status).toBe(202);
    expect(res.body.withdrawal).toMatchObject({
      workerId: "worker1",
      amount: 400,
      currency: "KES",
      phone: "254708374149",
      status: "pending",
      conversationId: "AG_1",
    });
    expect(walletBalance()).toBe(600);
    const id = res.body.withdrawal.originatorConversationId;
    expect(store.get(`withdrawals/${id}`)).toMatchObject({ status: "pending", conversationId: "AG_1" });
    expect(store.get(`transactions/withdraw-${id}`)).toMatchObject({
      type: "withdrawal",
      amount: 400,
      fromUserId: "worker1",
      toUserId: "mpesa",
    });
  });

  test("calls Daraja B2C with the expected payload", async () => {
    const res = await withdraw();

    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toBe("https://sandbox.safaricom.co.ke/mpesa/b2c/v3/paymentrequest");
    expect((init as any).headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse((init as any).body)).toMatchObject({
      OriginatorConversationID: res.body.withdrawal.originatorConversationId,
      InitiatorName: "testapi",
      SecurityCredential: "cred",
      CommandID: "BusinessPayment",
      Amount: 400,
      PartyA: "600986",
      PartyB: "254708374149",
      ResultURL: "https://example.test/result",
      QueueTimeOutURL: "https://example.test/timeout",
    });
  });

  test.each([{}, { amount: 0 }, { amount: 10.5 }, { amount: "400" }])("400 for invalid body %j", async (payload) => {
    const res = await withdraw(payload);

    expect(res.status).toBe(400);
    expect(walletBalance()).toBe(1000);
  });

  test("401 without a token", async () => {
    const res = await request(app).post("/api/payments/withdraw").send({ amount: 400 });

    expect(res.status).toBe(401);
  });

  test("403 for a client", async () => {
    const res = await withdraw({ amount: 400 }, clientAuth());

    expect(res.status).toBe(403);
  });

  test("402 when the balance is too low, and nothing is recorded", async () => {
    const res = await withdraw({ amount: 5000 });

    expect(res.status).toBe(402);
    expect(walletBalance()).toBe(1000);
    expect(withdrawals()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("409 when the worker has no phone on file", async () => {
    store.set("workers/worker1", { name: "Wanjiru" });

    const res = await withdraw();

    expect(res.status).toBe(409);
    expect(walletBalance()).toBe(1000);
  });

  test("404 when the worker wallet is missing", async () => {
    store.delete("wallets/w1");

    expect((await withdraw()).status).toBe(404);
  });

  test("503 and a refund when Daraja is unreachable", async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes("/oauth/")) return jsonResponse({ access_token: "tok", expires_in: "3599" });
      throw new Error("network down");
    });

    const res = await withdraw();

    expect(res.status).toBe(503);
    expect(walletBalance()).toBe(1000);
    expect(withdrawals()[0][1].status).toBe("failed");
  });

  test("502 and a refund when Daraja rejects the request", async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).includes("/oauth/")
        ? jsonResponse({ access_token: "tok", expires_in: "3599" })
        : jsonResponse({ ResponseCode: "1", ResponseDescription: "Rejected" }),
    );

    const res = await withdraw();

    expect(res.status).toBe(502);
    expect(walletBalance()).toBe(1000);
    expect(withdrawals()[0][1].status).toBe("failed");
  });

  test("500 when B2C config is missing, with no money moved", async () => {
    delete process.env.DARAJA_SECURITY_CREDENTIAL;

    const res = await withdraw();

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Internal server error");
    expect(walletBalance()).toBe(1000);
  });

  test("a successful result marks the withdrawal completed", async () => {
    const id = await initiate();

    const res = await callback("result", id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ResultCode: 0, ResultDesc: "Accepted" });
    expect(store.get(`withdrawals/${id}`)).toMatchObject({ status: "completed", receipt: "RCP123" });
    expect(walletBalance()).toBe(600);
  });

  test("a failed result refunds the wallet once, even if delivered twice", async () => {
    const id = await initiate();

    await callback("result", id, 2001);
    await callback("result", id, 2001);

    expect(store.get(`withdrawals/${id}`)).toMatchObject({ status: "failed" });
    expect(walletBalance()).toBe(1000);
    expect(store.get(`transactions/withdraw-reversal-${id}`)).toMatchObject({
      type: "withdrawal_reversal",
      toUserId: "worker1",
    });
    expect(ledger()).toHaveLength(2);
  });

  test("a timeout refunds the wallet", async () => {
    const id = await initiate();

    const res = await callback("timeout", id);

    expect(res.status).toBe(200);
    expect(store.get(`withdrawals/${id}`)).toMatchObject({ status: "failed" });
    expect(walletBalance()).toBe(1000);
  });

  test("a late timeout cannot refund a completed withdrawal", async () => {
    const id = await initiate();
    await callback("result", id);

    await callback("timeout", id);

    expect(store.get(`withdrawals/${id}`)!.status).toBe("completed");
    expect(walletBalance()).toBe(600);
  });

  test("an unknown withdrawal is acknowledged and ignored", async () => {
    const res = await callback("result", "nope", 2001);

    expect(res.status).toBe(200);
    expect(walletBalance()).toBe(1000);
  });

  test("callbacks with the wrong secret get 404 and change nothing", async () => {
    const id = await initiate();

    const res = await callback("result", id, 2001, "wrong");

    expect(res.status).toBe(404);
    expect(store.get(`withdrawals/${id}`)!.status).toBe("pending");
    expect(walletBalance()).toBe(600);
  });
});
