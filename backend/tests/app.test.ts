import request from "supertest";

import { createApp } from "../src/app";

describe("backend app", () => {
  const app = createApp();

  test("GET /api/health returns ok", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  test("unknown routes return a JSON 404", async () => {
    const res = await request(app).get("/api/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Route not found: GET \/api\/does-not-exist/);
  });

  test("malformed JSON bodies return a JSON 400", async () => {
    const res = await request(app)
      .post("/api/health")
      .set("Content-Type", "application/json")
      .send("{not valid json");

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});
