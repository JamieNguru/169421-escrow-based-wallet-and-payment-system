import bcrypt from "bcryptjs";

import { getDb } from "../config/firebase";
import { HttpError } from "../errors";
import type { RegisterInput } from "../validation/register";

const COLLECTIONS = { client: "clients", worker: "workers" } as const;
const BCRYPT_ROUNDS = 10;

export interface RegisteredUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: RegisterInput["role"];
}

// Clients and workers live in separate collections, so email uniqueness is
// enforced through an emails/{email} index doc written in the same transaction.
export async function registerUser(input: RegisterInput): Promise<RegisteredUser> {
  const db = getDb();
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const emailRef = db.collection("emails").doc(input.email);
  const userRef = db.collection(COLLECTIONS[input.role]).doc();

  await db.runTransaction(async (tx) => {
    if ((await tx.get(emailRef)).exists) {
      throw new HttpError(409, "An account with this email already exists");
    }
    tx.set(emailRef, { role: input.role, userId: userRef.id });
    tx.set(userRef, {
      name: input.name,
      email: input.email,
      phone: input.phone,
      passwordHash,
      createdAt: new Date(),
    });
  });

  return { id: userRef.id, name: input.name, email: input.email, phone: input.phone, role: input.role };
}
