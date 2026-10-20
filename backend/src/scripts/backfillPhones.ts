import "dotenv/config";

import { getDb } from "../config/firebase";

// Phone login looks users up in phones/{phone}. Accounts created before that
// index existed don't have an entry, so this adds the missing ones. A phone
// shared by two accounts is reported and left alone (the first one wins).
// Usage: `npm run backfill:phones`.
async function main() {
  const db = getDb();
  const roles = { clients: "client", workers: "worker", admins: "admin" } as const;
  let added = 0;

  for (const [collection, role] of Object.entries(roles)) {
    const snapshot = await db.collection(collection).get();
    for (const doc of snapshot.docs) {
      const phone = doc.data().phone;
      if (typeof phone !== "string" || !phone) continue;

      const ref = db.collection("phones").doc(phone);
      const existing = await ref.get();
      if (!existing.exists) {
        await ref.set({ role, userId: doc.id });
        added++;
      } else if (existing.data()!.userId !== doc.id) {
        console.warn(`Phone ${phone} is shared by ${role} ${doc.id} and ${existing.data()!.role} ${existing.data()!.userId}`);
      }
    }
  }
  console.log(`Added ${added} phone index entries`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
