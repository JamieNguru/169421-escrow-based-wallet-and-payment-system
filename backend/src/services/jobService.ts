import { getDb } from "../config/firebase";
import { HttpError } from "../errors";
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
  // The accepted quote, set when a worker is chosen. It overrides the budget and can't change.
  agreedPrice?: number;
  agreedCurrency?: Currency;
  // Browse only: the calling worker's own quote on this job, so the page survives a reload.
  myApplication?: { price?: number; currency?: Currency; message?: string; status: string };
  location?: { label: string; lat?: number; lng?: number };
  // Photos are only returned by getJob; lists carry the count instead.
  photos?: string[];
  photoCount?: number;
  // Straight-line distance from the position the worker sent, when the job has coordinates.
  distanceKm?: number;
  createdAt: Date;
}

// A job as lists and responses show it: photos replaced by their count.
function listed(id: string, data: Record<string, any>): Job {
  const { photos, ...rest } = data;
  const count = Array.isArray(photos) ? photos.length : 0;
  return { ...(rest as Job), id, createdAt: toDate(data.createdAt), ...(count > 0 && { photoCount: count }) };
}

const EARTH_RADIUS_KM = 6371;

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h)) * 10) / 10;
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
    ...(input.location && { location: input.location }),
    ...(input.photos?.length && { photos: input.photos }),
    createdAt: new Date(),
  };

  await ref.set(data);
  return listed(ref.id, data);
}

// One job with its photos, for anyone signed in: open jobs are public listings.
export async function getJob(jobId: string): Promise<Job> {
  const snap = await getDb().collection("jobs").doc(jobId).get();
  if (!snap.exists) throw new HttpError(404, "Job not found");
  const data = snap.data()!;
  return { ...listed(jobId, data), ...(data.photos && { photos: data.photos }) };
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
  near,
  workerId,
}: {
  limit: number;
  before?: Date;
  currency?: Currency;
  near?: { lat: number; lng: number };
  workerId?: string;
}): Promise<JobPage> {
  let q = getDb().collection("jobs").where("status", "==", "open");
  if (currency) q = q.where("currency", "==", currency);
  if (before) q = q.where("createdAt", "<", before);
  const snapshot = await q.orderBy("createdAt", "desc").limit(limit).get();

  const jobs = snapshot.docs.map((doc) => {
    const job = listed(doc.id, doc.data());
    const { lat, lng } = job.location ?? {};
    if (near && lat !== undefined && lng !== undefined) job.distanceKm = distanceKm(near, { lat, lng });
    return job;
  });

  if (workerId) {
    // Application ids are `${jobId}_${workerId}`, so each lookup is a single read.
    const mine = await Promise.all(
      jobs.map((job) => getDb().collection("applications").doc(`${job.id}_${workerId}`).get()),
    );
    mine.forEach((snap, i) => {
      if (!snap.exists) return;
      const { price, currency: quoted, message, status } = snap.data()!;
      jobs[i].myApplication = {
        status,
        ...(price !== undefined && { price }),
        ...(quoted && { currency: quoted }),
        ...(message && { message }),
      };
    });
  }

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
      const job: MyJob = listed(doc.id, data);

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
