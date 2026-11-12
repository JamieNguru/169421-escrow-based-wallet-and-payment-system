import bcrypt from "bcryptjs";
import request from "supertest";

import { createApp } from "../src/app";
import { verifyToken } from "../src/config/jwt";
import { CURRENT_TERMS_VERSION } from "../src/config/terms";

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
  // Only the client is indexed by phone: the seeded users share one number.
  if (role === "client") store.set("phones/254712345678", { role, userId: id });
  store.set(`${collection}/${id}`, {
    name: "Jane Doe",
    email,
    phone: "254712345678",
    passwordHash: bcrypt.hashSync(password, 4),
    // Workers are seeded as existing users who never accepted the terms.
    ...(role === "client" && { termsVersion: CURRENT_TERMS_VERSION }),
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
    ["client", "jane@example.com", "c1", true],
    ["worker", "joe@example.com", "w1", false],
    ["admin", "root@example.com", "a1", true],
  ])("logs in a %s and returns a token for them", async (role, email, id, termsAccepted) => {
    const res = await request(app).post("/api/auth/login").send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id, name: "Jane Doe", email, phone: "254712345678", role, termsAccepted });
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
    expect(wrongPassword.body.error).toBe("Invalid email/phone or password");
  });

  test("refuses a suspended account with 403, but only once the password is right", async () => {
    store.set("clients/c1", { ...store.get("clients/c1"), status: "suspended" });

    const suspended = await request(app).post("/api/auth/login").send({ email: "jane@example.com", password });
    const wrongPassword = await request(app)
      .post("/api/auth/login")
      .send({ email: "jane@example.com", password: "not-the-password" });

    expect(suspended.status).toBe(403);
    expect(suspended.body.error).toBe("This account has been suspended");
    expect(suspended.body).not.toHaveProperty("token");
    expect(wrongPassword.status).toBe(401);
  });

  test("lets a reactivated account log in again", async () => {
    store.set("clients/c1", { ...store.get("clients/c1"), status: "active" });

    const res = await request(app).post("/api/auth/login").send({ email: "jane@example.com", password });

    expect(res.status).toBe(200);
  });

  test.each([
    ["0712345678", "a local number"],
    ["+254712345678", "an international number"],
    ["0712 345 678", "a number with spaces"],
  ])("logs in with %s (%s)", async (identifier) => {
    const res = await request(app).post("/api/auth/login").send({ identifier, password });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: "c1", role: "client", phone: "254712345678" });
    expect(verifyToken(res.body.token)).toMatchObject({ sub: "c1", role: "client" });
  });

  test("accepts an email in the identifier field", async () => {
    const res = await request(app).post("/api/auth/login").send({ identifier: "jane@example.com", password });

    expect(res.status).toBe(200);
  });

  test("an unknown phone number and a wrong password give the same 401", async () => {
    const unknown = await request(app).post("/api/auth/login").send({ identifier: "0799000000", password });
    const wrong = await request(app).post("/api/auth/login").send({ identifier: "0712345678", password: "nope" });

    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  test.each([
    ["missing email", { password }],
    ["invalid email", { email: "nope", password }],
    ["not a Kenyan number", { identifier: "12345", password }],
    ["missing password", { email: "jane@example.com" }],
    ["empty password", { email: "jane@example.com", password: "" }],
  ])("rejects %s with 400", async (_label, body) => {
    const res = await request(app).post("/api/auth/login").send(body);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});
