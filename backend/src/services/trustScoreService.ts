import { getDb } from "../config/firebase";
import { getMlServiceUrl } from "../config/mlService";
import { HttpError } from "../errors";
import { toDate } from "./escrowService";

const COLLECTIONS = { client: "clients", worker: "workers" } as const;
const REQUEST_TIMEOUT_MS = 5000;
const UNAVAILABLE = "trust scoring unavailable";

export type ScoredRole = keyof typeof COLLECTIONS;

// A user needs this many settled jobs (paid out, refunded or split) before the
// model scores them. With less history the numbers mean nothing: the models
// were trained on users with hundreds of transactions, and a new account's
// zero history looks to them like a bad one.
export const MIN_FINISHED_JOBS = 3;

export const NEW_LEVEL = "New";

export interface TrustScore {
  userId: string;
  role: ScoredRole;
  // "High", "Medium" or "Low" from the model, or "New" while there is too little history.
  trustLevel: string;
  probabilities: Record<string, number>;
  // Settled jobs so far: for "New", how many more are needed; for a scored user, what the score rests on.
  finishedJobs?: number;
  jobsNeeded?: number;
  // The model's inputs, so a score can be explained. Not sent for "New".
  features?: Record<string, number>;
}

const HOUR_MS = 3_600_000;
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined);
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

// Fallbacks for a feature that can't be worked out yet (for example, no job
// has been submitted, so there is no response time). They sit near the middle
// of the training data, so a missing value doesn't push a score either way.
const NEUTRAL: Record<ScoredRole, Record<string, number>> = {
  worker: { job_completion_rate: 0.99, dispute_rate: 0.01, delivery_overrun: 0 },
  client: { payment_completion_rate: 0.99, refund_rate: 0.01, escrow_release_time_hours: 9 },
};

interface History {
  features: Record<string, number>;
  finishedJobs: number;
  // True when the user document carries hand-set trustStats (demo data).
  overridden: boolean;
}

type Doc = { data: () => Record<string, any> };

const hoursBetween = (from: unknown, to: unknown) =>
  from && to ? (toDate(to).getTime() - toDate(from).getTime()) / HOUR_MS : undefined;

// Works out the model's inputs from what the user has actually done on the
// platform: their escrows, the disputes against or raised by them, and (for
// clients) their refund requests. A stored `trustStats` field on the user
// still wins, so demo accounts can be given any history.
export async function getTrustHistory(userId: string, role: ScoredRole): Promise<History> {
  const db = getDb();
  const userDoc = await db.collection(COLLECTIONS[role]).doc(userId).get();
  const user = userDoc.data();
  if (!userDoc.exists || !user) {
    throw new HttpError(404, "User not found");
  }

  if (user.trustStats) {
    return { features: { ...NEUTRAL[role], ...user.trustStats }, finishedJobs: MIN_FINISHED_JOBS, overridden: true };
  }

  const party = role === "worker" ? "workerId" : "clientId";
  const [escrowSnap, disputeSnap, refundSnap, jobSnap] = await Promise.all([
    db.collection("escrows").where(party, "==", userId).get(),
    db.collection("disputes").where(party, "==", userId).get(),
    role === "client" ? db.collection("refundRequests").where("clientId", "==", userId).get() : undefined,
    role === "worker" ? db.collection("jobs").where("workerId", "==", userId).get() : undefined,
  ]);

  const escrows = (escrowSnap.docs as Doc[]).map((d) => d.data());
  const paidOut = escrows.filter((e) => e.status === "completed" || e.status === "split").length;
  const refunded = escrows.filter((e) => e.status === "refunded").length;
  const finishedJobs = paidOut + refunded;
  const completionRate = finishedJobs ? paidOut / finishedJobs : undefined;

  if (role === "worker") {
    // A dispute against the worker counts whoever raised it.
    const disputes = disputeSnap.docs.length;
    // How far past the promised delivery time each submitted job ran, as a share of
    // that time (0 when on time). Jobs without a promise, or not yet submitted, are skipped.
    const promised = new Map<string, number>();
    for (const doc of jobSnap?.docs ?? []) {
      const hours = doc.data().agreedDeliveryHours;
      if (typeof hours === "number" && hours > 0) promised.set(doc.id, hours);
    }
    const overrun = mean(
      escrows.flatMap((e) => {
        const took = hoursBetween(e.fundedAt, e.workSubmittedAt);
        const allowed = promised.get(e.jobId);
        return took === undefined || allowed === undefined ? [] : [Math.max(0, took - allowed) / allowed];
      }),
    );
    return {
      features: {
        job_completion_rate: completionRate ?? NEUTRAL.worker.job_completion_rate,
        dispute_rate: escrows.length ? clamp01(disputes / escrows.length) : NEUTRAL.worker.dispute_rate,
        delivery_overrun: overrun ?? NEUTRAL.worker.delivery_overrun,
      },
      finishedJobs,
      overridden: false,
    };
  }

  // For a client: disputes they raised and refunds they asked for both count against them.
  const raised = (disputeSnap.docs as Doc[]).filter((d) => d.data().raisedByRole === "client").length;
  const refundRequests = refundSnap?.docs.length ?? 0;
  const release = mean(
    escrows
      .filter((e) => e.status === "completed")
      .map((e) => hoursBetween(e.workSubmittedAt, e.completedAt))
      .filter((h): h is number => h !== undefined),
  );
  return {
    features: {
      payment_completion_rate: completionRate ?? NEUTRAL.client.payment_completion_rate,
      refund_rate: escrows.length ? clamp01((raised + refundRequests) / escrows.length) : NEUTRAL.client.refund_rate,
      escrow_release_time_hours: release ?? NEUTRAL.client.escrow_release_time_hours,
    },
    finishedJobs,
    overridden: false,
  };
}

export async function getTrustScore(userId: string, role: ScoredRole): Promise<TrustScore> {
  const { features, finishedJobs, overridden } = await getTrustHistory(userId, role);

  // Too little history to judge: say so, instead of letting the model call it Low.
  if (!overridden && finishedJobs < MIN_FINISHED_JOBS) {
    return {
      userId,
      role,
      trustLevel: NEW_LEVEL,
      probabilities: {},
      finishedJobs,
      jobsNeeded: MIN_FINISHED_JOBS - finishedJobs,
    };
  }

  let body: { trust_level?: unknown; probabilities?: unknown };
  try {
    const res = await fetch(`${getMlServiceUrl()}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, features }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`score service responded ${res.status}`);
    }
    body = await res.json();
  } catch (err) {
    console.error("Trust score request failed:", err);
    throw new HttpError(503, UNAVAILABLE);
  }

  if (typeof body.trust_level !== "string" || typeof body.probabilities !== "object") {
    throw new HttpError(503, UNAVAILABLE);
  }

  return {
    userId,
    role,
    trustLevel: body.trust_level,
    probabilities: body.probabilities as Record<string, number>,
    features,
    ...(!overridden && { finishedJobs }),
  };
}
