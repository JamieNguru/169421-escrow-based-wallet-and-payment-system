import bcrypt from "bcryptjs";

import { getDb } from "../config/firebase";
import { HttpError } from "../errors";
import type { LoginInput } from "../validation/login";
import type { RegisterInput } from "../validation/register";

const COLLECTIONS = { client: "clients", worker: "workers", admin: "admins" } as const;
const BCRYPT_ROUNDS = 10;

export type Role = keyof typeof COLLECTIONS;

export interface NewUser {
  name: string;
  email: string;
  phone?: string;
  password: string;
  role: Role;
}

export interface RegisteredUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: Role;
}

// Each role lives in its own collection, so email uniqueness is enforced
// through an emails/{email} index doc written in the same transaction.
// Public registration only allows client and worker (see registerSchema);
// admins are created by the seed script.
export async function createUser(input: NewUser): Promise<RegisteredUser> {
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
      ...(input.phone && { phone: input.phone }),
      passwordHash,
      createdAt: new Date(),
    });
  });

  return {
    id: userRef.id,
    name: input.name,
    email: input.email,
    ...(input.phone && { phone: input.phone }),
    role: input.role,
  };
}

export function registerUser(input: RegisterInput): Promise<RegisteredUser> {
  return createUser(input);
}

// Compared against when the email is unknown, so response time doesn't reveal
// which emails are registered.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", BCRYPT_ROUNDS);
const INVALID_LOGIN = "Invalid email or password";

export async function authenticateUser(input: LoginInput): Promise<RegisteredUser> {
  const db = getDb();

  const emailDoc = await db.collection("emails").doc(input.email).get();
  const { role, userId } = (emailDoc.data() ?? {}) as Partial<{ role: Role; userId: string }>;
  const userDoc = role && userId ? await db.collection(COLLECTIONS[role]).doc(userId).get() : undefined;
  const user = userDoc?.data();

  const matches = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !role || !userId || !matches) {
    throw new HttpError(401, INVALID_LOGIN);
  }

  return {
    id: userId,
    name: user.name,
    email: user.email,
    ...(user.phone && { phone: user.phone }),
    role,
  };
}
