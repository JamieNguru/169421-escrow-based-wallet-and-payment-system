import { getDb } from "../config/firebase";
import { HttpError } from "../errors";
import { toDate } from "./escrowService";

type Doc = { id: string; data: () => Record<string, any> };

async function nameOf(collection: "clients" | "workers", id?: string): Promise<string | undefined> {
  if (!id) return undefined;
  const snap = await getDb().collection(collection).doc(id).get();
  return snap.exists ? snap.data()!.name : undefined;
}

export interface AdminDispute {
  jobId: string;
  jobTitle?: string;
  amount: number;
  currency: string;
  status: "open" | "resolved";
  reason: string;
  raisedByRole: "client" | "worker";
  clientId: string;
  clientName?: string;
  workerId: string;
  workerName?: string;
  createdAt: Date;
  photoCount?: number;
  // Only on the detail response.
  photos?: string[];
  decision?: string;
  clientAmount?: number;
  workerAmount?: number;
  resolution?: string;
}

// A dispute with the job title and both parties' names. Photos are heavy, so
// only the detail view includes them; lists carry the count.
async function withNames(docId: string, data: Record<string, any>, includePhotos: boolean): Promise<AdminDispute> {
  const db = getDb();
  const [job, clientName, workerName] = await Promise.all([
    db.collection("jobs").doc(data.jobId ?? docId).get(),
    nameOf("clients", data.clientId),
    nameOf("workers", data.workerId),
  ]);
  const { photos, ...rest } = data;
  const count = Array.isArray(photos) ? photos.length : 0;
  return {
    ...(rest as AdminDispute),
    jobId: data.jobId ?? docId,
    jobTitle: job.exists ? job.data()!.title : undefined,
    clientName,
    workerName,
    createdAt: toDate(data.createdAt),
    ...(count > 0 && { photoCount: count }),
    ...(includePhotos && count > 0 && { photos }),
  };
}

export async function getDispute(jobId: string): Promise<AdminDispute> {
  const snap = await getDb().collection("disputes").doc(jobId).get();
  if (!snap.exists) throw new HttpError(404, "Dispute not found");
  return withNames(jobId, snap.data()!, true);
}

export interface AdminDisputePage {
  disputes: AdminDispute[];
  nextCursor: string | null;
}

// Disputes for the admin queue, newest first, with the job title and both parties' names.
export async function listDisputes({
  status,
  limit,
  before,
}: {
  status?: "open" | "resolved";
  limit: number;
  before?: Date;
}): Promise<AdminDisputePage> {
  const db = getDb();
  let q = db.collection("disputes") as any;
  if (status) q = q.where("status", "==", status);
  if (before) q = q.where("createdAt", "<", before);
  const snapshot = await q.orderBy("createdAt", "desc").limit(limit).get();

  const disputes = await Promise.all((snapshot.docs as Doc[]).map((doc) => withNames(doc.id, doc.data(), false)));

  const nextCursor = disputes.length === limit ? disputes[disputes.length - 1].createdAt.toISOString() : null;
  return { disputes, nextCursor };
}

export interface AdminPayment {
  id: string;
  kind: "payment" | "withdrawal";
  status: string;
  amount: number;
  currency: string;
  phone?: string;
  jobId?: string;
  userId: string;
  userName?: string;
  failureReason?: string;
  createdAt: Date;
}

export interface AdminPaymentPage {
  payments: AdminPayment[];
  nextCursor: string | null;
}

// M-Pesa money in (STK pushes) and out (B2C withdrawals) in one feed, newest
// first. Each source is queried on its own and the two are merged.
export async function listPayments({
  status,
  limit,
  before,
}: {
  status?: string;
  limit: number;
  before?: Date;
}): Promise<AdminPaymentPage> {
  const db = getDb();
  const query = (collection: "payments" | "withdrawals") => {
    let q = db.collection(collection) as any;
    if (status) q = q.where("status", "==", status);
    if (before) q = q.where("createdAt", "<", before);
    return q.orderBy("createdAt", "desc").limit(limit).get();
  };
  const [payments, withdrawals] = await Promise.all([query("payments"), query("withdrawals")]);

  const rows: AdminPayment[] = await Promise.all([
    ...(payments.docs as Doc[]).map(async (doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        kind: "payment" as const,
        status: data.status,
        amount: data.amount,
        currency: data.currency,
        phone: data.phone,
        jobId: data.jobId,
        userId: data.clientId,
        userName: await nameOf("clients", data.clientId),
        ...(data.failureReason && { failureReason: data.failureReason }),
        createdAt: toDate(data.createdAt),
      };
    }),
    ...(withdrawals.docs as Doc[]).map(async (doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        kind: "withdrawal" as const,
        status: data.status,
        amount: data.amount,
        currency: data.currency,
        phone: data.phone,
        userId: data.workerId,
        userName: await nameOf("workers", data.workerId),
        ...(data.failureReason && { failureReason: data.failureReason }),
        createdAt: toDate(data.createdAt),
      };
    }),
  ]);

  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const page = rows.slice(0, limit);
  const nextCursor = rows.length >= limit ? page[page.length - 1].createdAt.toISOString() : null;
  return { payments: page, nextCursor };
}
