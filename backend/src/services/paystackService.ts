import { createHmac, timingSafeEqual } from "node:crypto";

import { getPaystackBaseUrl, getPaystackSecret } from "../config/paystack";
import { HttpError } from "../errors";
import { settlePayment } from "./paymentService";

const REQUEST_TIMEOUT_MS = 10_000;
const UNAVAILABLE = "payment service unavailable";

// Paystack amounts are in the currency's smallest unit (cents for KES).
const toKes = (subunits: unknown) => Number(subunits) / 100;

async function paystack(method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
  try {
    const res = await fetch(`${getPaystackBaseUrl()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${getPaystackSecret()}`, "Content-Type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return await res.json().catch(() => ({}));
  } catch (err) {
    console.error("Paystack request failed:", err);
    throw new HttpError(503, UNAVAILABLE);
  }
}

export type ChargeResult =
  | { state: "success"; amount: number; receipt: string }
  | { state: "pending"; message: string }
  | { state: "failed"; reason: string };

// Asks Paystack to charge a customer's M-Pesa. The prompt goes to the phone;
// in test mode Paystack's test number approves straight away.
export async function chargeMpesa(input: {
  reference: string;
  email: string;
  phone: string;
  amount: number;
}): Promise<ChargeResult> {
  const json = await paystack("POST", "/charge", {
    reference: input.reference,
    email: input.email,
    amount: Math.round(input.amount * 100),
    currency: "KES",
    mobile_money: { phone: `+${input.phone}`, provider: "mpesa" },
  });
  return mapCharge(json, "Check your phone and enter your M-Pesa PIN to finish paying.");
}

// What Paystack currently says about a charge, for when the webhook has not arrived.
export async function verifyCharge(reference: string): Promise<ChargeResult> {
  const json = await paystack("GET", `/transaction/verify/${encodeURIComponent(reference)}`);
  return mapCharge(json, "Waiting for M-Pesa to confirm.");
}

function mapCharge(json: any, pendingMessage: string): ChargeResult {
  const data = json?.data ?? {};
  switch (data.status) {
    case "success":
      return { state: "success", amount: toKes(data.amount), receipt: String(data.receipt_number ?? data.reference ?? "") };
    case "failed":
    case "abandoned":
    case "reversed":
      return { state: "failed", reason: String(data.gateway_response || data.message || json?.message || "Payment failed") };
    case undefined:
      // No transaction in the reply: a request error rather than a payment state.
      return { state: "failed", reason: String(json?.message || "Payment failed") };
    default:
      return { state: "pending", message: String(data.display_text || pendingMessage) };
  }
}

// Paystack signs each webhook body with HMAC-SHA512 using the secret key.
export function isValidPaystackSignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
  if (!rawBody || !signature) return false;
  const expected = createHmac("sha512", getPaystackSecret()).update(rawBody).digest("hex");
  const given = Buffer.from(signature, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

// charge.success and charge.failed carry the reference we sent, which is the payment's id.
export async function handlePaystackWebhook(event: any): Promise<void> {
  const reference = event?.data?.reference;
  if (typeof reference !== "string") return;

  if (event.event === "charge.success") {
    await settlePayment(reference, {
      success: true,
      amount: toKes(event.data.amount),
      receipt: String(event.data.receipt_number ?? reference),
    });
  } else if (event.event === "charge.failed") {
    await settlePayment(reference, {
      success: false,
      reason: String(event.data.gateway_response || event.data.message || "Payment failed"),
    });
  }
}
