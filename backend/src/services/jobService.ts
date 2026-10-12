import { getDb } from "../config/firebase";
import type { Currency } from "../validation/currency";
import type { PostJobInput } from "../validation/jobs";

export type JobStatus = "open";

export interface Job {
  id: string;
  clientId: string;
  title: string;
  description: string;
  budget: number;
  currency: Currency;
  status: JobStatus;
  createdAt: Date;
}

export async function postJob(clientId: string, input: PostJobInput): Promise<Job> {
  const ref = getDb().collection("jobs").doc();
  const data = {
    clientId,
    title: input.title,
    description: input.description,
    budget: input.budget,
    currency: input.currency,
    status: "open" as const,
    createdAt: new Date(),
  };

  await ref.set(data);
  return { id: ref.id, ...data };
}
