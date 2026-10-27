import { HttpError } from "../errors";
import type { Currency } from "../validation/currency";
import { convert } from "./exchangeRateService";

export interface JobTerms {
  price: number;
  currency: Currency;
}

// What the job costs: the quote the client accepted, or the posted budget for
// jobs that were assigned before workers could set a price.
export function jobTerms(job: Record<string, any>): JobTerms {
  if (typeof job.agreedPrice === "number" && job.agreedCurrency) {
    return { price: job.agreedPrice, currency: job.agreedCurrency };
  }
  return { price: job.budget, currency: job.currency };
}

// The whole-shilling amount the client has to pay, worked out on the server so
// the client never chooses it. A job priced in another currency is converted at
// the current rate and rounded up.
export async function amountDueKes({ price, currency }: JobTerms): Promise<number> {
  const kes = currency === "KES" ? price : (await convert(currency, "KES", price)).converted;
  return Math.ceil(Math.round(kes * 100) / 100);
}

// A job a client is allowed to pay for: it exists, is theirs and has this worker.
export function assertPayable(
  job: { exists: boolean; data(): Record<string, any> | undefined },
  clientId: string,
  workerId: string,
): Record<string, any> {
  if (!job.exists) throw new HttpError(404, "Job not found");
  const data = job.data()!;
  if (data.clientId !== clientId) throw new HttpError(403, "you do not have permission to access this resource");
  if (data.status !== "assigned" || !data.workerId) throw new HttpError(409, "Choose a worker for this job first");
  if (data.workerId !== workerId) throw new HttpError(409, "That worker is not assigned to this job");
  return data;
}

// A client that sends an amount is only checking it; the server's figure wins.
export function assertAmountMatches(sent: number | undefined, due: number): void {
  if (sent !== undefined && sent !== due) {
    throw new HttpError(409, `The amount due for this job is KES ${due}`);
  }
}
