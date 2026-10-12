import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";
import { resetDarajaTokenCache } from "../src/services/darajaService";

// Minimal in-memory stand-in for the Firestore calls the payment service makes.
const store = new Map<string, Record<string, any>>();

jest.mock("../src/config/firebase", () => ({
  getDb: () => ({
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          const data = store.get(`${name}/${id}`);
          return { exists: data !== undefined, data: () => data };
        },
        set: async (data: Record<string, any>) => {
          store.set(`${name}/${id}`, data);
        },
      }),
    }),
  }),
}));

const tokenFor = (sub: string, role: "client" | "worker" | "admin") =>
  `Bearer ${signToken({ sub, role })}`;

const body = { jobId: "job1", workerId: "worker1", amount: 500, phone: "0708374149" };

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

const stkSuccess = {
  MerchantRequestID: "mr-1",
  CheckoutRequestID: "ws_CO_1",
  ResponseCode: "0",
  ResponseDescription: "Success. Request accepted for processing",
  CustomerMessage: "Success. Request accepted for processing",
};

describe("POST /api/payments/stk-push", () => {
  const app = createApp();
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DARAJA_CONSUMER_KEY = "key";
    process.env.DARAJA_CONSUMER_SECRET = "secret";
    process.env.DARAJA_SHORTCODE = "174379";
    process.env.DARAJA_PASSKEY = "passkey";
    process.env.DARAJA_CALLBACK_URL = "https://example.test/callback";
    delete process.env.DARAJA_BASE_URL;
    resetDarajaTokenCache();
    store.clear();
    store.set("workers/worker1", { name: "Wanjiru" });
    store.set("clients/client1", { name: "Kamau", phone: "254712345678" });

    fetchMock = jest.spyOn(global, "fetch").mockImplementation(async (url) =>
      String(url).includes("/oauth/")
        ? jsonResponse({ access_token: "tok", expires_in: "3599" })
        : jsonResponse(stkSuccess),
    );
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  const initiate = (payload: unknown = body, auth = tokenFor("client1", "client")) =>
    request(app).post("/api/payments/stk-push").set("Authorization", auth).send(payload as object);

  test("sends the STK push and stores a pending payment", async () => {
    const res = await initiate();

    expect(res.status).toBe(202);
    expect(res.body.payment).toMatchObject({
      checkoutRequestId: "ws_CO_1",
      merchantRequestId: "mr-1",
      jobId: "job1",
      clientId: "client1",
      workerId: "worker1",
      amount: 500,
      currency: "KES",
      phone: "254708374149",
      status: "pending",
    });
    expect(res.body.message).toBe(stkSuccess.CustomerMessage);
    expect(store.get("payments/ws_CO_1")).toMatchObject({ status: "pending", amount: 500 });
  });

  test("does not touch the escrow, wallet or ledger", async () => {
    await initiate();

    expect([...store.keys()].filter((key) => /^(escrows|wallets|transactions)\//.test(key))).toEqual([]);
  });

  test("calls Daraja with the expected auth and payload", async () => {
    await initiate();

    const [oauthUrl, oauthInit] = fetchMock.mock.calls[0];
    expect(String(oauthUrl)).toBe(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
    );
    expect((oauthInit as any).headers.Authorization).toBe(
      `Basic ${Buffer.from("key:secret").toString("base64")}`,
    );

    const [stkUrl, stkInit] = fetchMock.mock.calls[1];
    expect(String(stkUrl)).toBe("https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest");
    expect((stkInit as any).headers.Authorization).toBe("Bearer tok");

    const sent = JSON.parse((stkInit as any).body);
    expect(sent).toMatchObject({
      BusinessShortCode: "174379",
      TransactionType: "CustomerPayBillOnline",
      Amount: 500,
      PartyA: "254708374149",
      PartyB: "174379",
      PhoneNumber: "254708374149",
      CallBackURL: "https://example.test/callback",
      AccountReference: "job1",
    });
    expect(sent.Timestamp).toMatch(/^\d{14}$/);
    expect(sent.Password).toBe(
      Buffer.from(`174379passkey${sent.Timestamp}`).toString("base64"),
    );
  });

  test("reuses the cached access token across requests", async () => {
    await initiate();
    store.delete("payments/ws_CO_1");
    await initiate();

    const oauthCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/oauth/"));
    expect(oauthCalls).toHaveLength(1);
  });

  test("falls back to the phone saved on the client", async () => {
    const res = await initiate({ jobId: "job1", workerId: "worker1", amount: 500 });

    expect(res.status).toBe(202);
    expect(res.body.payment.phone).toBe("254712345678");
  });

  test("400 when there is no phone in the request or on file", async () => {
    store.set("clients/client1", { name: "Kamau" });
    const res = await initiate({ jobId: "job1", workerId: "worker1", amount: 500 });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each([
    ["missing jobId", { ...body, jobId: undefined }],
    ["missing workerId", { ...body, workerId: undefined }],
    ["zero amount", { ...body, amount: 0 }],
    ["negative amount", { ...body, amount: -5 }],
    ["fractional amount", { ...body, amount: 10.5 }],
    ["string amount", { ...body, amount: "500" }],
    ["invalid phone", { ...body, phone: "12345" }],
  ])("400 for %s", async (_label, payload) => {
    const res = await initiate(payload);

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("401 without a token", async () => {
    const res = await request(app).post("/api/payments/stk-push").send(body);

    expect(res.status).toBe(401);
  });

  test.each(["worker", "admin"] as const)("403 for a %s", async (role) => {
    const res = await initiate(body, tokenFor("user1", role));

    expect(res.status).toBe(403);
  });

  test("404 when the worker does not exist", async () => {
    store.delete("workers/worker1");
    const res = await initiate();

    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("409 when the job's escrow is already funded", async () => {
    store.set("escrows/job1", { status: "in_escrow" });
    const res = await initiate();

    expect(res.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.has("payments/ws_CO_1")).toBe(false);
  });

  test("503 and no payment doc when Daraja is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const res = await initiate();

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "M-Pesa unavailable" });
    expect([...store.keys()].some((key) => key.startsWith("payments/"))).toBe(false);
  });

  test("503 when the STK request returns an error status", async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).includes("/oauth/")
        ? jsonResponse({ access_token: "tok", expires_in: "3599" })
        : jsonResponse({ errorMessage: "Bad Request" }, 400),
    );
    const res = await initiate();

    expect(res.status).toBe(503);
  });

  test("502 when Daraja does not accept the request", async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).includes("/oauth/")
        ? jsonResponse({ access_token: "tok", expires_in: "3599" })
        : jsonResponse({ ResponseCode: "1", ResponseDescription: "Rejected" }),
    );
    const res = await initiate();

    expect(res.status).toBe(502);
    expect(store.has("payments/ws_CO_1")).toBe(false);
  });

  test("500 with a masked message when Daraja is not configured", async () => {
    delete process.env.DARAJA_PASSKEY;
    const res = await initiate();

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  });
});
