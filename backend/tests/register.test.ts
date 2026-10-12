import bcrypt from "bcryptjs";
import request from "supertest";

import { createApp } from "../src/app";
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
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
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

  test("rejects a duplicate email", async () => {
    const input = { name: "Admin", email: "root@example.com", password: "supersecret", role: "admin" } as const;
    await createUser(input);

    await expect(createUser(input)).rejects.toMatchObject({ status: 409 });
  });
});
