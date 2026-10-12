import { getDb } from "../config/firebase";
import { HttpError } from "../errors";
import type { InitiateStkInput } from "../validation/payments";
import { normalizePhone } from "../validation/register";
import { initiateStkPush } from "./darajaService";

export interface Payment {
  checkoutRequestId: string;
  merchantRequestId: string;
  jobId: string;
  clientId: string;
  workerId: string;
  amount: number;
  currency: string;
  phone: string;
  status: "pending";
  createdAt: Date;
}

// Sends an STK Push prompt to the client's phone and records it as pending.
// The wallet, escrow and ledger are untouched until the callback settles it.
export async function initiateEscrowPayment(
  clientId: string,
  input: InitiateStkInput,
): Promise<{ payment: Payment; customerMessage: string }> {
  const db = getDb();

  const [escrowSnap, workerSnap, clientSnap] = await Promise.all([
    db.collection("escrows").doc(input.jobId).get(),
    db.collection("workers").doc(input.workerId).get(),
    db.collection("clients").doc(clientId).get(),
  ]);
  if (escrowSnap.exists) throw new HttpError(409, "Escrow for this job is already funded");
  if (!workerSnap.exists) throw new HttpError(404, "Worker not found");

  const rawPhone = input.phone ?? clientSnap.data()?.phone;
  const phone = typeof rawPhone === "string" ? normalizePhone(rawPhone) : null;
  if (!phone) throw new HttpError(400, "a valid phone number is required");

  const result = await initiateStkPush({
    phone,
    amount: input.amount,
    accountReference: input.jobId,
    description: "Escrow funding",
  });

  const payment: Payment = {
    checkoutRequestId: result.checkoutRequestId,
    merchantRequestId: result.merchantRequestId,
    jobId: input.jobId,
    clientId,
    workerId: input.workerId,
    amount: input.amount,
    currency: "KES",
    phone,
    status: "pending",
    createdAt: new Date(),
  };
  // Keyed by CheckoutRequestID, which is what the callback carries.
  await db.collection("payments").doc(result.checkoutRequestId).set(payment);

  return { payment, customerMessage: result.customerMessage };
}
