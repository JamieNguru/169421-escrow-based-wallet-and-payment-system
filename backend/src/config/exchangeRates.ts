const DEFAULT_EXCHANGE_RATE_API_URL = "https://open.er-api.com/v6/latest/USD";

// Endpoint returning rates against USD in open.er-api.com's response shape.
export function getExchangeRateApiUrl(): string {
  return process.env.EXCHANGE_RATE_API_URL || DEFAULT_EXCHANGE_RATE_API_URL;
}
