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

// The app credentials shared by every Daraja API, enough to fetch an access token.
export function getDarajaCredentials(): Pick<DarajaConfig, "baseUrl" | "consumerKey" | "consumerSecret"> {
  return {
    baseUrl: process.env.DARAJA_BASE_URL || "https://sandbox.safaricom.co.ke",
    consumerKey: required("DARAJA_CONSUMER_KEY"),
    consumerSecret: required("DARAJA_CONSUMER_SECRET"),
  };
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

export interface B2CConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  initiatorName: string;
  securityCredential: string;
  resultUrl: string;
  timeoutUrl: string;
}

// B2C has its own shortcode and initiator, so it is read separately from the STK config.
export function getB2CConfig(): B2CConfig {
  return {
    baseUrl: process.env.DARAJA_BASE_URL || "https://sandbox.safaricom.co.ke",
    consumerKey: required("DARAJA_CONSUMER_KEY"),
    consumerSecret: required("DARAJA_CONSUMER_SECRET"),
    shortcode: required("DARAJA_B2C_SHORTCODE"),
    initiatorName: required("DARAJA_INITIATOR_NAME"),
    securityCredential: required("DARAJA_SECURITY_CREDENTIAL"),
    resultUrl: required("DARAJA_B2C_RESULT_URL"),
    timeoutUrl: required("DARAJA_B2C_TIMEOUT_URL"),
  };
}

// Daraja does not sign callbacks, so the callback URLs carry this secret as a path segment.
export function getB2CCallbackSecret(): string {
  return required("DARAJA_B2C_CALLBACK_SECRET");
}
