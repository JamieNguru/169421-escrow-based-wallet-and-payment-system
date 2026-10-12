import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";
import { resetRateCache } from "../src/services/exchangeRateService";

const tokenFor = (sub: string, role: "client" | "worker" | "admin") =>
  `Bearer ${signToken({ sub, role })}`;

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

const ratesBody = {
  result: "success",
  time_last_update_unix: 1760000000,
  rates: { USD: 1, KES: 129, UGX: 3600, TZS: 2500, EUR: 0.9 },
};

const convert = (query: string, auth: string | null = tokenFor("client1", "client")) => {
  const req = request(createApp()).get(`/api/wallet/convert?${query}`);
  return auth ? req.set("Authorization", auth) : req;
};

describe("GET /api/wallet/convert", () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    resetRateCache();
    fetchMock = jest.spyOn(global, "fetch").mockImplementation(async () => jsonResponse(ratesBody));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("converts through the USD cross-rate", async () => {
    const res = await convert("from=KES&to=UGX&amount=1000");

    expect(res.status).toBe(200);
    expect(res.body.conversion).toEqual({
      from: "KES",
      to: "UGX",
      amount: 1000,
      rate: 27.906977,
      converted: 27906.98,
      rateUpdatedAt: new Date(1760000000 * 1000).toISOString(),
    });
  });

  it("converts to and from USD", async () => {
    const toUsd = await convert("from=KES&to=USD&amount=1290");
    expect(toUsd.body.conversion.converted).toBe(10);

    const fromUsd = await convert("from=USD&to=TZS&amount=2");
    expect(fromUsd.body.conversion.converted).toBe(5000);
  });

  it("returns a rate of 1 for the same currency", async () => {
    const res = await convert("from=KES&to=KES&amount=50.5");
    expect(res.body.conversion).toMatchObject({ rate: 1, converted: 50.5 });
  });

  it("accepts lowercase currency codes", async () => {
    const res = await convert("from=kes&to=usd&amount=129");
    expect(res.status).toBe(200);
    expect(res.body.conversion).toMatchObject({ from: "KES", to: "USD", converted: 1 });
  });

  it.each([
    ["unsupported currency", "from=KES&to=EUR&amount=10"],
    ["missing to", "from=KES&amount=10"],
    ["missing amount", "from=KES&to=USD"],
    ["zero amount", "from=KES&to=USD&amount=0"],
    ["negative amount", "from=KES&to=USD&amount=-5"],
    ["non-numeric amount", "from=KES&to=USD&amount=abc"],
  ])("rejects %s with 400", async (_name, query) => {
    const res = await convert(query);
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    expect((await convert("from=KES&to=USD&amount=10", null)).status).toBe(401);
  });

  it.each(["client", "worker", "admin"] as const)("is open to the %s role", async (role) => {
    const res = await convert("from=KES&to=USD&amount=10", tokenFor("u1", role));
    expect(res.status).toBe(200);
  });

  describe("rate caching", () => {
    it("fetches rates once for repeated requests", async () => {
      await convert("from=KES&to=USD&amount=10");
      await convert("from=USD&to=UGX&amount=10");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("refetches once the cache is an hour old", async () => {
      jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval"] });
      await convert("from=KES&to=USD&amount=10");
      jest.setSystemTime(Date.now() + 61 * 60 * 1000);
      await convert("from=KES&to=USD&amount=10");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the rate provider fails", () => {
    const failures: Array<[string, () => Promise<Response>]> = [
      ["rejects", async () => Promise.reject(new Error("network down"))],
      ["returns non-200", async () => jsonResponse({}, 500)],
      ["reports an error result", async () => jsonResponse({ result: "error" })],
      ["omits a currency", async () => jsonResponse({ ...ratesBody, rates: { USD: 1, KES: 129 } })],
    ];

    it.each(failures)("returns 503 with no cache when the provider %s", async (_name, impl) => {
      fetchMock.mockImplementation(impl);
      const res = await convert("from=KES&to=USD&amount=10");
      expect(res.status).toBe(503);
      expect(res.body.error).toBe("exchange rates unavailable");
    });

    it("serves stale rates when a refresh fails", async () => {
      jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval"] });
      await convert("from=KES&to=USD&amount=129");
      jest.setSystemTime(Date.now() + 61 * 60 * 1000);
      fetchMock.mockImplementation(async () => Promise.reject(new Error("network down")));

      const res = await convert("from=KES&to=USD&amount=129");
      expect(res.status).toBe(200);
      expect(res.body.conversion.converted).toBe(1);
    });
  });
});
