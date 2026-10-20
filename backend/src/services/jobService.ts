import { getDb } from "../config/firebase";
import type { Currency } from "../validation/currency";
import { toDate } from "./escrowService";
import type { PostJobInput } from "../validation/jobs";

export type JobStatus = "open" | "assigned";

export interface Job {
  id: string;
  clientId: string;
  workerId?: string;
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

export interface JobPage {
  jobs: Job[];
  nextCursor: string | null;
}

// Open jobs, newest first. `before` is the previous page's nextCursor.
export async function listOpenJobs({
  limit,
  before,
  currency,
}: {
  limit: number;
  before?: Date;
  currency?: Currency;
}): Promise<JobPage> {
  let q = getDb().collection("jobs").where("status", "==", "open");
  if (currency) q = q.where("currency", "==", currency);
  if (before) q = q.where("createdAt", "<", before);
  const snapshot = await q.orderBy("createdAt", "desc").limit(limit).get();

  const jobs = snapshot.docs.map((doc) => {
    const data = doc.data();
    return { ...(data as Job), id: doc.id, createdAt: toDate(data.createdAt) };
  });

  const nextCursor = jobs.length === limit ? jobs[jobs.length - 1].createdAt.toISOString() : null;
  return { jobs, nextCursor };
}

export interface MyJob extends Job {
  escrowStatus?: string;
  // Clients see who they hired and how many applied; workers see the client.
  counterpartyName?: string;
  applicantCount?: number;
}

// The caller's own jobs, newest first: jobs a client posted, or jobs assigned to a worker.
export async function listMyJobs(userId: string, role: "client" | "worker", limit = 50): Promise<MyJob[]> {
  const db = getDb();
  const snapshot = await db
    .collection("jobs")
    .where(role === "client" ? "clientId" : "workerId", "==", userId)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return Promise.all(
    snapshot.docs.map(async (doc) => {
      const data = doc.data();
      const job: MyJob = { ...(data as Job), id: doc.id, createdAt: toDate(data.createdAt) };

      const counterpartyId = role === "client" ? data.workerId : data.clientId;
      const [escrow, counterparty, applications] = await Promise.all([
        db.collection("escrows").doc(doc.id).get(),
        counterpartyId
          ? db.collection(role === "client" ? "workers" : "clients").doc(counterpartyId).get()
          : undefined,
        role === "client" && data.status === "open"
          ? db.collection("applications").where("jobId", "==", doc.id).get()
          : undefined,
      ]);

      if (escrow.exists) job.escrowStatus = escrow.data()!.status;
      if (counterparty?.exists) job.counterpartyName = counterparty.data()!.name;
      if (applications) job.applicantCount = applications.docs.length;
      return job;
    }),
  );
}
