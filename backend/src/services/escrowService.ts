import { getDb } from "../config/firebase";
import { HttpError } from "../errors";
import type { FundEscrowInput } from "../validation/escrow";
import { transition, type EscrowStatus } from "./escrowStateMachine";

export interface Escrow {
  jobId: string;
  clientId: string;
  workerId: string;
  amount: number;
  currency: string;
  status: EscrowStatus;
  createdAt: Date;
  fundedAt: Date;
}

// Firestore returns Timestamps for stored dates; the mock and plain Dates pass through.
const toDate = (value: any): Date => (typeof value?.toDate === "function" ? value.toDate() : value);

// Returns the escrow for a job. Clients and workers can only see their own;
// admins can see any.
export async function getEscrow(
  jobId: string,
  user: { sub: string; role: "client" | "worker" | "admin" },
): Promise<Escrow> {
  const snap = await getDb().collection("escrows").doc(jobId).get();
  if (!snap.exists) throw new HttpError(404, "Escrow not found");

  const data = snap.data()!;
  const allowed =
    user.role === "admin" ||
    (user.role === "client" && data.clientId === user.sub) ||
    (user.role === "worker" && data.workerId === user.sub);
  if (!allowed) throw new HttpError(403, "you do not have permission to access this resource");

  return { ...(data as Escrow), createdAt: toDate(data.createdAt), fundedAt: toDate(data.fundedAt) };
}

// Moves the amount from the client's balance into escrow and records the
// escrow for the job. Everything happens in one transaction so a failed
// check leaves the wallet untouched.
export async function fundEscrow(clientId: string, input: FundEscrowInput): Promise<Escrow> {
  const db = getDb();
  const escrowRef = db.collection("escrows").doc(input.jobId);
  const workerRef = db.collection("workers").doc(input.workerId);
  const walletQuery = db.collection("wallets").where("ownerId", "==", clientId).limit(1);

  return db.runTransaction(async (tx) => {
    const [escrowSnap, workerSnap, walletSnap] = await Promise.all([
      tx.get(escrowRef),
      tx.get(workerRef),
      tx.get(walletQuery),
    ]);

    if (!workerSnap.exists) throw new HttpError(404, "Worker not found");
    if (walletSnap.empty) throw new HttpError(404, "Client wallet not found");

    const current: EscrowStatus = escrowSnap.exists ? escrowSnap.data()!.status : "pending";
    const { status, effects } = transition(current, "fund", "client", input.amount);

    const walletDoc = walletSnap.docs[0];
    const wallet = walletDoc.data();
    if (wallet.balance < input.amount) {
      throw new HttpError(402, "Insufficient wallet balance");
    }

    const updates: Record<string, number> = {};
    for (const { field, delta } of effects) {
      updates[field] = (updates[field] ?? wallet[field]) + delta;
    }
    tx.update(walletDoc.ref, updates);

    const now = new Date();
    const escrow: Escrow = {
      jobId: input.jobId,
      clientId,
      workerId: input.workerId,
      amount: input.amount,
      currency: wallet.currency,
      status,
      createdAt: now,
      fundedAt: now,
    };
    tx.set(escrowRef, escrow);
    return escrow;
  });
}
