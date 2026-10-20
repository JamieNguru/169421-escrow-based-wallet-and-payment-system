import bcrypt from "bcryptjs";

import { getDb } from "../config/firebase";
import { HttpError } from "../errors";
import type { ListUsersQuery, SetUserStatusInput } from "../validation/admin";
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
  walletId?: string;
}

// Each role lives in its own collection, so email uniqueness is enforced
// through an emails/{email} index doc written in the same transaction.
// Public registration only allows client and worker (see registerSchema);
// admins are created by the seed script. Clients and workers also get a
// wallet, written in the same transaction; admins don't hold funds.
export async function createUser(input: NewUser): Promise<RegisteredUser> {
  const db = getDb();
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const emailRef = db.collection("emails").doc(input.email);
  const userRef = db.collection(COLLECTIONS[input.role]).doc();
  const walletRef = input.role === "admin" ? undefined : db.collection("wallets").doc();

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
    if (walletRef) {
      tx.set(walletRef, {
        ownerId: userRef.id,
        ownerRole: input.role,
        currency: "KES",
        balance: 0,
        escrowBalance: 0,
        createdAt: new Date(),
      });
    }
  });

  return {
    id: userRef.id,
    name: input.name,
    email: input.email,
    ...(input.phone && { phone: input.phone }),
    role: input.role,
    ...(walletRef && { walletId: walletRef.id }),
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

  // Only reported after the password matches, so it doesn't reveal which
  // emails are registered. Tokens issued before the suspension stay valid
  // until they expire.
  if (user.status === "suspended") {
    throw new HttpError(403, "This account has been suspended");
  }

  return {
    id: userId,
    name: user.name,
    email: user.email,
    ...(user.phone && { phone: user.phone }),
    role,
  };
}

export type UserStatus = "active" | "suspended";

export interface AdminUserView {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: Role;
  status: UserStatus;
  statusReason?: string;
  createdAt: string;
}

export interface AdminUserDetail extends AdminUserView {
  wallet?: { id: string; balance: number; escrowBalance: number; currency: string };
}

// Firestore returns Timestamps; the in-memory test stores hold plain Dates.
function toDate(value: unknown): Date {
  const date = (value as { toDate?: () => Date } | undefined)?.toDate?.() ?? value;
  return date instanceof Date ? date : new Date(0);
}

// Never includes passwordHash. A missing status counts as active, so users
// created before suspension existed need no migration.
function toAdminView(role: Role, id: string, data: Record<string, any>): AdminUserView {
  return {
    id,
    name: data.name,
    email: data.email,
    ...(data.phone && { phone: data.phone }),
    role,
    status: data.status === "suspended" ? "suspended" : "active",
    ...(data.statusReason && { statusReason: data.statusReason }),
    createdAt: toDate(data.createdAt).toISOString(),
  };
}

// Sorts newest first; the key doubles as the pagination cursor.
const sortKey = (user: AdminUserView) =>
  `${String(Date.parse(user.createdAt)).padStart(15, "0")}|${user.role}|${user.id}`;

// Reads the matching collections in full and pages in memory, which is fine
// at this platform's scale.
export async function listUsers(
  query: ListUsersQuery,
): Promise<{ users: AdminUserView[]; nextCursor?: string }> {
  const db = getDb();
  const roles = query.role ? [query.role] : (Object.keys(COLLECTIONS) as Role[]);

  const snapshots = await Promise.all(roles.map((role) => db.collection(COLLECTIONS[role]).get()));
  const all = snapshots
    .flatMap((snapshot, i) => snapshot.docs.map((doc) => toAdminView(roles[i], doc.id, doc.data())))
    .filter((user) => !query.status || user.status === query.status)
    .sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : -1));

  const startAfter = query.startAfter;
  const remaining = startAfter ? all.filter((user) => sortKey(user) < startAfter) : all;
  const users = remaining.slice(0, query.limit);

  return {
    users,
    ...(remaining.length > users.length && { nextCursor: sortKey(users[users.length - 1]) }),
  };
}

async function loadUser(role: Role, id: string) {
  const ref = getDb().collection(COLLECTIONS[role]).doc(id);
  const doc = await ref.get();
  if (!doc.exists) {
    throw new HttpError(404, "User not found");
  }
  return { ref, data: doc.data() as Record<string, any> };
}

// Clients and workers have a wallet; admins don't.
export async function getUser(role: Role, id: string): Promise<AdminUserDetail> {
  const { data } = await loadUser(role, id);
  const user = toAdminView(role, id, data);
  if (role === "admin") {
    return user;
  }

  const wallets = await getDb()
    .collection("wallets")
    .where("ownerId", "==", id)
    .where("ownerRole", "==", role)
    .limit(1)
    .get();
  const wallet = wallets.docs[0];
  return {
    ...user,
    ...(wallet && {
      wallet: {
        id: wallet.id,
        balance: wallet.data().balance,
        escrowBalance: wallet.data().escrowBalance,
        currency: wallet.data().currency,
      },
    }),
  };
}

// Admin accounts can't be suspended, which also stops an admin suspending
// themselves. Suspension is enforced at login only (see authenticateUser).
export async function setUserStatus(
  adminId: string,
  role: Role,
  id: string,
  input: SetUserStatusInput,
): Promise<AdminUserView> {
  if (role === "admin") {
    throw new HttpError(403, "Admin accounts cannot be suspended");
  }

  const { ref, data } = await loadUser(role, id);
  const update = {
    status: input.status,
    statusReason: input.reason ?? null,
    statusUpdatedAt: new Date(),
    statusUpdatedBy: adminId,
  };
  await ref.update(update);

  return toAdminView(role, id, { ...data, ...update });
}
