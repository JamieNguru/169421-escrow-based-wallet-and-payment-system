import { randomUUID } from "crypto";

import { getDb } from "../config/firebase";
import { HttpError } from "../errors";
import type { WithdrawInput } from "../validation/payments";
import { normalizePhone } from "../validation/register";
import { initiateB2C } from "./darajaService";

export interface Withdrawal {
  originatorConversationId: string;
  conversationId?: string;
  workerId: string;
  amount: number;
  currency: string;
  phone: string;
  status: "pending" | "completed" | "failed";
  receipt?: string;
  failureReason?: string;
  createdAt: Date;
}

// Debits the worker's wallet and asks Daraja to pay the amount out to their
// registered phone. The debit and the pending record commit together first, so
// the money can never be paid out twice; if Daraja refuses, it is refunded.
export async function initiateWithdrawal(workerId: string, input: WithdrawInput): Promise<Withdrawal> {
  const db = getDb();

  const workerSnap = await db.collection("workers").doc(workerId).get();
  if (!workerSnap.exists) throw new HttpError(404, "Worker not found");
  const rawPhone = workerSnap.data()?.phone;
  const phone = typeof rawPhone === "string" ? normalizePhone(rawPhone) : null;
  if (!phone) throw new HttpError(409, "No valid phone number on file for payout");

  const id = randomUUID();
  const withdrawalRef = db.collection("withdrawals").doc(id);
  const walletQuery = db.collection("wallets").where("ownerId", "==", workerId).limit(1);

  const withdrawal = await db.runTransaction(async (tx) => {
    const walletSnap = await tx.get(walletQuery);
    if (walletSnap.empty) throw new HttpError(404, "Worker wallet not found");

    const walletDoc = walletSnap.docs[0];
    const wallet = walletDoc.data();
    if (wallet.balance < input.amount) throw new HttpError(402, "Insufficient wallet balance");

    tx.update(walletDoc.ref, { balance: wallet.balance - input.amount });

    const now = new Date();
    const record: Withdrawal = {
      originatorConversationId: id,
      workerId,
      amount: input.amount,
      currency: wallet.currency,
      phone,
      status: "pending",
      createdAt: now,
    };
    tx.set(withdrawalRef, record);
    tx.set(db.collection("transactions").doc(`withdraw-${id}`), {
      type: "withdrawal",
      amount: input.amount,
      currency: wallet.currency,
      fromUserId: workerId,
      toUserId: "mpesa",
      createdAt: now,
    });
    return record;
  });

  try {
    const result = await initiateB2C({ phone, amount: input.amount, originatorConversationId: id });
    await withdrawalRef.update({ conversationId: result.conversationId });
    return { ...withdrawal, conversationId: result.conversationId };
  } catch (err) {
    await failWithdrawal(id, "Could not reach M-Pesa");
    throw err;
  }
}

// Marks a pending withdrawal failed and returns the money to the wallet.
// Does nothing if it already settled, so repeated callbacks refund once.
async function failWithdrawal(id: string, reason: string): Promise<void> {
  const db = getDb();
  const withdrawalRef = db.collection("withdrawals").doc(id);

  await db.runTransaction(async (tx) => {
    const withdrawalSnap = await tx.get(withdrawalRef);
    if (!withdrawalSnap.exists || withdrawalSnap.data()!.status !== "pending") return;
    const withdrawal = withdrawalSnap.data()!;

    const walletSnap = await tx.get(db.collection("wallets").where("ownerId", "==", withdrawal.workerId).limit(1));
    if (walletSnap.empty) throw new HttpError(404, "Worker wallet not found");
    const walletDoc = walletSnap.docs[0];

    tx.update(walletDoc.ref, { balance: walletDoc.data().balance + withdrawal.amount });
    tx.update(withdrawalRef, { status: "failed", failureReason: reason });
    tx.set(db.collection("transactions").doc(`withdraw-reversal-${id}`), {
      type: "withdrawal_reversal",
      amount: withdrawal.amount,
      currency: withdrawal.currency,
      fromUserId: "mpesa",
      toUserId: withdrawal.workerId,
      createdAt: new Date(),
    });
  });
}

// Daraja posts { Result: { ResultCode, ResultDesc, OriginatorConversationID, TransactionID, ... } }.
export async function handleB2CResult(payload: any): Promise<void> {
  const result = payload?.Result;
  const id = result?.OriginatorConversationID;
  if (typeof id !== "string") return;

  if (Number(result.ResultCode) !== 0) {
    await failWithdrawal(id, typeof result.ResultDesc === "string" ? result.ResultDesc : "Payout failed");
    return;
  }

  const db = getDb();
  const withdrawalRef = db.collection("withdrawals").doc(id);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(withdrawalRef);
    if (!snap.exists || snap.data()!.status !== "pending") return;
    // Firestore rejects undefined fields, so only set the receipt when Daraja sent one.
    tx.update(withdrawalRef, {
      status: "completed",
      ...(typeof result.TransactionID === "string" && { receipt: result.TransactionID }),
    });
  });
}

// The request sat in Daraja's queue too long, so it was never paid.
export async function handleB2CTimeout(payload: any): Promise<void> {
  const id = payload?.Result?.OriginatorConversationID;
  if (typeof id !== "string") return;
  await failWithdrawal(id, "Payout timed out");
}
