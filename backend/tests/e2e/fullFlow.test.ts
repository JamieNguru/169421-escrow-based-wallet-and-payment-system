import request from "supertest";

import { createApp } from "../../src/app";
import { signToken } from "../../src/config/jwt";
import { createMemoryDb } from "../helpers/memoryDb";

// Every route, service and middleware here is real. Only the database (in memory),
// the M-Pesa payout call and the trust-scoring service are replaced.
const memory = createMemoryDb();
jest.mock("../../src/config/firebase", () => ({ getDb: () => memory.db }));
jest.mock("../../src/services/darajaService", () => ({
  ...jest.requireActual("../../src/services/darajaService"),
  initiateB2C: jest.fn(async () => ({ conversationId: "conv-1" })),
}));

const PHOTO = "data:image/png;base64,iVBORw0KGgo=";
const app = createApp();
const api = request(app);

interface User {
  id: string;
  token: string;
  auth: string;
}

const bearer = (token: string) => `Bearer ${token}`;
let counter = 0;

async function register(role: "client" | "worker", name: string): Promise<User> {
  counter += 1;
  const email = `${name.toLowerCase()}${counter}@example.com`;
  const phone = `0712${String(counter).padStart(6, "0")}`;
  const created = await api
    .post("/api/auth/register")
    .send({ name, email, phone, password: "password123", role, acceptTerms: true });
  expect(created.status).toBe(201);
  const login = await api.post("/api/auth/login").send({ email, password: "password123" });
  expect(login.status).toBe(200);
  return { id: created.body.id, token: login.body.token, auth: bearer(login.body.token) };
}

const admin = (): User => {
  const token = signToken({ sub: "admin1", role: "admin" });
  return { id: "admin1", token, auth: bearer(token) };
};

async function verifyWorker(worker: User, fullName: string) {
  const res = await api
    .post("/api/kyc")
    .set("Authorization", worker.auth)
    .send({
      fullName,
      idType: "national_id",
      idNumber: String(30000000 + counter),
      dateOfBirth: "1995-04-12",
      consent: true,
      images: { front: PHOTO, back: PHOTO, selfie: PHOTO },
    });
  expect(res.status).toBe(201);
  expect(res.body.kyc?.status ?? res.body.status).toBe("verified");
}

async function topUp(client: User, amount: number) {
  const res = await api.post("/api/payments/top-up").set("Authorization", client.auth).send({ amount });
  expect(res.status).toBe(202);
  const id = res.body.payment.checkoutRequestId;
  const settled = await api
    .post(`/api/payments/${id}/simulate`)
    .set("Authorization", client.auth)
    .send({ outcome: "success" });
  expect(settled.status).toBe(200);
  expect(settled.body.payment.status).toBe("completed");
}

const walletOf = async (user: User) => (await api.get("/api/wallet").set("Authorization", user.auth)).body.wallet;

async function postAndAssign(client: User, worker: User, price: number): Promise<string> {
  const posted = await api
    .post("/api/jobs")
    .set("Authorization", client.auth)
    .send({ title: "Fix the sink", description: "Leaking tap", budget: price + 200, currency: "KES" });
  expect(posted.status).toBe(201);
  const jobId = posted.body.job.id;

  const applied = await api.post(`/api/jobs/${jobId}/apply`).set("Authorization", worker.auth).send({ price });
  expect(applied.status).toBe(201);

  const selected = await api.post(`/api/jobs/${jobId}/select`).set("Authorization", client.auth).send({ workerId: worker.id });
  expect(selected.status).toBe(200);
  return jobId;
}

const fund = (client: User, worker: User, jobId: string) =>
  api.post("/api/escrow/fund").set("Authorization", client.auth).send({ jobId, workerId: worker.id });

async function deliver(client: User, worker: User, jobId: string) {
  const done = await api.post(`/api/escrow/${jobId}/complete`).set("Authorization", worker.auth);
  expect(done.status).toBe(200);
  const confirmed = await api.post(`/api/escrow/${jobId}/confirm`).set("Authorization", client.auth);
  expect(confirmed.status).toBe(200);
  expect(confirmed.body.escrow.status).toBe("completed");
}

describe("end-to-end: auth, jobs, wallet, escrow, disputes, admin and trust", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DARAJA_SIMULATE = "true";
    process.env.DARAJA_B2C_CALLBACK_SECRET = "b2c-secret";
    memory.reset();
    counter = 0;
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ trust_level: "High", probabilities: { High: 0.9, Medium: 0.08, Low: 0.02 } }),
    })) as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  test("a job goes from posting to payout and both wallets balance", async () => {
    const client = await register("client", "Amina");
    const worker = await register("worker", "Brian");
    await verifyWorker(worker, "Brian");

    await topUp(client, 2000);
    expect(await walletOf(client)).toMatchObject({ balance: 2000, escrowBalance: 0 });

    const jobId = await postAndAssign(client, worker, 1500);
    const funded = await fund(client, worker, jobId);
    expect(funded.status).toBe(201);
    expect(await walletOf(client)).toMatchObject({ balance: 500, escrowBalance: 1500 });

    await deliver(client, worker, jobId);
    expect(await walletOf(client)).toMatchObject({ balance: 500, escrowBalance: 0 });
    expect(await walletOf(worker)).toMatchObject({ balance: 1500, escrowBalance: 0 });

    const history = await api.get("/api/transactions").set("Authorization", worker.auth);
    expect(history.status).toBe(200);
    expect(JSON.stringify(history.body)).toContain("escrow_release");

    const withdrawn = await api.post("/api/payments/withdraw").set("Authorization", worker.auth).send({ amount: 1000 });
    expect(withdrawn.status).toBe(202);
    expect(await walletOf(worker)).toMatchObject({ balance: 500 });

    const id = withdrawn.body.withdrawal.originatorConversationId;
    const result = await api
      .post("/api/payments/b2c/result/b2c-secret")
      .send({ Result: { ResultCode: 0, OriginatorConversationID: id, TransactionID: "RCP123" } });
    expect(result.status).toBe(200);
    expect(memory.store.get(`withdrawals/${id}`)).toMatchObject({ status: "completed", receipt: "RCP123" });
  });

  test("a client pays escrow by M-Pesa prompt instead of from the wallet", async () => {
    const client = await register("client", "Amina");
    const worker = await register("worker", "Brian");
    await verifyWorker(worker, "Brian");
    const jobId = await postAndAssign(client, worker, 800);

    const prompt = await api
      .post("/api/payments/stk-push")
      .set("Authorization", client.auth)
      .send({ jobId, workerId: worker.id });
    expect(prompt.status).toBe(202);
    await api
      .post(`/api/payments/${prompt.body.payment.checkoutRequestId}/simulate`)
      .set("Authorization", client.auth)
      .send({ outcome: "success" })
      .expect(200);

    const escrow = await api.get(`/api/escrow/${jobId}`).set("Authorization", client.auth);
    expect(escrow.body.escrow).toMatchObject({ status: "in_escrow", amount: 800 });
    expect(await walletOf(client)).toMatchObject({ balance: 0, escrowBalance: 800 });
  });

  test("terms and identity checks gate the money and job routes", async () => {
    const client = await register("client", "Amina");
    const worker = await register("worker", "Brian");

    // Accepted at registration; take it back to test the gate on its own.
    memory.store.set(`clients/${client.id}`, { ...memory.store.get(`clients/${client.id}`), termsVersion: "old" });
    const blocked = await api.post("/api/payments/top-up").set("Authorization", client.auth).send({ amount: 100 });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error ?? blocked.body.message).toMatch(/terms/i);

    await api.post("/api/auth/accept-terms").set("Authorization", client.auth).expect(200);
    await topUp(client, 100);

    const posted = await api
      .post("/api/jobs")
      .set("Authorization", client.auth)
      .send({ title: "Paint", description: "One room", budget: 500, currency: "KES" });
    const unverified = await api
      .post(`/api/jobs/${posted.body.job.id}/apply`)
      .set("Authorization", worker.auth)
      .send({ price: 400 });
    expect(unverified.status).toBe(403);
  });

  test("a dispute is raised, resolved by an admin, and the money follows the decision", async () => {
    const client = await register("client", "Amina");
    const worker = await register("worker", "Brian");
    await verifyWorker(worker, "Brian");
    await topUp(client, 1000);
    const jobId = await postAndAssign(client, worker, 1000);
    await fund(client, worker, jobId).expect(201);
    await api.post(`/api/escrow/${jobId}/complete`).set("Authorization", worker.auth).expect(200);

    const raised = await api
      .post(`/api/escrow/${jobId}/dispute`)
      .set("Authorization", client.auth)
      .send({ reason: "Tap still leaks", photos: [PHOTO] });
    expect(raised.status).toBe(201);

    const staff = admin();
    const listed = await api.get("/api/admin/disputes").set("Authorization", staff.auth);
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).toContain(jobId);

    const resolved = await api
      .post(`/api/escrow/${jobId}/resolve-dispute`)
      .set("Authorization", staff.auth)
      .send({ decision: "split", clientAmount: 400, resolution: "Part of the work was done" });
    expect(resolved.status).toBe(200);

    expect(await walletOf(client)).toMatchObject({ balance: 400, escrowBalance: 0 });
    expect(await walletOf(worker)).toMatchObject({ balance: 600, escrowBalance: 0 });

    const overview = await api.get("/api/admin/overview").set("Authorization", staff.auth);
    expect(overview.status).toBe(200);
  });

  test("a refund request is approved by an admin and the client gets the money back", async () => {
    const client = await register("client", "Amina");
    const worker = await register("worker", "Brian");
    await verifyWorker(worker, "Brian");
    await topUp(client, 900);
    const jobId = await postAndAssign(client, worker, 900);
    await fund(client, worker, jobId).expect(201);

    const asked = await api
      .post(`/api/escrow/${jobId}/refund-request`)
      .set("Authorization", client.auth)
      .send({ reason: "Worker never showed up" });
    expect(asked.status).toBe(201);

    const staff = admin();
    const queue = await api.get("/api/admin/refund-requests").set("Authorization", staff.auth);
    expect(queue.status).toBe(200);
    expect(JSON.stringify(queue.body)).toContain(jobId);

    await api.post(`/api/escrow/${jobId}/process-refund`).set("Authorization", staff.auth).expect(200);
    expect(await walletOf(client)).toMatchObject({ balance: 900, escrowBalance: 0 });
    expect((await api.get(`/api/escrow/${jobId}`).set("Authorization", client.auth)).body.escrow.status).toBe("refunded");
  });

  test("trust score is New until three jobs settle, then comes from the scoring service", async () => {
    const client = await register("client", "Amina");
    const worker = await register("worker", "Brian");
    await verifyWorker(worker, "Brian");
    await topUp(client, 3000);

    const before = await api.get("/api/trust-score/me").set("Authorization", worker.auth);
    expect(before.status).toBe(200);
    expect(before.body.trustLevel ?? before.body.trustScore?.trustLevel).toBe("New");

    for (let i = 0; i < 3; i += 1) {
      const jobId = await postAndAssign(client, worker, 1000);
      await fund(client, worker, jobId).expect(201);
      await deliver(client, worker, jobId);
    }

    const worked = await api.get("/api/trust-score/me").set("Authorization", worker.auth);
    expect(worked.status).toBe(200);
    expect(JSON.stringify(worked.body)).toContain("High");
    expect(global.fetch).toHaveBeenCalled();

    const asAdmin = await api.get(`/api/trust-score/${client.id}?role=client`).set("Authorization", admin().auth);
    expect(asAdmin.status).toBe(200);
  });
});
