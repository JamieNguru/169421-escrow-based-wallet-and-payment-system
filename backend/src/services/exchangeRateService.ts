import { getExchangeRateApiUrl } from "../config/exchangeRates";
import { HttpError } from "../errors";
import { SUPPORTED_CURRENCIES, type Currency } from "../validation/currency";

const REQUEST_TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 60 * 60 * 1000;

interface RateTable {
  // Units of each currency per 1 USD.
  rates: Record<Currency, number>;
  updatedAt: Date;
  fetchedAt: number;
}

export interface Conversion {
  from: Currency;
  to: Currency;
  amount: number;
  rate: number;
  converted: number;
  rateUpdatedAt: string;
}

let cached: RateTable | null = null;

export function resetRateCache(): void {
  cached = null;
}

async function fetchRates(): Promise<RateTable> {
  const res = await fetch(getExchangeRateApiUrl(), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`rate provider responded ${res.status}`);

  const body = (await res.json()) as { result?: unknown; time_last_update_unix?: unknown; rates?: Record<string, unknown> };
  if (body.result !== "success" || !body.rates) throw new Error("rate provider returned no rates");

  const rates = {} as Record<Currency, number>;
  for (const code of SUPPORTED_CURRENCIES) {
    const value = body.rates[code];
    if (typeof value !== "number" || !(value > 0)) throw new Error(`rate provider had no ${code} rate`);
    rates[code] = value;
  }

  const updatedUnix = Number(body.time_last_update_unix);
  return {
    rates,
    updatedAt: Number.isFinite(updatedUnix) && updatedUnix > 0 ? new Date(updatedUnix * 1000) : new Date(),
    fetchedAt: Date.now(),
  };
}

// Rates are cached for an hour. If a refresh fails, stale rates are still
// better than none, so they are served until the provider recovers.
async function getRates(): Promise<RateTable> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  try {
    cached = await fetchRates();
    return cached;
  } catch (err) {
    console.error("exchange rate fetch failed:", err);
    if (cached) return cached;
    throw new HttpError(503, "exchange rates unavailable");
  }
}

export async function convert(from: Currency, to: Currency, amount: number): Promise<Conversion> {
  const { rates, updatedAt } = await getRates();
  const rate = rates[to] / rates[from];

  return {
    from,
    to,
    amount,
    rate: Math.round(rate * 1e6) / 1e6,
    // Convert from the unrounded rate so rounding error does not compound.
    converted: Math.round(amount * rate * 100) / 100,
    rateUpdatedAt: updatedAt.toISOString(),
  };
}
