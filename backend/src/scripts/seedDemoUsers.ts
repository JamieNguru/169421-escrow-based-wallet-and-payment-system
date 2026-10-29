import "dotenv/config";

import { FieldValue } from "firebase-admin/firestore";

import { getDb } from "../config/firebase";
import { createUser } from "../services/userService";

type Tier = "high" | "medium" | "low" | "new";

// How a settled job ended. Each maps to the records the trust score reads:
// "client_dispute_*" leaves a dispute the client raised, "refund_request" a
// refund request, and the rest are plain paid-out jobs.
type Outcome = "completed" | "refund_request" | "client_dispute_split" | "client_dispute_refund";

interface History {
  outcomes: Outcome[];
  // Hours the worker promised to deliver within, on average hours from funding to submitting, and from submitting to the client releasing.
  promisedHours: number;
  responseHours: number;
  releaseHours: number;
  // Defaults: amounts of KES 1,500 to 4,500, funded evenly over the last 90 days (up to 10 days before today).
  amount?: (i: number) => number;
  ageDays?: number;
  spreadDays?: number;
}

const completed = (n: number): Outcome[] => Array(n).fill("completed");

const HISTORIES: Record<Tier, History> = {
  high: { outcomes: completed(20), promisedHours: 24, responseHours: 3, releaseHours: 2 },
  medium: {
    outcomes: [...completed(19), "client_dispute_split"],
    promisedHours: 12,
    responseHours: 14,
    releaseHours: 10,
  },
  low: {
    outcomes: [
      ...completed(12),
      ...Array<Outcome>(3).fill("refund_request"),
      ...Array<Outcome>(3).fill("client_dispute_split"),
      ...Array<Outcome>(2).fill("client_dispute_refund"),
    ],
    promisedHours: 24,
    responseHours: 40,
    releaseHours: 48,
  },
  // Below the 3 settled jobs a score needs, so these show "New".
  new: { outcomes: completed(2), promisedHours: 24, responseHours: 6, releaseHours: 4 },
};

// A pair that trips the compliance flags: twelve jobs of KES 9,500 (each just under KES 10,000)
// inside ten days, then two refunds after the work was delivered. The worker has no tax PIN.
const WATCH_HISTORY: History = {
  outcomes: [...completed(12), "refund_request", "refund_request"],
  promisedHours: 24,
  responseHours: 6,
  releaseHours: 4,
  amount: () => 9500,
  ageDays: 30,
  spreadDays: 12,
};

const TIERS = Object.keys(HISTORIES) as Tier[];
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const email = (role: "worker" | "client", tier: string) => `${role}.${tier}@demo.test`;

async function ensureUser(role: "worker" | "client", tier: string, password: string): Promise<string> {
  const db = getDb();
  const name = `Demo ${role === "worker" ? "Worker" : "Client"} ${tier[0].toUpperCase()}${tier.slice(1)}`;
  try {
    const created = await createUser({ name, email: email(role, tier), role, password, acceptTerms: true });
    console.log(`Created ${role} ${created.email} (${created.id})`);
    return created.id;
  } catch (err: any) {
    if (err.status !== 409) throw err;
    const id = (await db.collection("emails").doc(email(role, tier)).get()).data()?.userId as string;
    // Earlier versions of this script hand-set the score inputs; drop them so the history decides.
    await db.collection(role === "worker" ? "workers" : "clients").doc(id).update({ trustStats: FieldValue.delete() });
    console.log(`Found ${role} ${email(role, tier)} (${id})`);
    return id;
  }
}

// Writes the worker's and client's jobs, escrows, disputes and refund requests in
// their settled states, with timestamps spread over the last 90 days. The ids are
// fixed per tier, so re-running replaces rather than duplicates them. Wallet
// balances and the ledger are left alone.
async function seedHistory(tier: string, clientId: string, workerId: string, history: History) {
  const db = getDb();
  const { outcomes, promisedHours, responseHours, releaseHours, ageDays = 90, spreadDays = 80 } = history;
  const now = Date.now();

  for (const [i, outcome] of outcomes.entries()) {
    const jobId = `demo-${tier}-${String(i + 1).padStart(2, "0")}`;
    const amount = history.amount?.(i) ?? 1500 + (i % 5) * 750;
    const spread = (i % 3) - 1; // varies the times a little around the tier's average
    const fundedAt = new Date(now - (ageDays - Math.floor((i * spreadDays) / outcomes.length)) * DAY_MS);
    const submittedAt = new Date(fundedAt.getTime() + Math.max(1, responseHours + spread) * HOUR_MS);
    const settledAt = new Date(submittedAt.getTime() + Math.max(1, releaseHours + spread) * HOUR_MS);

    // Clear what an earlier run may have left for this job, since the outcome can change.
    await Promise.all([db.collection("disputes").doc(jobId).delete(), db.collection("refundRequests").doc(jobId).delete()]);

    await db.collection("jobs").doc(jobId).set({
      clientId,
      workerId,
      title: `Demo job ${i + 1}`,
      description: "Seeded history for the trust score demo.",
      budget: amount,
      currency: "KES",
      status: "assigned",
      agreedPrice: amount,
      agreedCurrency: "KES",
      agreedDeliveryHours: promisedHours,
      createdAt: fundedAt,
    });

    const escrow: Record<string, unknown> = {
      jobId,
      clientId,
      workerId,
      amount,
      currency: "KES",
      createdAt: fundedAt,
      fundedAt,
      workSubmittedAt: submittedAt,
    };
    const dispute = (decision: "split" | "refund") => ({
      jobId,
      clientId,
      workerId,
      amount,
      currency: "KES",
      raisedBy: clientId,
      raisedByRole: "client",
      reason: "Work did not match the agreed job",
      previousStatus: "work_submitted",
      status: "resolved",
      decision,
      resolution: "Seeded demo resolution",
      createdAt: submittedAt,
      resolvedAt: settledAt,
    });

    if (outcome === "completed") {
      Object.assign(escrow, { status: "completed", completedAt: settledAt });
    } else if (outcome === "refund_request") {
      Object.assign(escrow, { status: "refunded", refundedAt: settledAt });
      await db.collection("refundRequests").doc(jobId).set({
        jobId,
        clientId,
        workerId,
        amount,
        currency: "KES",
        reason: "Worker did not deliver",
        status: "approved",
        createdAt: submittedAt,
        processedAt: settledAt,
      });
    } else if (outcome === "client_dispute_split") {
      const clientAmount = amount / 2;
      Object.assign(escrow, { status: "split", completedAt: settledAt, disputedAt: submittedAt, clientAmount, workerAmount: amount - clientAmount });
      await db.collection("disputes").doc(jobId).set({ ...dispute("split"), clientAmount, workerAmount: amount - clientAmount });
    } else {
      Object.assign(escrow, { status: "refunded", refundedAt: settledAt, disputedAt: submittedAt });
      await db.collection("disputes").doc(jobId).set(dispute("refund"));
    }
    await db.collection("escrows").doc(jobId).set(escrow);

    // The ledger entries the real flow would have written, so statements have something to add up.
    const entry = (id: string, type: string, entryAmount: number, to: string, createdAt: Date) =>
      db.collection("transactions").doc(`${id}-${jobId}`).set({
        jobId,
        type,
        amount: entryAmount,
        currency: "KES",
        fromUserId: clientId,
        toUserId: to,
        createdAt,
      });
    await entry("fund", "escrow_fund", amount, workerId, fundedAt);
    if (outcome === "completed") {
      await entry("release", "escrow_release", amount, workerId, settledAt);
    } else if (outcome === "client_dispute_split") {
      await entry("refund", "escrow_refund", amount / 2, clientId, settledAt);
      await entry("release", "escrow_release", amount / 2, workerId, settledAt);
    } else {
      await entry("refund", "escrow_refund", amount, clientId, settledAt);
    }
  }
  console.log(`Seeded ${outcomes.length} settled jobs for the ${tier} pair`);
}

interface OpenJob {
  title: string;
  description: string;
  budget: number;
  // What each demo worker quotes: price in KES and hours promised.
  quotes: Record<Tier, { price: number; deliveryHours: number }>;
}

const OPEN_JOBS: OpenJob[] = [
  {
    title: "Fix a leaking kitchen tap",
    description: "The tap under the sink drips constantly. Needs a new washer or tap.",
    budget: 1500,
    quotes: {
      high: { price: 1400, deliveryHours: 24 },
      medium: { price: 1200, deliveryHours: 12 },
      low: { price: 900, deliveryHours: 6 },
      new: { price: 1300, deliveryHours: 24 },
    },
  },
  {
    title: "Paint a garden fence",
    description: "About 20 metres of wooden fence, two coats. Paint supplied.",
    budget: 6000,
    quotes: {
      high: { price: 6500, deliveryHours: 72 },
      medium: { price: 5500, deliveryHours: 48 },
      low: { price: 4000, deliveryHours: 24 },
      new: { price: 5800, deliveryHours: 72 },
    },
  },
  {
    title: "Assemble four office desks",
    description: "Flat-pack desks, tools provided. Should take a day.",
    budget: 4000,
    quotes: {
      high: { price: 4200, deliveryHours: 36 },
      medium: { price: 3800, deliveryHours: 24 },
      low: { price: 3000, deliveryHours: 12 },
      new: { price: 3900, deliveryHours: 36 },
    },
  },
];

// Open jobs from the high-trust demo client, each with a quote from all four demo
// workers, so choosing between workers shows their trust levels and delivery times.
// The cheapest, fastest quote comes from the low-trust worker on purpose. Fixed ids,
// so re-running replaces them (and puts their applications back to pending).
async function seedOpenJobs(clientId: string, workerIds: Record<Tier, string>) {
  const db = getDb();
  for (const [i, job] of OPEN_JOBS.entries()) {
    const jobId = `demo-open-${i + 1}`;
    const createdAt = new Date(Date.now() - (i + 1) * DAY_MS);
    await db.collection("jobs").doc(jobId).set({
      clientId,
      title: job.title,
      description: job.description,
      budget: job.budget,
      currency: "KES",
      status: "open",
      createdAt,
    });
    for (const tier of TIERS) {
      const workerId = workerIds[tier];
      await db.collection("applications").doc(`${jobId}_${workerId}`).set({
        jobId,
        workerId,
        price: job.quotes[tier].price,
        currency: "KES",
        deliveryHours: job.quotes[tier].deliveryHours,
        status: "pending",
        createdAt: new Date(createdAt.getTime() + (TIERS.indexOf(tier) + 1) * HOUR_MS),
      });
    }
  }
  console.log(`Seeded ${OPEN_JOBS.length} open jobs with ${TIERS.length} quotes each`);
}

// A verified identity record with obviously fake details, with or without a tax PIN.
async function seedVerified(workerId: string, fullName: string, taxPin?: string) {
  const now = new Date();
  await getDb()
    .collection("kyc")
    .doc(workerId)
    .set({
      status: "verified",
      fullName,
      idType: "national_id",
      idNumber: "00000000",
      dateOfBirth: "1990-01-01",
      ...(taxPin && { taxPin }),
      consent: true,
      consentAt: now,
      reasons: [],
      submittedAt: now,
      verifiedAt: now,
    });
  console.log(`Verified ${fullName}${taxPin ? " with a tax PIN" : " without a tax PIN"}`);
}

// Withdrawals are paid to the worker's registered phone, so the one that tries a withdrawal needs
// one. This is Safaricom's public Daraja sandbox test number, not a real person's.
const SANDBOX_PHONE = "254708374149";

async function setPhone(workerId: string, phone: string) {
  const db = getDb();
  await db.collection("phones").doc(phone).set({ role: "worker", userId: workerId });
  await db.collection("workers").doc(workerId).update({ phone });
  console.log(`Set phone ${phone}`);
}

async function setBalance(ownerId: string, balance: number) {
  const wallets = await getDb().collection("wallets").where("ownerId", "==", ownerId).limit(1).get();
  await wallets.docs[0].ref.update({ balance });
  console.log(`Set wallet balance to KES ${balance.toLocaleString("en-KE")}`);
}

// Creates a worker and a client for each trust level (high, medium, low, plus a
// "new" pair with too little history to be scored) and gives each pair a settled
// job history, so the score is worked out from real records instead of being
// hand-set. They share the DEMO_PASSWORD from .env. Run `npm run seed:demo`;
// re-running keeps the accounts and rewrites the histories.
async function main() {
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error("Set DEMO_PASSWORD (at least 8 characters) in .env");
  }

  const workerIds = {} as Record<Tier, string>;
  const clientIds = {} as Record<Tier, string>;
  for (const tier of TIERS) {
    workerIds[tier] = await ensureUser("worker", tier, password);
    clientIds[tier] = await ensureUser("client", tier, password);
    await seedHistory(tier, clientIds[tier], workerIds[tier], HISTORIES[tier]);
  }
  await seedOpenJobs(clientIds.high, workerIds);

  // The tax and compliance demo. worker.high has a tax PIN on file; worker.watch has none, plenty
  // of money in the wallet, and the flagged history, so a big withdrawal is stopped until they add one.
  const watchWorker = await ensureUser("worker", "watch", password);
  const watchClient = await ensureUser("client", "watch", password);
  await seedHistory("watch", watchClient, watchWorker, WATCH_HISTORY);
  await seedVerified(workerIds.high, "Demo Worker High", "A123456789Z");
  await seedVerified(watchWorker, "Demo Worker Watch");
  await setBalance(watchWorker, 150_000);
  await setPhone(watchWorker, SANDBOX_PHONE);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
