import {
  EAT_OFFSET_MS,
  REFUND_AFTER_DELIVERY_MIN,
  SPLIT_JOB_LIMIT_KES,
  SPLIT_MIN_JOBS,
  SPLIT_TOTAL_KES,
  SPLIT_WINDOW_DAYS,
  TAX_PIN_THRESHOLD_KES,
} from "../config/compliance";
import { getDb } from "../config/firebase";
import { HttpError } from "../errors";
import { toDate } from "./escrowService";
import { maskTaxPin } from "./kycService";

const DAY_MS = 24 * 3_600_000;

// Start of a calendar year in Kenyan time, as a UTC instant.
const yearStart = (year: number) => Date.UTC(year, 0, 1) - EAT_OFFSET_MS;
const yearOf = (date: Date) => new Date(date.getTime() + EAT_OFFSET_MS).getUTCFullYear();
const monthOf = (date: Date) => new Date(date.getTime() + EAT_OFFSET_MS).getUTCMonth() + 1;

// --- Payout limit without a tax PIN -------------------------------------------------

// A worker with no tax PIN may withdraw up to TAX_PIN_THRESHOLD_KES in a calendar
// year; going past it needs one on their verified KYC record. Failed withdrawals
// don't count, since the money went back to the wallet.
export async function assertTaxPinForPayout(workerId: string, amount: number, now = new Date()): Promise<void> {
  const db = getDb();
  const kyc = await db.collection("kyc").doc(workerId).get();
  if (kyc.data()?.taxPin) return;

  const snap = await db.collection("withdrawals").where("workerId", "==", workerId).get();
  const year = yearOf(now);
  const withdrawnThisYear = (snap.docs as Array<{ data: () => Record<string, any> }>)
    .map((d) => d.data())
    .filter((w) => w.status !== "failed" && yearOf(toDate(w.createdAt)) === year)
    .reduce((sum, w) => sum + w.amount, 0);

  if (withdrawnThisYear + amount > TAX_PIN_THRESHOLD_KES) {
    throw new HttpError(
      403,
      `Add your tax PIN under Verification before withdrawing more than KES ${TAX_PIN_THRESHOLD_KES.toLocaleString("en-KE")} in a year`,
    );
  }
}

// --- Earnings statement -------------------------------------------------------------

export interface StatementMonth {
  month: number;
  // A worker's statement uses `received` and `withdrawn`; a client's uses `paid` and `refunded`.
  received?: number;
  withdrawn?: number;
  paid?: number;
  refunded?: number;
  jobs: number;
}

export interface Statement {
  year: number;
  role: "client" | "worker";
  currency: "KES";
  months: StatementMonth[];
  totals: { received?: number; withdrawn?: number; paid?: number; refunded?: number; jobs: number };
  // Workers only: whether a tax PIN is on file (masked) and the limit that applies without one.
  tax?: { taxPin?: string; thresholdKes: number };
}

interface LedgerEntry {
  id: string;
  type: string;
  jobId?: string;
  amount: number;
  fromUserId: string;
  toUserId: string;
  createdAt: Date;
}

const round = (value: number) => Math.round(value * 100) / 100;

// Pure: builds a statement from a user's ledger entries. Entries outside `year` are ignored.
export function buildStatement(role: "client" | "worker", year: number, entries: LedgerEntry[], userId: string): Statement {
  const months: StatementMonth[] = Array.from({ length: 12 }, (_, i) =>
    role === "worker" ? { month: i + 1, received: 0, withdrawn: 0, jobs: 0 } : { month: i + 1, paid: 0, refunded: 0, jobs: 0 },
  );
  const jobsByMonth = months.map(() => new Set<string>());

  for (const entry of entries) {
    if (yearOf(entry.createdAt) !== year) continue;
    const i = monthOf(entry.createdAt) - 1;
    const m = months[i];

    if (role === "worker") {
      if (entry.type === "escrow_release" && entry.toUserId === userId) {
        m.received! += entry.amount;
        if (entry.jobId) jobsByMonth[i].add(entry.jobId);
      } else if (entry.type === "withdrawal" && entry.fromUserId === userId) {
        m.withdrawn! += entry.amount;
      } else if (entry.type === "withdrawal_reversal" && entry.toUserId === userId) {
        m.withdrawn! -= entry.amount;
      }
    } else if (entry.type === "escrow_fund" && entry.fromUserId === userId) {
      m.paid! += entry.amount;
      if (entry.jobId) jobsByMonth[i].add(entry.jobId);
    } else if (entry.type === "escrow_refund" && entry.toUserId === userId) {
      m.refunded! += entry.amount;
    }
  }

  months.forEach((m, i) => {
    m.jobs = jobsByMonth[i].size;
    for (const key of ["received", "withdrawn", "paid", "refunded"] as const) {
      if (m[key] !== undefined) m[key] = round(m[key]!);
    }
  });

  const sum = (key: "received" | "withdrawn" | "paid" | "refunded") => round(months.reduce((t, m) => t + (m[key] ?? 0), 0));
  const jobs = months.reduce((t, m) => t + m.jobs, 0);
  return {
    year,
    role,
    currency: "KES",
    months,
    totals:
      role === "worker"
        ? { received: sum("received"), withdrawn: sum("withdrawn"), jobs }
        : { paid: sum("paid"), refunded: sum("refunded"), jobs },
  };
}

export async function getStatement(userId: string, role: "client" | "worker", year: number): Promise<Statement> {
  const db = getDb();
  const collection = db.collection("transactions");
  const [sent, received] = await Promise.all([
    collection.where("fromUserId", "==", userId).get(),
    collection.where("toUserId", "==", userId).get(),
  ]);

  // A refund is recorded from the client to the client, so it shows up in both queries.
  const byId = new Map<string, LedgerEntry>();
  for (const doc of [...sent.docs, ...received.docs]) {
    const data = doc.data();
    byId.set(doc.id, { ...(data as LedgerEntry), id: doc.id, createdAt: toDate(data.createdAt) });
  }

  const statement = buildStatement(role, year, [...byId.values()], userId);
  if (role === "worker") {
    const kyc = await db.collection("kyc").doc(userId).get();
    const taxPin = kyc.data()?.taxPin;
    statement.tax = { ...(taxPin && { taxPin: maskTaxPin(taxPin) }), thresholdKes: TAX_PIN_THRESHOLD_KES };
  }
  return statement;
}

// --- Admin flags --------------------------------------------------------------------

export type FlagType = "possible_splitting" | "no_tax_pin" | "refund_after_delivery";

export interface Party {
  role: "client" | "worker";
  id: string;
  name?: string;
}

export interface ComplianceFlag {
  type: FlagType;
  severity: "high" | "medium";
  subject: Party;
  // The other side of the jobs, for flags about a pair.
  counterparty?: Party;
  jobCount: number;
  amount: number;
  detail: string;
}

export interface EscrowRecord {
  jobId: string;
  clientId: string;
  workerId: string;
  amount: number;
  status: string;
  fundedAt: Date;
  workSubmittedAt?: Date;
  workerAmount?: number;
}

export interface FlagInput {
  escrows: EscrowRecord[];
  names: { clients: Map<string, string>; workers: Map<string, string> };
  taxPinWorkerIds: Set<string>;
  now?: Date;
}

const kes = (value: number) => `KES ${Math.round(value).toLocaleString("en-KE")}`;

// What a settled escrow paid the worker: all of it, or their share of a split.
const paidToWorker = (e: EscrowRecord) =>
  e.status === "completed" ? e.amount : e.status === "split" ? (e.workerAmount ?? e.amount / 2) : 0;

// Pure: looks for patterns an admin should look at. These are prompts to review, not proof of anything.
export function detectFlags({ escrows, names, taxPinWorkerIds, now = new Date() }: FlagInput): ComplianceFlag[] {
  const flags: ComplianceFlag[] = [];
  const worker = (id: string): Party => ({ role: "worker", id, name: names.workers.get(id) });
  const client = (id: string): Party => ({ role: "client", id, name: names.clients.get(id) });

  const pairs = new Map<string, EscrowRecord[]>();
  for (const e of escrows) {
    const key = `${e.clientId}|${e.workerId}`;
    pairs.set(key, [...(pairs.get(key) ?? []), e]);
  }

  for (const [key, jobs] of pairs) {
    const [clientId, workerId] = key.split("|");

    // Many jobs, each under the limit, that add up to a lot in a short time.
    const small = jobs
      .filter((e) => paidToWorker(e) > 0 && e.amount < SPLIT_JOB_LIMIT_KES)
      .sort((a, b) => a.fundedAt.getTime() - b.fundedAt.getTime());
    let best: EscrowRecord[] = [];
    for (let i = 0, j = 0; i < small.length; i++) {
      while (small[i].fundedAt.getTime() - small[j].fundedAt.getTime() > SPLIT_WINDOW_DAYS * DAY_MS) j++;
      const window = small.slice(j, i + 1);
      const total = window.reduce((t, e) => t + e.amount, 0);
      if (window.length >= SPLIT_MIN_JOBS && total >= SPLIT_TOTAL_KES && window.length >= best.length) best = window;
    }
    if (best.length) {
      const total = best.reduce((t, e) => t + e.amount, 0);
      flags.push({
        type: "possible_splitting",
        severity: "high",
        subject: worker(workerId),
        counterparty: client(clientId),
        jobCount: best.length,
        amount: total,
        detail: `${best.length} jobs under ${kes(SPLIT_JOB_LIMIT_KES)} each, ${kes(total)} in total, within ${SPLIT_WINDOW_DAYS} days`,
      });
    }

    // Refunded after the worker said the work was done.
    const refunded = jobs.filter((e) => e.status === "refunded" && e.workSubmittedAt);
    if (refunded.length >= REFUND_AFTER_DELIVERY_MIN) {
      const total = refunded.reduce((t, e) => t + e.amount, 0);
      flags.push({
        type: "refund_after_delivery",
        severity: "medium",
        subject: worker(workerId),
        counterparty: client(clientId),
        jobCount: refunded.length,
        amount: total,
        detail: `${refunded.length} jobs refunded after the work was delivered (${kes(total)}), between the same two people`,
      });
    }
  }

  // Earned over the limit this year with no tax PIN on file.
  const year = yearOf(now);
  const earned = new Map<string, { total: number; jobs: number }>();
  for (const e of escrows) {
    const paid = paidToWorker(e);
    if (paid > 0 && yearOf(e.fundedAt) === year) {
      const row = earned.get(e.workerId) ?? { total: 0, jobs: 0 };
      earned.set(e.workerId, { total: row.total + paid, jobs: row.jobs + 1 });
    }
  }
  for (const [workerId, { total, jobs }] of earned) {
    if (total >= TAX_PIN_THRESHOLD_KES && !taxPinWorkerIds.has(workerId)) {
      flags.push({
        type: "no_tax_pin",
        severity: "high",
        subject: worker(workerId),
        jobCount: jobs,
        amount: total,
        detail: `Earned ${kes(total)} this year across ${jobs} jobs with no tax PIN on file`,
      });
    }
  }

  const rank = { high: 0, medium: 1 };
  return flags.sort((a, b) => rank[a.severity] - rank[b.severity] || b.amount - a.amount);
}

// Reads the escrows and the few users they name in full, which is fine at this platform's scale.
export async function getComplianceFlags(): Promise<{ flags: ComplianceFlag[]; thresholdKes: number }> {
  const db = getDb();
  const [escrowSnap, workerSnap, clientSnap, kycSnap] = await Promise.all([
    db.collection("escrows").get(),
    db.collection("workers").get(),
    db.collection("clients").get(),
    db.collection("kyc").get(),
  ]);

  const escrows: EscrowRecord[] = escrowSnap.docs.map((doc) => {
    const d = doc.data();
    return {
      jobId: doc.id,
      clientId: d.clientId,
      workerId: d.workerId,
      amount: d.amount,
      status: d.status,
      fundedAt: toDate(d.fundedAt),
      ...(d.workSubmittedAt && { workSubmittedAt: toDate(d.workSubmittedAt) }),
      ...(d.workerAmount !== undefined && { workerAmount: d.workerAmount }),
    };
  });
  const nameMap = (docs: Array<{ id: string; data: () => Record<string, any> }>) =>
    new Map(docs.map((d) => [d.id, d.data().name as string]));

  const flags = detectFlags({
    escrows,
    names: { workers: nameMap(workerSnap.docs), clients: nameMap(clientSnap.docs) },
    taxPinWorkerIds: new Set(kycSnap.docs.filter((d) => d.data().taxPin).map((d) => d.id)),
  });
  return { flags, thresholdKes: TAX_PIN_THRESHOLD_KES };
}
