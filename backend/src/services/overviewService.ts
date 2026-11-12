import { getDb } from "../config/firebase";
import { toDate } from "./escrowService";
import { getTrustScore, type ScoredRole } from "./trustScoreService";

const TRUST_BATCH_SIZE = 10;

type Counts = Record<string, number>;
type Amounts = Record<string, number>;

export interface PlatformOverview {
  jobs: { total: number; byStatus: Counts };
  escrows: {
    total: number;
    byStatus: Counts;
    // Money per currency: held covers in_escrow, work_submitted and disputed.
    amounts: { held: Amounts; released: Amounts; refunded: Amounts };
  };
  payments: { total: number; byStatus: Counts };
  withdrawals: { total: number; byStatus: Counts };
  disputes: { total: number; open: number; resolved: number };
  refundRequests: { total: number; pending: number; approved: number };
  trust: {
    scored: number;
    unavailable: number;
    byLevel: Record<ScoredRole, Counts>;
    // Users the model rates Low, for the admin watch list.
    lowTrustUsers: Array<{ id: string; role: ScoredRole; name?: string }>;
  };
  // Day figures use East Africa Time (UTC+3), where the platform operates.
  activity: { paymentsToday: number; failedPaymentsToday: number; activeUsers: number };
}

type Doc = { id: string; data: () => Record<string, any> };

async function readAll(collection: string): Promise<Doc[]> {
  return (await getDb().collection(collection).get()).docs as Doc[];
}

function countBy(docs: Doc[], field: string): Counts {
  const counts: Counts = {};
  for (const doc of docs) {
    const value = String(doc.data()[field] ?? "unknown");
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function sumByCurrency(docs: Doc[], amountOf: (data: Record<string, any>) => number = (d) => d.amount ?? 0): Amounts {
  const sums: Amounts = {};
  for (const doc of docs) {
    const data = doc.data();
    const currency = data.currency ?? "unknown";
    sums[currency] = (sums[currency] ?? 0) + amountOf(data);
  }
  return sums;
}

const mergeAmounts = (a: Amounts, b: Amounts): Amounts => {
  const merged = { ...a };
  for (const [currency, amount] of Object.entries(b)) merged[currency] = (merged[currency] ?? 0) + amount;
  return merged;
};

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

function startOfTodayEat(now = new Date()): Date {
  const local = new Date(now.getTime() + EAT_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - EAT_OFFSET_MS);
}

// Scores users through the ML service a batch at a time so a large user base
// doesn't flood it. A user whose score can't be fetched counts as unavailable
// instead of failing the whole overview.
async function summariseTrust(users: Array<{ id: string; role: ScoredRole; name?: string }>) {
  const byLevel: Record<ScoredRole, Counts> = { client: {}, worker: {} };
  const lowTrustUsers: Array<{ id: string; role: ScoredRole; name?: string }> = [];
  let scored = 0;
  let unavailable = 0;

  for (let i = 0; i < users.length; i += TRUST_BATCH_SIZE) {
    const batch = users.slice(i, i + TRUST_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((u) => getTrustScore(u.id, u.role)));
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        unavailable++;
        continue;
      }
      const { role, trustLevel } = result.value;
      byLevel[role][trustLevel] = (byLevel[role][trustLevel] ?? 0) + 1;
      if (trustLevel === "Low") lowTrustUsers.push(batch[index]);
      scored++;
    }
  }

  return { scored, unavailable, byLevel, lowTrustUsers };
}

// Reads the collections in full and aggregates in memory, which is fine at
// this platform's scale.
export async function getPlatformOverview(): Promise<PlatformOverview> {
  const [jobs, escrows, payments, withdrawals, disputes, refundRequests, clients, workers] =
    await Promise.all([
      readAll("jobs"),
      readAll("escrows"),
      readAll("payments"),
      readAll("withdrawals"),
      readAll("disputes"),
      readAll("refundRequests"),
      readAll("clients"),
      readAll("workers"),
    ]);

  const escrowsWhere = (...statuses: string[]) =>
    escrows.filter((doc) => statuses.includes(doc.data().status));
  const disputeCounts = countBy(disputes, "status");
  const refundCounts = countBy(refundRequests, "status");

  const trust = await summariseTrust([
    ...clients.map((doc) => ({ id: doc.id, role: "client" as const, name: doc.data().name })),
    ...workers.map((doc) => ({ id: doc.id, role: "worker" as const, name: doc.data().name })),
  ]);

  const startOfDay = startOfTodayEat();
  const paymentsToday = payments.filter((doc) => toDate(doc.data().createdAt) >= startOfDay);
  const activeUsers = [...clients, ...workers].filter((doc) => doc.data().status !== "suspended");

  return {
    jobs: { total: jobs.length, byStatus: countBy(jobs, "status") },
    escrows: {
      total: escrows.length,
      byStatus: countBy(escrows, "status"),
      amounts: {
        held: sumByCurrency(escrowsWhere("in_escrow", "work_submitted", "disputed")),
        // A split escrow counts its worker share as released and its client share as refunded.
        released: mergeAmounts(
          sumByCurrency(escrowsWhere("completed")),
          sumByCurrency(escrowsWhere("split"), (d) => d.workerAmount ?? 0),
        ),
        refunded: mergeAmounts(
          sumByCurrency(escrowsWhere("refunded")),
          sumByCurrency(escrowsWhere("split"), (d) => d.clientAmount ?? 0),
        ),
      },
    },
    payments: { total: payments.length, byStatus: countBy(payments, "status") },
    withdrawals: { total: withdrawals.length, byStatus: countBy(withdrawals, "status") },
    disputes: {
      total: disputes.length,
      open: disputeCounts.open ?? 0,
      resolved: disputeCounts.resolved ?? 0,
    },
    refundRequests: {
      total: refundRequests.length,
      pending: refundCounts.pending ?? 0,
      approved: refundCounts.approved ?? 0,
    },
    trust,
    activity: {
      paymentsToday: paymentsToday.length,
      failedPaymentsToday: paymentsToday.filter((doc) => doc.data().status === "failed").length,
      activeUsers: activeUsers.length,
    },
  };
}
