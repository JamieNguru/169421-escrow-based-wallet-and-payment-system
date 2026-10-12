import type { Firestore, Transaction } from "firebase-admin/firestore";

import { getDb } from "../config/firebase";
import { HttpError } from "../errors";
import type { FundEscrowInput } from "../validation/escrow";
import { transition, type EscrowStatus, type WalletEffect } from "./escrowStateMachine";

export interface Escrow {
  jobId: string;
  clientId: string;
  workerId: string;
  amount: number;
  currency: string;
  status: EscrowStatus;
  createdAt: Date;
  fundedAt: Date;
  workSubmittedAt?: Date;
  completedAt?: Date;
}

// Firestore returns Timestamps for stored dates; the mock and plain Dates pass through.
const toDate = (value: any): Date => (typeof value?.toDate === "function" ? value.toDate() : value);

const fromDoc = (data: Record<string, any>): Escrow => ({
  ...(data as Escrow),
  createdAt: toDate(data.createdAt),
  fundedAt: toDate(data.fundedAt),
  ...(data.workSubmittedAt && { workSubmittedAt: toDate(data.workSubmittedAt) }),
  ...(data.completedAt && { completedAt: toDate(data.completedAt) }),
});

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

  return fromDoc(data);
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

// The assigned worker flags the job as done. Only the status changes; the
// money stays in escrow until the client confirms.
export async function markWorkComplete(workerId: string, jobId: string): Promise<Escrow> {
  const db = getDb();
  const escrowRef = db.collection("escrows").doc(jobId);

  return db.runTransaction(async (tx) => {
    const escrowSnap = await tx.get(escrowRef);
    if (!escrowSnap.exists) throw new HttpError(404, "Escrow not found");

    const data = escrowSnap.data()!;
    if (data.workerId !== workerId) {
      throw new HttpError(403, "you do not have permission to access this resource");
    }

    const { status } = transition(data.status, "submit_work", "worker", data.amount);
    const changes = { status, workSubmittedAt: new Date() };
    tx.update(escrowRef, changes);
    return fromDoc({ ...data, ...changes });
  });
}

// The client accepts the work: the escrowed amount moves to the worker's
// balance and the escrow closes. Wallet and escrow change in one transaction.
export async function confirmCompletion(clientId: string, jobId: string): Promise<Escrow> {
  const db = getDb();
  const escrowRef = db.collection("escrows").doc(jobId);

  return db.runTransaction(async (tx) => {
    const escrowSnap = await tx.get(escrowRef);
    if (!escrowSnap.exists) throw new HttpError(404, "Escrow not found");

    const data = escrowSnap.data()!;
    if (data.clientId !== clientId) {
      throw new HttpError(403, "you do not have permission to access this resource");
    }

    if (data.status === "in_escrow") {
      throw new HttpError(409, "The worker has not marked this job complete yet");
    }

    const { status, effects } = transition(data.status, "release", "client", data.amount);
    await releaseToWorker(tx, db, data, effects);

    const changes = { status, completedAt: new Date() };
    tx.update(escrowRef, changes);
    return fromDoc({ ...data, ...changes });
  });
}

// Pays the escrowed amount out to the worker and records it in the ledger.
// Runs inside the caller's transaction, so a failed check leaves everything
// untouched. Shared by every path that releases funds.
async function releaseToWorker(
  tx: Transaction,
  db: Firestore,
  escrow: Record<string, any>,
  effects: WalletEffect[],
): Promise<void> {
  const [clientWalletSnap, workerWalletSnap] = await Promise.all([
    tx.get(db.collection("wallets").where("ownerId", "==", escrow.clientId).limit(1)),
    tx.get(db.collection("wallets").where("ownerId", "==", escrow.workerId).limit(1)),
  ]);
  if (clientWalletSnap.empty) throw new HttpError(404, "Client wallet not found");
  if (workerWalletSnap.empty) throw new HttpError(404, "Worker wallet not found");

  const wallets = {
    client: clientWalletSnap.docs[0],
    worker: workerWalletSnap.docs[0],
  };
  if (wallets.client.data().currency !== wallets.worker.data().currency) {
    throw new HttpError(409, "Client and worker wallets use different currencies");
  }

  const updates = { client: {} as Record<string, number>, worker: {} as Record<string, number> };
  for (const { party, field, delta } of effects) {
    updates[party][field] = (updates[party][field] ?? wallets[party].data()[field]) + delta;
  }
  tx.update(wallets.client.ref, updates.client);
  tx.update(wallets.worker.ref, updates.worker);

  // One release per job, so the job id makes a stable ledger id.
  tx.set(db.collection("transactions").doc(`release-${escrow.jobId}`), {
    jobId: escrow.jobId,
    type: "escrow_release",
    amount: escrow.amount,
    currency: escrow.currency,
    fromUserId: escrow.clientId,
    toUserId: escrow.workerId,
    createdAt: new Date(),
  });
}
