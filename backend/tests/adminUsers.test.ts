import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";

// In-memory stand-in for the Firestore calls the admin user endpoints make.
const store = new Map<string, Record<string, any>>();

const idOf = (path: string) => path.split("/")[1];

jest.mock("../src/config/firebase", () => ({
  getDb: () => ({
    collection: (name: string) => {
      const docsIn = (filters: Array<[string, unknown]> = [], max = Infinity) =>
        [...store.entries()]
          .filter(([path, data]) => path.startsWith(`${name}/`) && filters.every(([f, v]) => data[f] === v))
          .slice(0, max)
          .map(([path, data]) => ({ id: idOf(path), data: () => data }));

      const query = (filters: Array<[string, unknown]>, max: number): any => ({
        where: (field: string, _op: string, value: unknown) => query([...filters, [field, value]], max),
        limit: (n: number) => query(filters, n),
        get: async () => ({ docs: docsIn(filters, max) }),
      });

      return {
        ...query([], Infinity),
        doc: (id: string) => ({
          id,
          get: async () => {
            const data = store.get(`${name}/${id}`);
            return { exists: data !== undefined, data: () => data };
          },
          update: async (data: Record<string, any>) => {
            store.set(`${name}/${id}`, { ...store.get(`${name}/${id}`), ...data });
          },
        }),
      };
    },
  }),
}));

const tokenFor = (sub: string, role: "client" | "worker" | "admin") =>
  `Bearer ${signToken({ sub, role })}`;

// Signed on demand because JWT_SECRET is only set in beforeEach.
const adminAuth = () => tokenFor("a1", "admin");

function seedUser(
  collection: "clients" | "workers" | "admins",
  id: string,
  name: string,
  createdAt: string,
  extra: Record<string, any> = {},
) {
  store.set(`${collection}/${id}`, {
    name,
    email: `${id}@example.com`,
    phone: "254712345678",
    passwordHash: "secret-hash",
    createdAt: new Date(createdAt),
    ...extra,
  });
}

describe("admin user management", () => {
  const app = createApp();

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    store.clear();
    seedUser("admins", "a1", "Root", "2026-01-01T00:00:00Z");
    seedUser("clients", "c1", "Carol", "2026-02-01T00:00:00Z");
    seedUser("workers", "w1", "Wanjiku", "2026-03-01T00:00:00Z", { status: "suspended", statusReason: "fraud" });
    seedUser("clients", "c2", "Chege", "2026-04-01T00:00:00Z");
    store.set("wallets/wal1", {
      ownerId: "c1",
      ownerRole: "client",
      currency: "KES",
      balance: 1200,
      escrowBalance: 300,
    });
  });

  describe("GET /api/admin/users", () => {
    test("lists users from every collection, newest first, without passwordHash", async () => {
      const res = await request(app).get("/api/admin/users").set("Authorization", adminAuth());

      expect(res.status).toBe(200);
      expect(res.body.users.map((u: any) => u.id)).toEqual(["c2", "w1", "c1", "a1"]);
      expect(res.body.users[0]).toEqual({
        id: "c2",
        name: "Chege",
        email: "c2@example.com",
        phone: "254712345678",
        role: "client",
        status: "active",
        createdAt: "2026-04-01T00:00:00.000Z",
      });
      expect(res.body.users[1]).toMatchObject({ status: "suspended", statusReason: "fraud" });
      expect(res.body.nextCursor).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|secret-hash/i);
    });

    test("filters by role", async () => {
      const res = await request(app).get("/api/admin/users?role=client").set("Authorization", adminAuth());

      expect(res.body.users.map((u: any) => u.id)).toEqual(["c2", "c1"]);
    });

    test("filters by status, treating a missing status as active", async () => {
      const suspended = await request(app).get("/api/admin/users?status=suspended").set("Authorization", adminAuth());
      const active = await request(app).get("/api/admin/users?status=active").set("Authorization", adminAuth());

      expect(suspended.body.users.map((u: any) => u.id)).toEqual(["w1"]);
      expect(active.body.users.map((u: any) => u.id)).toEqual(["c2", "c1", "a1"]);
    });

    test("pages with limit and nextCursor", async () => {
      const first = await request(app).get("/api/admin/users?limit=3").set("Authorization", adminAuth());
      expect(first.body.users.map((u: any) => u.id)).toEqual(["c2", "w1", "c1"]);
      expect(first.body.nextCursor).toEqual(expect.any(String));

      const second = await request(app)
        .get("/api/admin/users")
        .query({ limit: 3, startAfter: first.body.nextCursor })
        .set("Authorization", adminAuth());
      expect(second.body.users.map((u: any) => u.id)).toEqual(["a1"]);
      expect(second.body.nextCursor).toBeUndefined();
    });

    test.each([["limit=0"], ["limit=101"], ["limit=abc"], ["role=boss"], ["status=banned"]])(
      "rejects invalid query %s with 400",
      async (qs) => {
        const res = await request(app).get(`/api/admin/users?${qs}`).set("Authorization", adminAuth());

        expect(res.status).toBe(400);
      },
    );

    test("requires an admin", async () => {
      expect((await request(app).get("/api/admin/users")).status).toBe(401);
      const asClient = await request(app).get("/api/admin/users").set("Authorization", tokenFor("c1", "client"));
      expect(asClient.status).toBe(403);
    });
  });

  describe("GET /api/admin/users/:role/:id", () => {
    test("returns a client with their wallet", async () => {
      const res = await request(app).get("/api/admin/users/client/c1").set("Authorization", adminAuth());

      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({
        id: "c1",
        role: "client",
        status: "active",
        wallet: { id: "wal1", balance: 1200, escrowBalance: 300, currency: "KES" },
      });
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|secret-hash/i);
    });

    test("returns an admin without a wallet", async () => {
      const res = await request(app).get("/api/admin/users/admin/a1").set("Authorization", adminAuth());

      expect(res.status).toBe(200);
      expect(res.body.user.wallet).toBeUndefined();
    });

    test("returns 404 for an unknown user and 400 for a bad role", async () => {
      const missing = await request(app).get("/api/admin/users/client/nope").set("Authorization", adminAuth());
      const badRole = await request(app).get("/api/admin/users/boss/c1").set("Authorization", adminAuth());

      expect(missing.status).toBe(404);
      expect(badRole.status).toBe(400);
    });

    test("requires an admin", async () => {
      const res = await request(app).get("/api/admin/users/client/c1").set("Authorization", tokenFor("w1", "worker"));

      expect(res.status).toBe(403);
    });
  });

  describe("PATCH /api/admin/users/:role/:id/status", () => {
    const patch = (path: string, body: unknown, auth = adminAuth()) =>
      request(app).patch(path).set("Authorization", auth).send(body as object);

    test("suspends a user and records who did it and why", async () => {
      const res = await patch("/api/admin/users/client/c1/status", { status: "suspended", reason: "  chargeback abuse " });

      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ id: "c1", status: "suspended", statusReason: "chargeback abuse" });
      expect(store.get("clients/c1")).toMatchObject({
        status: "suspended",
        statusReason: "chargeback abuse",
        statusUpdatedBy: "a1",
        statusUpdatedAt: expect.any(Date),
      });
    });

    test("reactivates a suspended user and clears the reason", async () => {
      const res = await patch("/api/admin/users/worker/w1/status", { status: "active" });

      expect(res.status).toBe(200);
      expect(res.body.user.status).toBe("active");
      expect(res.body.user.statusReason).toBeUndefined();
      expect(store.get("workers/w1")).toMatchObject({ status: "active", statusReason: null });
    });

    test("refuses to suspend an admin account, including the caller's own", async () => {
      const res = await patch("/api/admin/users/admin/a1/status", { status: "suspended", reason: "fraud" });

      expect(res.status).toBe(403);
      expect(store.get("admins/a1")?.status).toBeUndefined();
    });

    test("returns 404 for an unknown user", async () => {
      const res = await patch("/api/admin/users/client/nope/status", { status: "suspended", reason: "fraud" });

      expect(res.status).toBe(404);
    });

    test.each([
      [{}],
      [{ status: "banned" }],
      [{ status: "suspended" }],
      [{ status: "suspended", reason: "" }],
      [{ status: "suspended", reason: "   " }],
      [{ status: "suspended", reason: "x".repeat(1001) }],
    ])("rejects invalid body %j with 400", async (body) => {
      const res = await patch("/api/admin/users/client/c1/status", body);

      expect(res.status).toBe(400);
    });

    test("rejects a bad role with 400", async () => {
      const res = await patch("/api/admin/users/boss/c1/status", { status: "suspended" });

      expect(res.status).toBe(400);
    });

    test("requires an admin", async () => {
      const unauthenticated = await request(app).patch("/api/admin/users/client/c1/status").send({ status: "suspended" });
      const asClient = await patch("/api/admin/users/client/c2/status", { status: "suspended" }, tokenFor("c1", "client"));

      expect(unauthenticated.status).toBe(401);
      expect(asClient.status).toBe(403);
      expect(store.get("clients/c1")?.status).toBeUndefined();
    });
  });
});
