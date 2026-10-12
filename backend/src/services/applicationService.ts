import { getDb } from "../config/firebase";
import { HttpError } from "../errors";
import type { ApplyToJobInput } from "../validation/applications";

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
