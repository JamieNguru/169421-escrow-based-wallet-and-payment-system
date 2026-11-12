import { createHmac } from "node:crypto";

import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";
import { createMemoryDb } from "./helpers/memoryDb";

// The terms gate has its own tests (requireTerms.test.ts); let requests through here.
jest.mock("../src/middleware/requireTerms", () => ({
  requireTerms: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const memory = createMemoryDb();
jest.mock("../src/config/firebase", () => ({ getDb: () => memory.db }));

const clientAuth = () => `Bearer ${signToken({ sub: "client1", role: "client" })}`;
const SECRET = "sk_test_secret";

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

const charged = (status: string, extra: Record<string, unknown> = {}) =>
  jsonResponse({ status: true, message: "Charge attempted", data: { status, amount: 50000, receipt_number: "10101", ...extra } });

const balance = () => memory.store.get("wallets/w1")!.balance;
const payments = () => [...memory.store.entries()].filter(([path]) => path.startsWith("payments/"));

describe("client payments through Paystack", () => {
  const app = createApp();
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    process.env.PAYMENT_PROVIDER = "paystack";
    process.env.PAYSTACK_SECRET_KEY = SECRET;
    // Test mode for Daraja is on too, as in a local demo; Paystack must still be used.
    process.env.DARAJA_SIMULATE = "true";
    memory.reset();
    memory.store.set("clients/client1", { name: "Kamau", email: "kamau@example.com", phone: "254712345678" });
    memory.store.set("wallets/w1", { ownerId: "client1", ownerRole: "client", currency: "KES", balance: 0, escrowBalance: 0 });
    fetchMock = jest.spyOn(global, "fetch").mockImplementation(async () => charged("success"));
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.PAYMENT_PROVIDER;
    delete process.env.PAYSTACK_SECRET_KEY;
    delete process.env.DARAJA_SIMULATE;
    jest.restoreAllMocks();
  });

  const topUp = (payload: unknown = { amount: 500, phone: "0710000000" }) =>
    request(app).post("/api/payments/top-up").set("Authorization", clientAuth()).send(payload as object);

  test("charges M-Pesa through Paystack and credits the wallet when it is approved at once", async () => {
    const res = await topUp();

    expect(res.status).toBe(202);
    expect(res.body.payment).toMatchObject({ status: "completed", provider: "paystack", amount: 500, receipt: "10101" });
    expect(res.body.simulated).toBe(false);
    expect(balance()).toBe(500);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.paystack.co/charge");
    expect(init.headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(init.body)).toMatchObject({
      email: "kamau@example.com",
      amount: 50000,
      currency: "KES",
      mobile_money: { phone: "+254710000000", provider: "mpesa" },
    });
  });

  test("a reserved-domain email, like the demo accounts have, is swapped for a stand-in", async () => {
    memory.store.set("clients/client1", { name: "Demo", email: "client.new@demo.test", phone: "254712345678" });
    await topUp();

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).email).toBe("client1@example.com");
  });

  test("a declined charge is reported and nothing is credited", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ status: false, message: "Charge attempted", data: { status: "failed", message: "Declined. Use the test number." } }, 400),
    );
    const res = await topUp({ amount: 500, phone: "0708374149" });

    expect(res.status).toBe(402);
    expect(res.body.error).toContain("Declined");
    expect(balance()).toBe(0);
    expect(payments().map(([, p]) => p.status)).toEqual(["failed"]);
  });

  test("a charge still waiting on the customer settles when the app next checks it", async () => {
    fetchMock.mockImplementation(async () => charged("pay_offline", { display_text: "Enter your PIN" }));
    const started = await topUp();

    expect(started.body.payment.status).toBe("pending");
    expect(started.body.message).toBe("Enter your PIN");
    expect(balance()).toBe(0);

    const id = started.body.payment.checkoutRequestId;
    fetchMock.mockImplementation(async () => charged("pending"));
    const stillWaiting = await request(app).get(`/api/payments/${id}`).set("Authorization", clientAuth());
    expect(stillWaiting.body.payment.status).toBe("pending");

    fetchMock.mockImplementation(async () => charged("success"));
    const done = await request(app).get(`/api/payments/${id}`).set("Authorization", clientAuth());
    expect(done.body.payment.status).toBe("completed");
    expect(balance()).toBe(500);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain(`/transaction/verify/${id}`);
  });

  describe("webhook", () => {
    const sign = (raw: string) => createHmac("sha512", SECRET).update(raw).digest("hex");
    const send = (event: object, signature?: string) => {
      const raw = JSON.stringify(event);
      return request(app)
        .post("/api/payments/paystack/webhook")
        .set("Content-Type", "application/json")
        .set("x-paystack-signature", signature ?? sign(raw))
        .send(raw);
    };

    const startPending = async () => {
      fetchMock.mockImplementation(async () => charged("pay_offline"));
      return (await topUp()).body.payment.checkoutRequestId as string;
    };

    test("credits the wallet once, however many times Paystack repeats it", async () => {
      const id = await startPending();
      const event = { event: "charge.success", data: { reference: id, amount: 50000, receipt_number: "R9" } };

      expect((await send(event)).status).toBe(200);
      expect((await send(event)).status).toBe(200);

      expect(balance()).toBe(500);
      expect(memory.store.get(`payments/${id}`)).toMatchObject({ status: "completed", receipt: "R9" });
    });

    test("a payment for a different amount is not credited", async () => {
      const id = await startPending();
      await send({ event: "charge.success", data: { reference: id, amount: 100, receipt_number: "R9" } });

      expect(balance()).toBe(0);
      expect(memory.store.get(`payments/${id}`)).toMatchObject({ status: "failed" });
    });

    test("charge.failed marks it failed", async () => {
      const id = await startPending();
      await send({ event: "charge.failed", data: { reference: id, gateway_response: "Cancelled by customer" } });

      expect(memory.store.get(`payments/${id}`)).toMatchObject({ status: "failed", failureReason: "Cancelled by customer" });
    });

    test("rejects a missing or wrong signature", async () => {
      const id = await startPending();
      const event = { event: "charge.success", data: { reference: id, amount: 50000 } };

      expect((await send(event, "not-the-signature")).status).toBe(401);
      expect((await request(app).post("/api/payments/paystack/webhook").send(event)).status).toBe(401);
      expect(balance()).toBe(0);
    });

    test("is off unless Paystack is the provider", async () => {
      const id = await startPending();
      delete process.env.PAYMENT_PROVIDER;

      expect((await send({ event: "charge.success", data: { reference: id, amount: 50000 } })).status).toBe(401);
    });
  });
});

describe("without Paystack", () => {
  const app = createApp();

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DARAJA_SIMULATE = "true";
    delete process.env.PAYMENT_PROVIDER;
    delete process.env.PAYSTACK_SECRET_KEY;
    memory.reset();
    memory.store.set("clients/client1", { name: "Kamau", email: "kamau@example.com", phone: "254712345678" });
  });

  afterEach(() => {
    delete process.env.DARAJA_SIMULATE;
    jest.restoreAllMocks();
  });

  test("payments still use Daraja's test mode and never call Paystack", async () => {
    const fetchMock = jest.spyOn(global, "fetch");
    const res = await request(app).post("/api/payments/top-up").set("Authorization", clientAuth()).send({ amount: 500 });

    expect(res.status).toBe(202);
    expect(res.body.simulated).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
