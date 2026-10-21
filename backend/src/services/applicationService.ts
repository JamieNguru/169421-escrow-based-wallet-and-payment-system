import { getDb } from "../config/firebase";
import { HttpError } from "../errors";
import type { ApplyToJobInput } from "../validation/applications";
import { toDate } from "./escrowService";
import type { Job } from "./jobService";
import { getTrustScore } from "./trustScoreService";

export type ApplicationStatus = "pending" | "selected" | "rejected";

export interface Application {
  id: string;
  jobId: string;
  workerId: string;
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
  const id = `${jobId}_${workerId}`;
  const applicationRef = db.collection("applications").doc(id);

  return db.runTransaction(async (tx) => {
    const [job, worker, existing] = await Promise.all([
      tx.get(jobRef),
      tx.get(workerRef),
      tx.get(applicationRef),
    ]);

    if (!job.exists) throw new HttpError(404, "Job not found");
    if (job.data()!.status !== "open") throw new HttpError(409, "Job is not open for applications");
    if (!worker.exists) throw new HttpError(404, "Worker not found");
    if (existing.exists) throw new HttpError(409, "You have already applied to this job");

    const data = {
      jobId,
      workerId,
      ...(input.message ? { message: input.message } : {}),
      status: "pending" as const,
      createdAt: new Date(),
    };
    tx.set(applicationRef, data);
    return { id, ...data };
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

    tx.update(jobRef, { status: "assigned", workerId });
    tx.update(selectedRef, { status: "selected" });
    for (const doc of all.docs) {
      if (doc.id !== selectedRef.id) tx.update(doc.ref, { status: "rejected" });
    }

    return {
      job: { ...(jobData as Job), id: jobId, status: "assigned", workerId, createdAt: toDate(jobData.createdAt) },
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
  worker: { id: string; name: string; email: string; trustLevel?: string };
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
      const worker = await db.collection("workers").doc(data.workerId).get();
      return {
        ...(data as Application),
        id: doc.id,
        createdAt: toDate(data.createdAt),
        worker: { id: data.workerId, name: worker.data()?.name, email: worker.data()?.email },
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
