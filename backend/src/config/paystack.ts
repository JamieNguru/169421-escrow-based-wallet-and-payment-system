// Paystack takes the client's M-Pesa payment into the wallet (PAYMENT_PROVIDER=paystack).
// Withdrawals do not use it: Paystack does not let a starter business pay out to third
// parties, so they stay on Daraja (or DARAJA_SIMULATE test mode).
export function isPaystackEnabled(): boolean {
  return process.env.PAYMENT_PROVIDER === "paystack" && Boolean(process.env.PAYSTACK_SECRET_KEY);
}

export function getPaystackSecret(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not set");
  return key;
}

export const getPaystackBaseUrl = () => process.env.PAYSTACK_BASE_URL || "https://api.paystack.co";
