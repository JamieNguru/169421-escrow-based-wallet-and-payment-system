import { getDb } from "../config/firebase";
import { HttpError } from "../errors";
import type { ApplyToJobInput } from "../validation/applications";
import { toDate } from "./escrowService";

export type ApplicationStatus = "pending";

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

export interface ApplicationWithWorker extends Application {
  worker: { id: string; name: string; email: string };
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

  // Only id, name and email leave the workers collection: never the password hash.
  const applications = await Promise.all(
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

  const nextCursor =
    applications.length === limit ? applications[applications.length - 1].createdAt.toISOString() : null;
  return { applications, nextCursor };
}
