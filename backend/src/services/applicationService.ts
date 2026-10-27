import { getDb } from "../config/firebase";
import { HttpError } from "../errors";
import type { ApplyToJobInput, UpdateQuoteInput } from "../validation/applications";
import type { Currency } from "../validation/currency";
import { toDate } from "./escrowService";
import type { Job } from "./jobService";
import { toSummary, type KycSummary } from "./kycService";
import { getTrustScore } from "./trustScoreService";

export type ApplicationStatus = "pending" | "selected" | "rejected";

export interface Application {
  id: string;
  jobId: string;
  workerId: string;
  // The worker's quote, in the job's currency (copied by the server, never sent).
  // Applications made before quotes existed have neither.
  price?: number;
  currency?: Currency;
  message?: string;
  status: ApplicationStatus;
  createdAt: Date;
}

// One application per worker per job: the id is deterministic, so a repeat apply collides.
export async function applyToJob(
  workerId: string,
  jobId: string,
  input: ApplyToJobInput,
): Promise<Application> {
  const db = getDb();
  const jobRef = db.collection("jobs").doc(jobId);
  const workerRef = db.collection("workers").doc(workerId);
  const kycRef = db.collection("kyc").doc(workerId);
  const id = `${jobId}_${workerId}`;
  const applicationRef = db.collection("applications").doc(id);

  return db.runTransaction(async (tx) => {
    const [job, worker, kyc, existing] = await Promise.all([
      tx.get(jobRef),
      tx.get(workerRef),
      tx.get(kycRef),
      tx.get(applicationRef),
    ]);

    if (!job.exists) throw new HttpError(404, "Job not found");
    if (job.data()!.status !== "open") throw new HttpError(409, "Job is not open for applications");
    if (!worker.exists) throw new HttpError(404, "Worker not found");
    if (!kyc.exists || kyc.data()!.status !== "verified") {
      throw new HttpError(403, "Verify your identity before applying to jobs");
    }
    if (existing.exists) throw new HttpError(409, "You have already applied to this job");

    const data = {
      jobId,
      workerId,
      price: input.price,
      currency: job.data()!.currency as Currency,
      ...(input.message ? { message: input.message } : {}),
      status: "pending" as const,
      createdAt: new Date(),
    };
    tx.set(applicationRef, data);
    return { id, ...data };
  });
}

// A worker changes their quote (or message) while it is pending and the job is still open.
export async function updateQuote(
  workerId: string,
  jobId: string,
  input: UpdateQuoteInput,
): Promise<Application> {
  const db = getDb();
  const jobRef = db.collection("jobs").doc(jobId);
  const applicationRef = db.collection("applications").doc(`${jobId}_${workerId}`);

  return db.runTransaction(async (tx) => {
    const [job, application] = await Promise.all([tx.get(jobRef), tx.get(applicationRef)]);

    if (!job.exists) throw new HttpError(404, "Job not found");
    if (!application.exists) throw new HttpError(404, "You have not applied to this job");
    if (job.data()!.status !== "open") throw new HttpError(409, "Job is no longer open");
    if (application.data()!.status !== "pending") throw new HttpError(409, "Your application is no longer pending");

    const changes = {
      ...(input.price !== undefined && { price: input.price, currency: job.data()!.currency as Currency }),
      ...(input.message !== undefined && { message: input.message }),
    };
    tx.update(applicationRef, changes);
    return {
      ...(application.data() as Application),
      ...changes,
      id: applicationRef.id,
      createdAt: toDate(application.data()!.createdAt),
    };
  });
}

// Assigns the job to one applicant and rejects the rest, atomically.
export async function selectWorker(
  clientId: string,
  jobId: string,
  workerId: string,
): Promise<{ job: Job; application: Application }> {
  const db = getDb();
  const jobRef = db.collection("jobs").doc(jobId);
  const selectedRef = db.collection("applications").doc(`${jobId}_${workerId}`);
  const applicationsQuery = db.collection("applications").where("jobId", "==", jobId);

  return db.runTransaction(async (tx) => {
    const [job, selected, all] = await Promise.all([
      tx.get(jobRef),
      tx.get(selectedRef),
      tx.get(applicationsQuery),
    ]);

    if (!job.exists) throw new HttpError(404, "Job not found");
    const jobData = job.data()!;
    if (jobData.clientId !== clientId) {
      throw new HttpError(403, "You do not have permission to select a worker for this job");
    }
    if (jobData.status !== "open") throw new HttpError(409, "Job already has a worker");
    if (!selected.exists) throw new HttpError(404, "Application not found");

    // The chosen quote becomes the job's price and is locked from here on.
    const quote = selected.data()!;
    const agreed =
      typeof quote.price === "number"
        ? { agreedPrice: quote.price, agreedCurrency: (quote.currency ?? jobData.currency) as Currency }
        : {};

    tx.update(jobRef, { status: "assigned", workerId, ...agreed });
    tx.update(selectedRef, { status: "selected" });
    for (const doc of all.docs) {
      if (doc.id !== selectedRef.id) tx.update(doc.ref, { status: "rejected" });
    }

    return {
      job: {
        ...(jobData as Job),
        id: jobId,
        status: "assigned",
        workerId,
        ...agreed,
        createdAt: toDate(jobData.createdAt),
      },
      application: {
        ...(selected.data() as Application),
        id: selectedRef.id,
        status: "selected",
        createdAt: toDate(selected.data()!.createdAt),
      },
    };
  });
}

export interface ApplicationWithWorker extends Application {
  // trustLevel is left out when the scoring service can't be reached.
  worker: { id: string; name: string; email: string; trustLevel?: string; kyc: KycSummary | null };
}

const TRUST_TTL_MS = 5 * 60 * 1000;
const TRUST_BATCH_SIZE = 10;
const trustCache = new Map<string, { level: string | undefined; expires: number }>();

export function clearTrustCache(): void {
  trustCache.clear();
}

// Trust levels for a list of workers, cached for a few minutes and scored a
// batch at a time so a long applicant list doesn't flood the ML service. A
// worker who can't be scored simply has no level.
async function workerTrustLevels(workerIds: string[]): Promise<Map<string, string | undefined>> {
  const levels = new Map<string, string | undefined>();
  const missing: string[] = [];
  const now = Date.now();
  for (const id of new Set(workerIds)) {
    const hit = trustCache.get(id);
    if (hit && hit.expires > now) levels.set(id, hit.level);
    else missing.push(id);
  }

  for (let i = 0; i < missing.length; i += TRUST_BATCH_SIZE) {
    const batch = missing.slice(i, i + TRUST_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((id) => getTrustScore(id, "worker")));
    results.forEach((result, index) => {
      const level = result.status === "fulfilled" ? result.value.trustLevel : undefined;
      levels.set(batch[index], level);
      // Failures aren't cached, so the next page load tries again.
      if (level) trustCache.set(batch[index], { level, expires: now + TRUST_TTL_MS });
    });
  }
  return levels;
}

export interface ApplicationPage {
  applications: ApplicationWithWorker[];
  nextCursor: string | null;
}

// Applications for one of the client's jobs, newest first. `before` is the previous page's nextCursor.
export async function listJobApplications(
  clientId: string,
  jobId: string,
  { limit, before }: { limit: number; before?: Date },
): Promise<ApplicationPage> {
  const db = getDb();
  const job = await db.collection("jobs").doc(jobId).get();
  if (!job.exists) throw new HttpError(404, "Job not found");
  if (job.data()!.clientId !== clientId) {
    throw new HttpError(403, "You do not have permission to view this job's applications");
  }

  let q = db.collection("applications").where("jobId", "==", jobId);
  if (before) q = q.where("createdAt", "<", before);
  const snapshot = await q.orderBy("createdAt", "desc").limit(limit).get();

  // Only id, name, email and trust level leave the workers collection: never the password hash.
  const applications: ApplicationWithWorker[] = await Promise.all(
    snapshot.docs.map(async (doc) => {
      const data = doc.data();
      const [worker, kyc] = await Promise.all([
        db.collection("workers").doc(data.workerId).get(),
        db.collection("kyc").doc(data.workerId).get(),
      ]);
      return {
        ...(data as Application),
        id: doc.id,
        createdAt: toDate(data.createdAt),
        // The summary is the only KYC data a client gets: no photos, no full number.
        worker: {
          id: data.workerId,
          name: worker.data()?.name,
          email: worker.data()?.email,
          kyc: toSummary(kyc.exists ? kyc.data() : undefined),
        },
      };
    }),
  );

  const levels = await workerTrustLevels(applications.map((a) => a.workerId));
  for (const application of applications) {
    const trustLevel = levels.get(application.workerId);
    if (trustLevel) application.worker.trustLevel = trustLevel;
  }

  const nextCursor =
    applications.length === limit ? applications[applications.length - 1].createdAt.toISOString() : null;
  return { applications, nextCursor };
}
