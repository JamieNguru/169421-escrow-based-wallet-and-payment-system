import { getDarajaConfig } from "../config/daraja";
import { HttpError } from "../errors";

const REQUEST_TIMEOUT_MS = 10000;
const UNAVAILABLE = "M-Pesa unavailable";

let cachedToken: { value: string; expiresAt: number } | null = null;

export interface StkPushInput {
  phone: string;
  amount: number;
  accountReference: string;
  description: string;
}

export interface StkPushResult {
  checkoutRequestId: string;
  merchantRequestId: string;
  customerMessage: string;
}

// Daraja timestamps are YYYYMMDDHHmmss.
const timestamp = (now: Date): string => now.toISOString().replace(/\D/g, "").slice(0, 14);

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const { baseUrl, consumerKey, consumerSecret } = getDarajaConfig();
  const basic = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const res = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${basic}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`oauth responded ${res.status}`);

  const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof body.access_token !== "string") throw new Error("oauth response had no access_token");

  const ttlSeconds = Number(body.expires_in) || 3600;
  // Refresh a minute early so a token never expires mid-request.
  cachedToken = { value: body.access_token, expiresAt: Date.now() + (ttlSeconds - 60) * 1000 };
  return cachedToken.value;
}

// Asks Daraja to prompt the customer's phone for payment. This only confirms
// the prompt was sent; the outcome arrives later on the callback URL.
export async function initiateStkPush(input: StkPushInput): Promise<StkPushResult> {
  // Missing config is a server error, not an upstream outage, so it is read outside the try.
  const config = getDarajaConfig();

  let body: Record<string, unknown>;
  try {
    const token = await getAccessToken();
    const stamp = timestamp(new Date());
    const password = Buffer.from(`${config.shortcode}${config.passkey}${stamp}`).toString("base64");

    const res = await fetch(`${config.baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: config.shortcode,
        Password: password,
        Timestamp: stamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: input.amount,
        PartyA: input.phone,
        PartyB: config.shortcode,
        PhoneNumber: input.phone,
        CallBackURL: config.callbackUrl,
        AccountReference: input.accountReference,
        TransactionDesc: input.description,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      // A rejected token may have been revoked; drop it so the next call refetches.
      if (res.status === 401) cachedToken = null;
      throw new Error(`stk push responded ${res.status}`);
    }
    body = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    console.error("M-Pesa STK push failed:", err);
    throw new HttpError(503, UNAVAILABLE);
  }

  if (
    body.ResponseCode !== "0" ||
    typeof body.CheckoutRequestID !== "string" ||
    typeof body.MerchantRequestID !== "string"
  ) {
    console.error("M-Pesa STK push rejected:", body);
    throw new HttpError(502, UNAVAILABLE);
  }

  return {
    checkoutRequestId: body.CheckoutRequestID,
    merchantRequestId: body.MerchantRequestID,
    customerMessage: typeof body.CustomerMessage === "string" ? body.CustomerMessage : "",
  };
}

// For tests.
export function resetDarajaTokenCache(): void {
  cachedToken = null;
}
