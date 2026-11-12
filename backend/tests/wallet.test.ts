import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";

const store = new Map<string, Record<string, any>>();

jest.mock("../src/config/firebase", () => ({
  getDb: () => ({
    collection: (name: string) => {
      const build = (filters: Array<[string, any]>) => ({
        where: (field: string, _op: string, value: unknown) => build([...filters, [field, value]]),
        limit: () => build(filters),
        get: async () => {
          const docs = [...store.entries()]
            .filter(([path]) => path.startsWith(`${name}/`))
            .map(([path, data]) => ({ id: path.split("/")[1], data: () => data }))
            .filter(({ data }) => filters.every(([field, value]) => data()[field] === value));
          return { empty: docs.length === 0, docs };
        },
      });
      return build([]);
    },
  }),
}));

const tokenFor = (sub: string, role: "client" | "worker" | "admin") =>
  `Bearer ${signToken({ sub, role })}`;

describe("GET /api/wallet", () => {
  const app = createApp();

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    store.clear();
    store.set("wallets/w-client1", { ownerId: "client1", balance: 45000, escrowBalance: 14500, currency: "KES" });
    store.set("wallets/w-worker1", { ownerId: "worker1", balance: 8200, escrowBalance: 0, currency: "KES" });
  });

  test("returns the caller's own wallet", async () => {
    const res = await request(app).get("/api/wallet").set("Authorization", tokenFor("client1", "client"));

    expect(res.status).toBe(200);
    expect(res.body.wallet).toEqual({ id: "w-client1", balance: 45000, escrowBalance: 14500, currency: "KES" });
  });

  test("works for workers too", async () => {
    const res = await request(app).get("/api/wallet").set("Authorization", tokenFor("worker1", "worker"));

    expect(res.status).toBe(200);
    expect(res.body.wallet.balance).toBe(8200);
  });

  test("404 when the user has no wallet", async () => {
    const res = await request(app).get("/api/wallet").set("Authorization", tokenFor("client9", "client"));

    expect(res.status).toBe(404);
  });

  test("403 for admins, who hold no funds", async () => {
    const res = await request(app).get("/api/wallet").set("Authorization", tokenFor("admin1", "admin"));

    expect(res.status).toBe(403);
  });

  test("401 without a token", async () => {
    expect((await request(app).get("/api/wallet")).status).toBe(401);
  });
});
