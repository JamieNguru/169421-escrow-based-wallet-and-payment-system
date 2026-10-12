import { getDb } from "../config/firebase";
import { toDate } from "./escrowService";

export interface Transaction {
  id: string;
  // Absent on wallet-level entries such as withdrawals.
  jobId?: string;
  type: string;
  amount: number;
  currency: string;
  fromUserId: string;
  toUserId: string;
  createdAt: Date;
}

export interface TransactionPage {
  transactions: Transaction[];
  nextCursor: string | null;
}

// A user's ledger entries, newest first. Firestore can't OR across two
// fields cheaply, so query as sender and as recipient and merge. `before`
// is the previous page's nextCursor.
export async function listTransactions(
  userId: string,
  { limit, before }: { limit: number; before?: Date },
): Promise<TransactionPage> {
  const collection = getDb().collection("transactions");

  const query = (field: "fromUserId" | "toUserId") => {
    let q = collection.where(field, "==", userId);
    if (before) q = q.where("createdAt", "<", before);
    return q.orderBy("createdAt", "desc").limit(limit).get();
  };
  const [sent, received] = await Promise.all([query("fromUserId"), query("toUserId")]);

  const byId = new Map<string, Transaction>();
  for (const doc of [...sent.docs, ...received.docs]) {
    const data = doc.data();
    byId.set(doc.id, { ...(data as Transaction), id: doc.id, createdAt: toDate(data.createdAt) });
  }

  const transactions = [...byId.values()]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);

  const nextCursor =
    transactions.length === limit ? transactions[transactions.length - 1].createdAt.toISOString() : null;
  return { transactions, nextCursor };
}
