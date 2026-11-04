import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";
import { createMemoryDb } from "./helpers/memoryDb";

const memory = createMemoryDb();
jest.mock("../src/config/firebase", () => ({ getDb: () => memory.db }));

const auth = (sub: string, role: "client" | "worker" | "admin") => `Bearer ${signToken({ sub, role })}`;

describe("PATCH /api/auth/profile", () => {
  const app = createApp();

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    memory.reset();
    memory.store.set("workers/w1", { name: "Joe", email: "joe@example.com", phone: "254712345678" });
    memory.store.set("phones/254712345678", { role: "worker", userId: "w1" });
    memory.store.set("clients/c1", { name: "Jane", email: "jane@example.com", phone: "254722222222" });
    memory.store.set("phones/254722222222", { role: "client", userId: "c1" });
  });

  test("a worker can change their name and phone, and the phone index moves with it", async () => {
    const res = await request(app)
      .patch("/api/auth/profile")
      .set("Authorization", auth("w1", "worker"))
      .send({ name: "  Joe K  ", phone: "+254 799 190 503" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "w1", name: "Joe K", email: "joe@example.com", phone: "254799190503", role: "worker" });
    expect(memory.store.get("workers/w1")).toMatchObject({ name: "Joe K", phone: "254799190503" });
    expect(memory.store.has("phones/254712345678")).toBe(false);
    expect(memory.store.get("phones/254799190503")).toEqual({ role: "worker", userId: "w1" });
  });

  test("a client can change just their name", async () => {
    const res = await request(app).patch("/api/auth/profile").set("Authorization", auth("c1", "client")).send({ name: "Jane D" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Jane D", phone: "254722222222" });
    expect(memory.store.get("phones/254722222222")).toEqual({ role: "client", userId: "c1" });
  });

  test("refuses a phone number another account already uses", async () => {
    const res = await request(app).patch("/api/auth/profile").set("Authorization", auth("w1", "worker")).send({ phone: "0722222222" });

    expect(res.status).toBe(409);
    expect(memory.store.get("workers/w1")?.phone).toBe("254712345678");
    expect(memory.store.get("phones/254722222222")).toEqual({ role: "client", userId: "c1" });
  });

  test.each([
    [{}, "nothing to update"],
    [{ name: "   " }, "name is required"],
    [{ phone: "12345" }, "phone must be a Kenyan mobile number"],
  ])("rejects %j", async (body, message) => {
    const res = await request(app).patch("/api/auth/profile").set("Authorization", auth("w1", "worker")).send(body);

    expect(res.status).toBe(400);
    expect(res.body.error ?? res.body.message).toContain(message);
  });

  test("does not allow the email to be changed", async () => {
    const res = await request(app).patch("/api/auth/profile").set("Authorization", auth("w1", "worker")).send({ name: "Joe", email: "x@y.com" });

    expect(res.status).toBe(200);
    expect(memory.store.get("workers/w1")?.email).toBe("joe@example.com");
  });

  test("requires authentication and a client or worker", async () => {
    expect((await request(app).patch("/api/auth/profile").send({ name: "A" })).status).toBe(401);
    expect((await request(app).patch("/api/auth/profile").set("Authorization", auth("a1", "admin")).send({ name: "A" })).status).toBe(403);
  });
});
