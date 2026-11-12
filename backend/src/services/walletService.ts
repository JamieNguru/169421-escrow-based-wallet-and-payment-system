import { getDb } from "../config/firebase";
import { HttpError } from "../errors";

export interface Wallet {
  id: string;
  balance: number;
  escrowBalance: number;
  currency: string;
}

// The caller's own wallet. Clients and workers get one at registration.
export async function getWallet(ownerId: string): Promise<Wallet> {
  const snapshot = await getDb().collection("wallets").where("ownerId", "==", ownerId).limit(1).get();
  if (snapshot.empty) throw new HttpError(404, "Wallet not found");

  const doc = snapshot.docs[0];
  const { balance, escrowBalance, currency } = doc.data();
  return { id: doc.id, balance, escrowBalance, currency };
}
