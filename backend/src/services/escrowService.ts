import type { Firestore, Transaction } from "firebase-admin/firestore";

import { getDb } from "../config/firebase";
import { HttpError } from "../errors";
import type {
  FundEscrowInput,
  RaiseDisputeInput,
  RequestRefundInput,
  ResolveDisputeInput,
} from "../validation/escrow";
import { amountDueKes, assertAmountMatches, assertPayable, jobTerms } from "./jobPricing";
import { canTransition, splitEffects, transition, type EscrowStatus, type WalletEffect } from "./escrowStateMachine";

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
  refundedAt?: Date;
  disputedAt?: Date;
  clientAmount?: number;
  workerAmount?: number;
}

// Firestore returns Timestamps for stored dates; the mock and plain Dates pass through.
export const toDate = (value: any): Date => (typeof value?.toDate === "function" ? value.toDate() : value);

const fromDoc = (data: Record<string, any>): Escrow => ({
  ...(data as Escrow),
  createdAt: toDate(data.createdAt),
  fundedAt: toDate(data.fundedAt),
  ...(data.workSubmittedAt && { workSubmittedAt: toDate(data.workSubmittedAt) }),
  ...(data.completedAt && { completedAt: toDate(data.completedAt) }),
  ...(data.refundedAt && { refundedAt: toDate(data.refundedAt) }),
  ...(data.disputedAt && { disputedAt: toDate(data.disputedAt) }),
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
  const jobRef = db.collection("jobs").doc(input.jobId);
  const workerRef = db.collection("workers").doc(input.workerId);
  const walletQuery = db.collection("wallets").where("ownerId", "==", clientId).limit(1);

  return db.runTransaction(async (tx) => {
    const [jobSnap, escrowSnap, workerSnap, walletSnap] = await Promise.all([
      tx.get(jobRef),
      tx.get(escrowRef),
      tx.get(workerRef),
      tx.get(walletQuery),
    ]);

    const job = assertPayable(jobSnap, clientId, input.workerId);
    if (!workerSnap.exists) throw new HttpError(404, "Worker not found");
    if (walletSnap.empty) throw new HttpError(404, "Client wallet not found");

    // The amount comes from the job, not the request.
    const amount = await amountDueKes(jobTerms(job));
    assertAmountMatches(input.amount, amount);

    const current: EscrowStatus = escrowSnap.exists ? escrowSnap.data()!.status : "pending";
    const { status, effects } = transition(current, "fund", "client", amount);

    const walletDoc = walletSnap.docs[0];
    const wallet = walletDoc.data();
    if (wallet.balance < amount) {
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
      amount,
      currency: wallet.currency,
      status,
      createdAt: now,
      fundedAt: now,
    };
    tx.set(escrowRef, escrow);

    // One fund per job, so the job id makes a stable ledger id.
    tx.set(db.collection("transactions").doc(`fund-${input.jobId}`), {
      jobId: input.jobId,
      type: "escrow_fund",
      amount,
      currency: wallet.currency,
      fromUserId: clientId,
      toUserId: input.workerId,
      createdAt: now,
    });
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

export interface RefundRequest {
  jobId: string;
  clientId: string;
  workerId: string;
  amount: number;
  currency: string;
  reason: string;
  status: "pending" | "approved";
  createdAt: Date;
  processedBy?: string;
  processedAt?: Date;
}

// The client asks for their escrowed money back. Only an admin can run the
// refund transition, so this just records the request; no money or escrow
// status changes. One request per job, keyed by the job id.
export async function requestRefund(
  clientId: string,
  jobId: string,
  input: RequestRefundInput,
): Promise<RefundRequest> {
  const db = getDb();
  const escrowRef = db.collection("escrows").doc(jobId);
  const requestRef = db.collection("refundRequests").doc(jobId);

  return db.runTransaction(async (tx) => {
    const [escrowSnap, requestSnap] = await Promise.all([tx.get(escrowRef), tx.get(requestRef)]);
    if (!escrowSnap.exists) throw new HttpError(404, "Escrow not found");

    const data = escrowSnap.data()!;
    if (data.clientId !== clientId) {
      throw new HttpError(403, "you do not have permission to access this resource");
    }
    if (!canTransition(data.status, "refund", "admin")) {
      throw new HttpError(409, `Cannot request a refund for an escrow that is ${data.status}`);
    }
    if (requestSnap.exists) {
      throw new HttpError(409, "A refund has already been requested for this job");
    }

    const refundRequest: RefundRequest = {
      jobId,
      clientId,
      workerId: data.workerId,
      amount: data.amount,
      currency: data.currency,
      reason: input.reason,
      status: "pending",
      createdAt: new Date(),
    };
    tx.set(requestRef, refundRequest);
    return refundRequest;
  });
}

// An admin approves a pending refund request: the escrowed money goes back to
// the client. Escrow, request and wallet change in one transaction. The state
// machine rejects an escrow that has since been disputed, released or refunded.
export async function processRefund(adminId: string, jobId: string): Promise<RefundRequest> {
  const db = getDb();
  const escrowRef = db.collection("escrows").doc(jobId);
  const requestRef = db.collection("refundRequests").doc(jobId);

  return db.runTransaction(async (tx) => {
    const [escrowSnap, requestSnap] = await Promise.all([tx.get(escrowRef), tx.get(requestRef)]);
    if (!escrowSnap.exists) throw new HttpError(404, "Escrow not found");
    if (!requestSnap.exists) throw new HttpError(404, "Refund request not found");

    const request = requestSnap.data() as RefundRequest;
    if (request.status !== "pending") {
      throw new HttpError(409, "This refund request has already been processed");
    }

    const data = escrowSnap.data()!;
    const { status, effects } = transition(data.status, "refund", "admin", data.amount);
    await refundToClient(tx, db, data, effects);

    const now = new Date();
    tx.update(escrowRef, { status, refundedAt: now });

    const processed = { status: "approved" as const, processedBy: adminId, processedAt: now };
    tx.update(requestRef, processed);
    return { ...request, ...processed };
  });
}

export interface Dispute {
  jobId: string;
  clientId: string;
  workerId: string;
  amount: number;
  currency: string;
  raisedBy: string;
  raisedByRole: "client" | "worker";
  reason: string;
  // Evidence photos are only returned by the admin's dispute detail; lists carry the count.
  photos?: string[];
  photoCount?: number;
  previousStatus: EscrowStatus;
  status: "open" | "resolved";
  createdAt: Date;
  decision?: ResolveDisputeInput["decision"];
  // Set for a split: the client's refund and the worker's payment add up to the amount.
  clientAmount?: number;
  workerAmount?: number;
  resolution?: string;
  resolvedBy?: string;
  resolvedAt?: Date;
}

// The client or the assigned worker disputes the job. The escrow moves to
// "disputed" and the money stays put until an admin resolves it. One dispute
// per job, keyed by the job id; the state machine rejects a second one
// because a disputed escrow cannot be disputed again.
export async function raiseDispute(
  userId: string,
  role: "client" | "worker",
  jobId: string,
  input: RaiseDisputeInput,
): Promise<Dispute> {
  const db = getDb();
  const escrowRef = db.collection("escrows").doc(jobId);
  const disputeRef = db.collection("disputes").doc(jobId);

  return db.runTransaction(async (tx) => {
    const escrowSnap = await tx.get(escrowRef);
    if (!escrowSnap.exists) throw new HttpError(404, "Escrow not found");

    const data = escrowSnap.data()!;
    const partyId = role === "client" ? data.clientId : data.workerId;
    if (partyId !== userId) {
      throw new HttpError(403, "you do not have permission to access this resource");
    }

    const { status } = transition(data.status, "dispute", role, data.amount);
    const now = new Date();
    tx.update(escrowRef, { status, disputedAt: now });

    const dispute: Dispute = {
      jobId,
      clientId: data.clientId,
      workerId: data.workerId,
      amount: data.amount,
      currency: data.currency,
      raisedBy: userId,
      raisedByRole: role,
      reason: input.reason,
      ...(input.photos?.length && { photos: input.photos }),
      previousStatus: data.status,
      status: "open",
      createdAt: now,
    };
    tx.set(disputeRef, dispute);
    const { photos, ...shown } = dispute;
    return { ...shown, ...(photos && { photoCount: photos.length }) };
  });
}

// An admin settles a disputed escrow: "release" pays the worker, "refund"
// returns the money to the client, "split" divides it between them. Escrow, dispute and wallets change in one
// transaction. The state machine rejects an escrow that is not disputed, so a
// dispute can only be resolved once.
export async function resolveDispute(
  adminId: string,
  jobId: string,
  input: ResolveDisputeInput,
): Promise<Dispute> {
  const db = getDb();
  const escrowRef = db.collection("escrows").doc(jobId);
  const disputeRef = db.collection("disputes").doc(jobId);

  return db.runTransaction(async (tx) => {
    const [escrowSnap, disputeSnap] = await Promise.all([tx.get(escrowRef), tx.get(disputeRef)]);
    if (!escrowSnap.exists) throw new HttpError(404, "Escrow not found");
    if (!disputeSnap.exists) throw new HttpError(404, "Dispute not found");

    const data = escrowSnap.data()!;
    const now = new Date();
    let escrowUpdate: Record<string, unknown>;
    let outcome: Record<string, unknown> = {};

    if (input.decision === "split") {
      const clientAmount = roundMoney(input.clientAmount!);
      if (clientAmount >= data.amount) {
        throw new HttpError(400, "clientAmount must be less than the escrow amount; use refund to return it all");
      }
      const workerAmount = roundMoney(data.amount - clientAmount);
      const { status } = transition(data.status, "resolve_split", "admin", data.amount);
      await splitBetween(tx, db, data, clientAmount, workerAmount);
      outcome = { clientAmount, workerAmount };
      escrowUpdate = { status, completedAt: now, ...outcome };
    } else {
      const release = input.decision === "release";
      const { status, effects } = transition(
        data.status,
        release ? "resolve_release" : "resolve_refund",
        "admin",
        data.amount,
      );
      if (release) {
        await releaseToWorker(tx, db, data, effects);
      } else {
        await refundToClient(tx, db, data, effects);
      }
      escrowUpdate = { status, [release ? "completedAt" : "refundedAt"]: now };
    }
    tx.update(escrowRef, escrowUpdate);

    const resolved = {
      status: "resolved" as const,
      decision: input.decision,
      ...outcome,
      resolution: input.resolution,
      resolvedBy: adminId,
      resolvedAt: now,
    };
    tx.update(disputeRef, resolved);
    return { ...(disputeSnap.data() as Dispute), ...resolved };
  });
}

// Returns the escrowed amount to the client's balance and records it in the
// ledger. Runs inside the caller's transaction, like releaseToWorker.
async function refundToClient(
  tx: Transaction,
  db: Firestore,
  escrow: Record<string, any>,
  effects: WalletEffect[],
): Promise<void> {
  const walletSnap = await tx.get(db.collection("wallets").where("ownerId", "==", escrow.clientId).limit(1));
  if (walletSnap.empty) throw new HttpError(404, "Client wallet not found");

  const walletDoc = walletSnap.docs[0];
  const wallet = walletDoc.data();
  const updates: Record<string, number> = {};
  for (const { field, delta } of effects) {
    updates[field] = (updates[field] ?? wallet[field]) + delta;
  }
  tx.update(walletDoc.ref, updates);

  // One refund per job, so the job id makes a stable ledger id.
  tx.set(db.collection("transactions").doc(`refund-${escrow.jobId}`), {
    jobId: escrow.jobId,
    type: "escrow_refund",
    amount: escrow.amount,
    currency: escrow.currency,
    fromUserId: escrow.clientId,
    toUserId: escrow.clientId,
    createdAt: new Date(),
  });
}

// Pays the escrowed amount out to the worker and records it in the ledger
// (fundEscrow records the funding side).
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

const roundMoney = (value: number) => Math.round(value * 100) / 100;

// Divides the escrow between the two wallets and records both halves in the
// ledger. Runs inside the caller's transaction, like releaseToWorker.
async function splitBetween(
  tx: Transaction,
  db: Firestore,
  escrow: Record<string, any>,
  clientAmount: number,
  workerAmount: number,
): Promise<void> {
  const [clientWalletSnap, workerWalletSnap] = await Promise.all([
    tx.get(db.collection("wallets").where("ownerId", "==", escrow.clientId).limit(1)),
    tx.get(db.collection("wallets").where("ownerId", "==", escrow.workerId).limit(1)),
  ]);
  if (clientWalletSnap.empty) throw new HttpError(404, "Client wallet not found");
  if (workerWalletSnap.empty) throw new HttpError(404, "Worker wallet not found");

  const wallets = { client: clientWalletSnap.docs[0], worker: workerWalletSnap.docs[0] };
  if (wallets.client.data().currency !== wallets.worker.data().currency) {
    throw new HttpError(409, "Client and worker wallets use different currencies");
  }

  const updates = { client: {} as Record<string, number>, worker: {} as Record<string, number> };
  for (const { party, field, delta } of splitEffects(escrow.amount, clientAmount)) {
    updates[party][field] = roundMoney((updates[party][field] ?? wallets[party].data()[field]) + delta);
  }
  tx.update(wallets.client.ref, updates.client);
  tx.update(wallets.worker.ref, updates.worker);

  const now = new Date();
  tx.set(db.collection("transactions").doc(`refund-${escrow.jobId}`), {
    jobId: escrow.jobId,
    type: "escrow_refund",
    amount: clientAmount,
    currency: escrow.currency,
    fromUserId: escrow.clientId,
    toUserId: escrow.clientId,
    createdAt: now,
  });
  tx.set(db.collection("transactions").doc(`release-${escrow.jobId}`), {
    jobId: escrow.jobId,
    type: "escrow_release",
    amount: workerAmount,
    currency: escrow.currency,
    fromUserId: escrow.clientId,
    toUserId: escrow.workerId,
    createdAt: now,
  });
}
