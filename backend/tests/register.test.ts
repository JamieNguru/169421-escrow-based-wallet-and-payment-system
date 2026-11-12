import bcrypt from "bcryptjs";
import request from "supertest";

import { createApp } from "../src/app";
import { CURRENT_TERMS_VERSION } from "../src/config/terms";
import { createUser } from "../src/services/userService";

// Minimal in-memory stand-in for the Firestore calls registerUser makes.
const store = new Map<string, Record<string, any>>();
let nextId = 1;

jest.mock("../src/config/firebase", () => ({
  getDb: () => ({
    collection: (name: string) => ({
      doc: (id: string = `id${nextId++}`) => ({ id, path: `${name}/${id}` }),
    }),
    runTransaction: async (fn: (tx: any) => Promise<void>) => {
      const writes: Array<[string, Record<string, any>]> = [];
      await fn({
        get: async (ref: { path: string }) => ({ exists: store.has(ref.path) }),
        set: (ref: { path: string }, data: Record<string, any>) => writes.push([ref.path, data]),
      });
      writes.forEach(([path, data]) => store.set(path, data));
    },
  }),
}));

const valid = {
  name: "Jane Doe",
  email: "Jane@Example.com",
  phone: "0712345678",
  password: "supersecret",
  role: "client",
  acceptTerms: true,
};

describe("POST /api/auth/register", () => {
  const app = createApp();

  beforeEach(() => {
    store.clear();
    nextId = 1;
  });

  test("registers a client and returns the public profile", async () => {
    const res = await request(app).post("/api/auth/register").send(valid);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: "id1",
      name: "Jane Doe",
      email: "jane@example.com",
      phone: "254712345678",
      role: "client",
      walletId: "id2",
      termsAccepted: true,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  test.each([
    ["missing", undefined],
    ["false", false],
    ["a string", "true"],
  ])("rejects registration when acceptTerms is %s", async (_label, acceptTerms) => {
    const res = await request(app).post("/api/auth/register").send({ ...valid, acceptTerms });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/terms of service/i);
    expect(store.size).toBe(0);
  });

  test.each([
    ["client", "clients/id1"],
    ["worker", "workers/id1"],
  ])("records the terms version and time for a %s", async (role, path) => {
    await request(app).post("/api/auth/register").send({ ...valid, role });

    expect(store.get(path)).toMatchObject({ termsVersion: CURRENT_TERMS_VERSION });
    expect(store.get(path)?.termsAcceptedAt).toBeInstanceOf(Date);
  });

  test.each(["client", "worker"])("creates a zeroed KES wallet for a %s", async (role) => {
    await request(app).post("/api/auth/register").send({ ...valid, role });

    expect(store.get("wallets/id2")).toMatchObject({
      ownerId: "id1",
      ownerRole: role,
      currency: "KES",
      balance: 0,
      escrowBalance: 0,
    });
  });

  test("creates no wallet when the email is already taken", async () => {
    await request(app).post("/api/auth/register").send(valid);
    await request(app).post("/api/auth/register").send({ ...valid, role: "worker" });

    const wallets = [...store.keys()].filter((path) => path.startsWith("wallets/"));
    expect(wallets).toEqual(["wallets/id2"]);
  });

  test("stores workers in the workers collection", async () => {
    await request(app).post("/api/auth/register").send({ ...valid, role: "worker" });

    expect(store.has("workers/id1")).toBe(true);
    expect(store.has("clients/id1")).toBe(false);
  });

  test("stores a bcrypt hash, not the plaintext password", async () => {
    await request(app).post("/api/auth/register").send(valid);

    const saved = store.get("clients/id1")!;
    expect(saved.passwordHash).not.toBe(valid.password);
    expect(await bcrypt.compare(valid.password, saved.passwordHash)).toBe(true);
  });

  test("indexes the phone number for login and rejects a duplicate with 409", async () => {
    const first = await request(app).post("/api/auth/register").send(valid);
    const second = await request(app)
      .post("/api/auth/register")
      .send({ ...valid, email: "other@example.com", role: "worker" });

    expect(first.status).toBe(201);
    expect(store.get("phones/254712345678")).toEqual({ role: "client", userId: "id1" });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/phone/i);
    expect(store.has("emails/other@example.com")).toBe(false);
  });

  test("rejects a duplicate email with 409, even across roles", async () => {
    await request(app).post("/api/auth/register").send(valid);
    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...valid, email: "JANE@example.com", role: "worker" });

    expect(res.status).toBe(409);
    expect(store.has("workers/id2")).toBe(false);
  });

  test.each([
    ["email", { email: "not-an-email" }],
    ["phone", { phone: "12345" }],
    ["password", { password: "short" }],
    ["name", { name: "  " }],
    ["role (admin)", { role: "admin" }],
    ["role (missing)", { role: undefined }],
  ])("rejects an invalid %s with 400", async (_label, override) => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...valid, ...override });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(store.size).toBe(0);
  });
});

describe("createUser (admin seeding)", () => {
  beforeEach(() => {
    store.clear();
    nextId = 1;
  });

  test("stores an admin in the admins collection without a phone", async () => {
    const admin = await createUser({
      name: "Admin",
      email: "root@example.com",
      password: "supersecret",
      role: "admin",
    });

    expect(admin).toEqual({ id: "id1", name: "Admin", email: "root@example.com", role: "admin" });
    expect(store.get("emails/root@example.com")).toEqual({ role: "admin", userId: "id1" });
    expect(store.get("admins/id1")).not.toHaveProperty("phone");
  });

  test("does not create a wallet for an admin", async () => {
    await createUser({ name: "Admin", email: "root@example.com", password: "supersecret", role: "admin" });

    expect([...store.keys()].some((path) => path.startsWith("wallets/"))).toBe(false);
  });

  test("rejects a duplicate email", async () => {
    const input = { name: "Admin", email: "root@example.com", password: "supersecret", role: "admin" } as const;
    await createUser(input);

    await expect(createUser(input)).rejects.toMatchObject({ status: 409 });
  });
});
