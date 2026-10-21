import request from "supertest";

import { createApp } from "../src/app";
import { signToken } from "../src/config/jwt";
import { distanceKm } from "../src/services/jobService";

// In-memory stand-in for the Firestore calls the job endpoints make.
const store = new Map<string, Record<string, any>>();
let nextId = 1;

jest.mock("../src/config/firebase", () => ({
  getDb: () => ({
    collection: (name: string) => {
      const build = (filters: Array<[string, string, any]>, max: number) => ({
        where: (field: string, op: string, value: unknown) => build([...filters, [field, op, value]], max),
        orderBy: () => build(filters, max),
        limit: (n: number) => build(filters, n),
        get: async () => {
          const docs = [...store.entries()]
            .filter(([path]) => path.startsWith(`${name}/`))
            .map(([path, data]) => ({ id: path.split("/")[1], data: () => data }))
            .filter(({ data }) =>
              filters.every(([field, op, value]) => (op === "==" ? data()[field] === value : data()[field] < value)),
            )
            .sort((a, b) => b.data().createdAt - a.data().createdAt);
          return { empty: docs.length === 0, docs: docs.slice(0, max) };
        },
      });
      return {
        ...build([], Infinity),
        doc: (id: string = `auto${nextId++}`) => ({
          id,
          path: `${name}/${id}`,
          set: async (data: Record<string, any>) => {
            store.set(`${name}/${id}`, data);
          },
          get: async () => {
            const data = store.get(`${name}/${id}`);
            return { exists: data !== undefined, data: () => data };
          },
        }),
      };
    },
  }),
}));

const tokenFor = (sub: string, role: "client" | "worker" | "admin") =>
  `Bearer ${signToken({ sub, role })}`;

const photo = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const body = { title: "Fix my sink", description: "Leaking tap", budget: 1500, currency: "KES" };
const kilimani = { label: "Kilimani, Nairobi", lat: -1.2921, lng: 36.7872 };

describe("job location and photos", () => {
  const app = createApp();

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    store.clear();
    nextId = 1;
  });

  const post = (payload: unknown, auth = tokenFor("client1", "client")) =>
    request(app).post("/api/jobs").set("Authorization", auth).send(payload as object);

  describe("POST /api/jobs", () => {
    test("stores the location and photos, and returns only the photo count", async () => {
      const res = await post({ ...body, location: kilimani, photos: [photo, photo] });

      expect(res.status).toBe(201);
      expect(res.body.job).toMatchObject({ location: kilimani, photoCount: 2 });
      expect(res.body.job).not.toHaveProperty("photos");
      expect(store.get("jobs/auto1")).toMatchObject({ location: kilimani, photos: [photo, photo] });
    });

    test("accepts a location label without coordinates", async () => {
      const res = await post({ ...body, location: { label: "Westlands" } });

      expect(res.status).toBe(201);
      expect(res.body.job.location).toEqual({ label: "Westlands" });
    });

    test.each([
      ["a location with no label", { location: { lat: 1, lng: 2 } }],
      ["lat without lng", { location: { label: "X", lat: 1 } }],
      ["a latitude out of range", { location: { label: "X", lat: 91, lng: 0 } }],
      ["a non-image photo", { photos: ["data:application/pdf;base64,AAAA"] }],
      ["four photos", { photos: [photo, photo, photo, photo] }],
    ])("rejects %s with 400", async (_label, extra) => {
      const res = await post({ ...body, ...extra });

      expect(res.status).toBe(400);
      expect(store.size).toBe(0);
    });
  });

  describe("GET /api/jobs/:jobId", () => {
    beforeEach(() => {
      store.set("jobs/job1", {
        clientId: "client1", ...body, status: "open", location: kilimani, photos: [photo], createdAt: new Date(),
      });
    });

    test("returns the job with its photos to any signed-in user", async () => {
      for (const auth of [tokenFor("worker1", "worker"), tokenFor("client1", "client"), tokenFor("a1", "admin")]) {
        const res = await request(app).get("/api/jobs/job1").set("Authorization", auth);

        expect(res.status).toBe(200);
        expect(res.body.job).toMatchObject({ id: "job1", title: "Fix my sink", photos: [photo], photoCount: 1 });
      }
    });

    test("is 404 for an unknown job and 401 without a token", async () => {
      expect((await request(app).get("/api/jobs/nope").set("Authorization", tokenFor("worker1", "worker"))).status).toBe(404);
      expect((await request(app).get("/api/jobs/job1")).status).toBe(401);
    });
  });

  describe("GET /api/jobs (browse) distance", () => {
    beforeEach(() => {
      const at = (minute: number) => new Date(Date.UTC(2026, 9, 12, 8, minute));
      store.set("jobs/near", { clientId: "c", ...body, status: "open", location: kilimani, photos: [photo], createdAt: at(2) });
      store.set("jobs/nolatlng", { clientId: "c", ...body, status: "open", location: { label: "Somewhere" }, createdAt: at(1) });
    });

    const browse = (query = "") => request(app).get(`/api/jobs${query}`).set("Authorization", tokenFor("worker1", "worker"));

    test("adds the distance for jobs with coordinates when the worker sends a position", async () => {
      const res = await browse("?lat=-1.3&lng=36.8");

      expect(res.status).toBe(200);
      const near = res.body.jobs.find((j: any) => j.id === "near");
      const unknown = res.body.jobs.find((j: any) => j.id === "nolatlng");
      expect(near.distanceKm).toBeGreaterThan(0);
      expect(near.distanceKm).toBeLessThan(10);
      expect(unknown).not.toHaveProperty("distanceKm");
    });

    test("lists photo counts, not photos", async () => {
      const res = await browse();

      const near = res.body.jobs.find((j: any) => j.id === "near");
      expect(near.photoCount).toBe(1);
      expect(near).not.toHaveProperty("photos");
      expect(near).not.toHaveProperty("distanceKm");
    });

    test.each([
      ["lat without lng", "?lat=1"],
      ["lng without lat", "?lng=1"],
      ["a non-numeric lat", "?lat=north&lng=1"],
      ["lat out of range", "?lat=95&lng=1"],
    ])("rejects %s with 400", async (_label, query) => {
      expect((await browse(query)).status).toBe(400);
    });
  });

  describe("GET /api/jobs/mine", () => {
    test("does not include photos", async () => {
      store.set("jobs/job1", { clientId: "client1", ...body, status: "open", photos: [photo, photo], createdAt: new Date() });

      const res = await request(app).get("/api/jobs/mine").set("Authorization", tokenFor("client1", "client"));

      expect(res.body.jobs[0].photoCount).toBe(2);
      expect(res.body.jobs[0]).not.toHaveProperty("photos");
    });
  });
});

describe("distanceKm", () => {
  test("is the straight-line distance in km, to one decimal", () => {
    // Nairobi CBD to Westlands is roughly 4 km.
    const d = distanceKm({ lat: -1.2864, lng: 36.8172 }, { lat: -1.2676, lng: 36.8108 });
    expect(d).toBeGreaterThan(1.5);
    expect(d).toBeLessThan(3);
    expect(distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
    expect(distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111.2, 0);
  });
});
