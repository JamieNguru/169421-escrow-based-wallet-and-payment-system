import bcrypt from "bcryptjs";
import request from "supertest";

import { createApp } from "../src/app";
import { verifyToken } from "../src/config/jwt";

// In-memory stand-in for the Firestore calls the auth service makes.
const store = new Map<string, Record<string, any>>();

jest.mock("../src/config/firebase", () => ({
  getDb: () => ({
    collection: (name: string) => ({
      doc: (id: string) => ({
        id,
        path: `${name}/${id}`,
        get: async () => {
          const data = store.get(`${name}/${id}`);
          return { exists: data !== undefined, data: () => data };
        },
      }),
    }),
  }),
}));

const password = "supersecret";

function seed(role: "client" | "worker" | "admin", id: string, email: string) {
  const collection = { client: "clients", worker: "workers", admin: "admins" }[role];
  store.set(`emails/${email}`, { role, userId: id });
  store.set(`${collection}/${id}`, {
    name: "Jane Doe",
    email,
    phone: "254712345678",
    passwordHash: bcrypt.hashSync(password, 4),
  });
}

describe("POST /api/auth/login", () => {
  const app = createApp();

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    store.clear();
    seed("client", "c1", "jane@example.com");
    seed("worker", "w1", "joe@example.com");
    seed("admin", "a1", "root@example.com");
  });

  test.each([
    ["client", "jane@example.com", "c1"],
    ["worker", "joe@example.com", "w1"],
    ["admin", "root@example.com", "a1"],
  ])("logs in a %s and returns a token for them", async (role, email, id) => {
    const res = await request(app).post("/api/auth/login").send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id, name: "Jane Doe", email, phone: "254712345678", role });
    expect(verifyToken(res.body.token)).toMatchObject({ sub: id, role });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/i);
  });

  test("treats the email case-insensitively", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: " JANE@example.com ", password });

    expect(res.status).toBe(200);
  });

  test("wrong password and unknown email give the same 401", async () => {
    const wrongPassword = await request(app)
      .post("/api/auth/login")
      .send({ email: "jane@example.com", password: "not-the-password" });
    const unknownEmail = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
    expect(wrongPassword.body.error).toBe("Invalid email or password");
  });

  test.each([
    ["missing email", { password }],
    ["invalid email", { email: "nope", password }],
    ["missing password", { email: "jane@example.com" }],
    ["empty password", { email: "jane@example.com", password: "" }],
  ])("rejects %s with 400", async (_label, body) => {
    const res = await request(app).post("/api/auth/login").send(body);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});
