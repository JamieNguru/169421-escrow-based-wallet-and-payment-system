import { randomUUID } from "node:crypto";

import { isSimulateMode } from "../config/daraja";
import { getDb } from "../config/firebase";
import { HttpError } from "../errors";
import type { InitiateStkInput, SimulateOutcome, TopUpInput } from "../validation/payments";
import { normalizePhone } from "../validation/register";
import { initiateStkPush, type StkPushResult } from "./darajaService";
import { transition } from "./escrowStateMachine";

export type PaymentStatus = "pending" | "completed" | "failed";

export interface Payment {
  checkoutRequestId: string;
  merchantRequestId: string;
  // "escrow" pays for a job; "top_up" only adds money to the wallet.
  kind: "escrow" | "top_up";
  jobId?: string;
  workerId?: string;
  clientId: string;
  amount: number;
  currency: "KES";
  phone: string;
  status: PaymentStatus;
  // True when no real M-Pesa prompt was sent (DARAJA_SIMULATE test mode).
  simulated?: boolean;
  receipt?: string;
  failureReason?: string;
  // What settling did: funded the job's escrow, or only credited the wallet.
  settlement?: "escrow_funded" | "wallet_credited";
  createdAt: Date;
  settledAt?: Date;
}

const SIMULATED_MESSAGE = "Test mode: no real M-Pesa prompt was sent.";

interface StartInput {
  amount: number;
  phone?: string;
  accountReference: string;
  description: string;
  kind: Payment["kind"];
  jobId?: string;
  workerId?: string;
}

// Sends the M-Pesa prompt (or fakes it in test mode) and records the payment
// as pending. The wallet, escrow and ledger are untouched until the payment is
// settled, from Daraja's callback or from the test-mode simulate endpoint.
async function startPayment(
  clientId: string,
  input: StartInput,
): Promise<{ payment: Payment; customerMessage: string }> {
  const db = getDb();

  const clientSnap = await db.collection("clients").doc(clientId).get();
  const rawPhone = input.phone ?? clientSnap.data()?.phone;
  const phone = typeof rawPhone === "string" ? normalizePhone(rawPhone) : null;
  if (!phone) throw new HttpError(400, "a valid phone number is required");

  const simulated = isSimulateMode();
  const result: StkPushResult = simulated
    ? {
        checkoutRequestId: `sim-${randomUUID()}`,
        merchantRequestId: `sim-${randomUUID()}`,
        customerMessage: SIMULATED_MESSAGE,
      }
    : await initiateStkPush({
        phone,
        amount: input.amount,
        accountReference: input.accountReference,
        description: input.description,
      });

  const payment: Payment = {
    checkoutRequestId: result.checkoutRequestId,
    merchantRequestId: result.merchantRequestId,
    kind: input.kind,
    ...(input.jobId && { jobId: input.jobId }),
    ...(input.workerId && { workerId: input.workerId }),
    clientId,
    amount: input.amount,
    currency: "KES",
    phone,
    status: "pending",
    ...(simulated && { simulated }),
    createdAt: new Date(),
  };
  // Keyed by CheckoutRequestID, which is what the callback carries.
  await db.collection("payments").doc(result.checkoutRequestId).set(payment);

  return { payment, customerMessage: result.customerMessage };
}

// Prompts the client's phone to pay for a job's escrow.
export async function initiateEscrowPayment(
  clientId: string,
  input: InitiateStkInput,
): Promise<{ payment: Payment; customerMessage: string }> {
  const db = getDb();

  const [escrowSnap, workerSnap] = await Promise.all([
    db.collection("escrows").doc(input.jobId).get(),
    db.collection("workers").doc(input.workerId).get(),
  ]);
  if (escrowSnap.exists) throw new HttpError(409, "Escrow for this job is already funded");
  if (!workerSnap.exists) throw new HttpError(404, "Worker not found");

  return startPayment(clientId, {
    amount: input.amount,
    phone: input.phone,
    accountReference: input.jobId,
    description: "Escrow funding",
    kind: "escrow",
    jobId: input.jobId,
    workerId: input.workerId,
  });
}

// Prompts the client's phone to add money to their wallet, with no job involved.
export function initiateTopUp(
  clientId: string,
  input: TopUpInput,
): Promise<{ payment: Payment; customerMessage: string }> {
  return startPayment(clientId, {
    amount: input.amount,
    phone: input.phone,
    accountReference: "wallet-top-up",
    description: "Wallet top-up",
    kind: "top_up",
  });
}

// A client's own payment, so the app can poll it while the M-Pesa prompt is open.
export async function getPayment(clientId: string, checkoutRequestId: string): Promise<Payment> {
  const snap = await getDb().collection("payments").doc(checkoutRequestId).get();
  if (!snap.exists) throw new HttpError(404, "Payment not found");

  const data = snap.data()!;
  if (data.clientId !== clientId) {
    throw new HttpError(403, "you do not have permission to access this resource");
  }
  return fromDoc(data);
}

const fromDoc = (data: Record<string, any>): Payment => ({
  ...(data as Payment),
  createdAt: data.createdAt?.toDate?.() ?? data.createdAt,
  ...(data.settledAt && { settledAt: data.settledAt?.toDate?.() ?? data.settledAt }),
});

export type SettleOutcome =
  | { success: true; amount?: number; receipt?: string }
  | { success: false; reason: string };

// Settles a pending payment in one transaction. On success the amount is
// credited to the client's wallet; for a job payment it is then moved straight
// into that job's escrow, as POST /api/escrow/fund would. If the escrow can't
// be funded (the job isn't theirs, has no worker, or is already funded) the
// money stays in the wallet instead of being lost.
//
// Safe to call twice: only a pending payment is settled, so a repeated
// callback changes nothing. Returns what happened.
export async function settlePayment(
  checkoutRequestId: string,
  outcome: SettleOutcome,
): Promise<"completed" | "failed" | "ignored"> {
  const db = getDb();
  const paymentRef = db.collection("payments").doc(checkoutRequestId);

  return db.runTransaction(async (tx) => {
    const paymentSnap = await tx.get(paymentRef);
    if (!paymentSnap.exists) return "ignored";
    const payment = paymentSnap.data() as Payment;
    if (payment.status !== "pending") return "ignored";

    const now = new Date();
    const fail = (reason: string) => {
      tx.update(paymentRef, { status: "failed", failureReason: reason, settledAt: now });
      return "failed" as const;
    };

    if (!outcome.success) return fail(outcome.reason);

    // A success for a different amount than was asked for is not trusted: nothing is credited.
    if (outcome.amount !== undefined && outcome.amount !== payment.amount) {
      console.error(
        `M-Pesa payment ${checkoutRequestId} paid ${outcome.amount} but ${payment.amount} was requested`,
      );
      return fail("The amount paid did not match the amount requested");
    }

    const fundsEscrow = payment.kind === "escrow" && Boolean(payment.jobId) && Boolean(payment.workerId);
    const [walletSnap, jobSnap, escrowSnap, workerSnap] = await Promise.all([
      tx.get(db.collection("wallets").where("ownerId", "==", payment.clientId).limit(1)),
      fundsEscrow ? tx.get(db.collection("jobs").doc(payment.jobId!)) : undefined,
      fundsEscrow ? tx.get(db.collection("escrows").doc(payment.jobId!)) : undefined,
      fundsEscrow ? tx.get(db.collection("workers").doc(payment.workerId!)) : undefined,
    ]);

    if (walletSnap.empty) return fail("Client wallet not found");
    const walletDoc = walletSnap.docs[0];
    const wallet = walletDoc.data();
    if (wallet.currency !== payment.currency) return fail(`Wallet is not in ${payment.currency}`);

    const job = jobSnap?.data();
    const canFund =
      fundsEscrow &&
      jobSnap?.exists &&
      job?.clientId === payment.clientId &&
      job?.workerId === payment.workerId &&
      escrowSnap?.exists === false &&
      workerSnap?.exists === true;

    // Credit, then (if funding) move the same amount into escrow: the balance
    // ends up unchanged and only escrowBalance grows.
    tx.update(
      walletDoc.ref,
      canFund ? { escrowBalance: wallet.escrowBalance + payment.amount } : { balance: wallet.balance + payment.amount },
    );

    tx.set(db.collection("transactions").doc(`topup-${checkoutRequestId}`), {
      type: "wallet_topup",
      amount: payment.amount,
      currency: payment.currency,
      fromUserId: "mpesa",
      toUserId: payment.clientId,
      createdAt: now,
    });

    if (canFund) {
      const { status } = transition("pending", "fund", "client", payment.amount);
      tx.set(db.collection("escrows").doc(payment.jobId!), {
        jobId: payment.jobId,
        clientId: payment.clientId,
        workerId: payment.workerId,
        amount: payment.amount,
        currency: payment.currency,
        status,
        createdAt: now,
        fundedAt: now,
      });
      // One fund per job, so the job id makes a stable ledger id (same as fundEscrow).
      tx.set(db.collection("transactions").doc(`fund-${payment.jobId}`), {
        jobId: payment.jobId,
        type: "escrow_fund",
        amount: payment.amount,
        currency: payment.currency,
        fromUserId: payment.clientId,
        toUserId: payment.workerId,
        createdAt: now,
      });
    }

    tx.update(paymentRef, {
      status: "completed",
      settledAt: now,
      settlement: canFund ? "escrow_funded" : "wallet_credited",
      ...(outcome.receipt && { receipt: outcome.receipt }),
    });
    return "completed" as const;
  });
}

// Daraja posts { Body: { stkCallback: { CheckoutRequestID, ResultCode, ResultDesc,
// CallbackMetadata: { Item: [{ Name, Value }] } } } } once the customer has
// paid, cancelled or timed out.
export async function handleStkCallback(payload: any): Promise<void> {
  const callback = payload?.Body?.stkCallback;
  const id = callback?.CheckoutRequestID;
  if (typeof id !== "string") return;

  if (Number(callback.ResultCode) !== 0) {
    await settlePayment(id, {
      success: false,
      reason: typeof callback.ResultDesc === "string" ? callback.ResultDesc : "Payment failed",
    });
    return;
  }

  const items: Array<{ Name?: string; Value?: unknown }> = callback.CallbackMetadata?.Item ?? [];
  const valueOf = (name: string) => items.find((item) => item.Name === name)?.Value;
  const amount = Number(valueOf("Amount"));
  const receipt = valueOf("MpesaReceiptNumber");
  await settlePayment(id, {
    success: true,
    ...(Number.isFinite(amount) && valueOf("Amount") !== undefined && { amount }),
    ...(typeof receipt === "string" && { receipt }),
  });
}

// Test mode only: settles one of the caller's simulated payments as if Daraja had called back.
export async function simulatePayment(
  clientId: string,
  checkoutRequestId: string,
  outcome: SimulateOutcome,
): Promise<Payment> {
  if (!isSimulateMode()) throw new HttpError(404, "Not found");

  const payment = await getPayment(clientId, checkoutRequestId);
  if (!payment.simulated) throw new HttpError(409, "Only test payments can be simulated");

  await settlePayment(
    checkoutRequestId,
    outcome === "success"
      ? { success: true, amount: payment.amount, receipt: `SIM${checkoutRequestId.slice(4, 14).toUpperCase()}` }
      : { success: false, reason: "Simulated: the request was cancelled" },
  );
  return getPayment(clientId, checkoutRequestId);
}
