export interface DarajaConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
  callbackUrl: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Daraja is not configured: set ${name} in .env`);
  }
  return value;
}

export function getDarajaConfig(): DarajaConfig {
  return {
    baseUrl: process.env.DARAJA_BASE_URL || "https://sandbox.safaricom.co.ke",
    consumerKey: required("DARAJA_CONSUMER_KEY"),
    consumerSecret: required("DARAJA_CONSUMER_SECRET"),
    shortcode: required("DARAJA_SHORTCODE"),
    passkey: required("DARAJA_PASSKEY"),
    callbackUrl: required("DARAJA_CALLBACK_URL"),
  };
}
