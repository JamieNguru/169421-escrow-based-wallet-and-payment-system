import { getDb } from "../config/firebase";
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
  };
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

function sumByCurrency(docs: Doc[]): Amounts {
  const sums: Amounts = {};
  for (const doc of docs) {
    const { currency = "unknown", amount = 0 } = doc.data();
    sums[currency] = (sums[currency] ?? 0) + amount;
  }
  return sums;
}

// Scores users through the ML service a batch at a time so a large user base
// doesn't flood it. A user whose score can't be fetched counts as unavailable
// instead of failing the whole overview.
async function summariseTrust(users: Array<{ id: string; role: ScoredRole }>) {
  const byLevel: Record<ScoredRole, Counts> = { client: {}, worker: {} };
  let scored = 0;
  let unavailable = 0;

  for (let i = 0; i < users.length; i += TRUST_BATCH_SIZE) {
    const batch = users.slice(i, i + TRUST_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((u) => getTrustScore(u.id, u.role)));
    for (const result of results) {
      if (result.status === "rejected") {
        unavailable++;
        continue;
      }
      const { role, trustLevel } = result.value;
      byLevel[role][trustLevel] = (byLevel[role][trustLevel] ?? 0) + 1;
      scored++;
    }
  }

  return { scored, unavailable, byLevel };
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
    ...clients.map((doc) => ({ id: doc.id, role: "client" as const })),
    ...workers.map((doc) => ({ id: doc.id, role: "worker" as const })),
  ]);

  return {
    jobs: { total: jobs.length, byStatus: countBy(jobs, "status") },
    escrows: {
      total: escrows.length,
      byStatus: countBy(escrows, "status"),
      amounts: {
        held: sumByCurrency(escrowsWhere("in_escrow", "work_submitted", "disputed")),
        released: sumByCurrency(escrowsWhere("completed")),
        refunded: sumByCurrency(escrowsWhere("refunded")),
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
  };
}
