import { randomUUID } from "crypto";

import { isSimulateMode } from "../config/daraja";
import { getDb } from "../config/firebase";
import { HttpError } from "../errors";
import type { WithdrawInput } from "../validation/payments";
import { normalizePhone } from "../validation/register";
import { assertTaxPinForPayout } from "./complianceService";
import { initiateB2C } from "./darajaService";
import { toDate } from "./escrowService";

export interface Withdrawal {
  // Same as originatorConversationId; set on what the API returns.
  id?: string;
  originatorConversationId: string;
  conversationId?: string;
  workerId: string;
  amount: number;
  currency: string;
  phone: string;
  status: "pending" | "completed" | "failed";
  receipt?: string;
  failureReason?: string;
  // True when no real payout was requested (DARAJA_SIMULATE test mode).
  simulated?: boolean;
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

  await assertTaxPinForPayout(workerId, input.amount);

  const simulated = isSimulateMode();
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
      ...(simulated && { simulated }),
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

  // Test mode: no payout is requested; the worker settles it with simulateWithdrawal.
  if (simulated) {
    const conversationId = `sim-${id}`;
    await withdrawalRef.update({ conversationId });
    return { ...withdrawal, id, conversationId };
  }

  try {
    const result = await initiateB2C({ phone, amount: input.amount, originatorConversationId: id });
    await withdrawalRef.update({ conversationId: result.conversationId });
    return { ...withdrawal, id, conversationId: result.conversationId };
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

export interface WithdrawalView extends Withdrawal {
  id: string;
}

// In test mode there is no Daraja to report back, so a simulated withdrawal is
// paid out this long after it was requested, the first time it is looked at.
const SIMULATED_PAYOUT_MS = 3000;

// The worker's most recent withdrawals, newest first, with how each one ended.
export async function listWithdrawals(workerId: string, limit = 10): Promise<WithdrawalView[]> {
  const read = async () => {
    const snap = await getDb().collection("withdrawals").where("workerId", "==", workerId).get();
    return (snap.docs as Array<{ id: string; data: () => Record<string, any> }>)
      .map((d) => ({ ...(d.data() as Withdrawal), id: d.id, createdAt: toDate(d.data().createdAt) }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  };

  const withdrawals = await read();
  if (!isSimulateMode()) return withdrawals;

  const due = withdrawals.filter(
    (w) => w.simulated && w.status === "pending" && Date.now() - w.createdAt.getTime() >= SIMULATED_PAYOUT_MS,
  );
  if (due.length === 0) return withdrawals;
  for (const w of due) await settleSimulated(w.id, "success");
  return read();
}

// Settles a test-mode withdrawal as the Daraja result callback would.
async function settleSimulated(id: string, outcome: "success" | "failure"): Promise<void> {
  if (outcome === "success") {
    await handleB2CResult({
      Result: { ResultCode: 0, OriginatorConversationID: id, TransactionID: `SIM${randomUUID().slice(0, 8).toUpperCase()}` },
    });
  } else {
    await failWithdrawal(id, "Simulated failure");
  }
}

// Test mode only, API only (the app lets them complete by themselves): settles
// one of the worker's own simulated withdrawals, as the Daraja result callback would. "success" completes it with a fake receipt;
// "failure" fails it and puts the money back in the wallet. A withdrawal that
// has already settled is returned as it is.
export async function simulateWithdrawal(
  workerId: string,
  id: string,
  outcome: "success" | "failure",
): Promise<WithdrawalView> {
  if (!isSimulateMode()) throw new HttpError(404, "Not found");

  const ref = getDb().collection("withdrawals").doc(id);
  const snap = await ref.get();
  const data = snap.data() as Withdrawal | undefined;
  if (!snap.exists || !data || data.workerId !== workerId) throw new HttpError(404, "Withdrawal not found");
  if (!data.simulated) throw new HttpError(409, "Only test-mode withdrawals can be simulated");

  if (data.status === "pending") await settleSimulated(id, outcome);

  const latest = (await ref.get()).data() as Withdrawal;
  return { ...latest, id, createdAt: toDate(latest.createdAt) };
}
