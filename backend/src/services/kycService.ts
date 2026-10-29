import { createHash } from "crypto";

import { getDb } from "../config/firebase";
import { HttpError } from "../errors";
import { toDate } from "./escrowService";
import type { SubmitKycInput } from "../validation/kyc";

export type KycStatus = "verified" | "rejected";
export type IdType = "national_id" | "passport";

export interface KycImages {
  front?: string;
  back?: string;
  selfie?: string;
}

// What a worker sees of their own record: never the images or the full number.
export interface MyKyc {
  status: KycStatus;
  fullName: string;
  idType: IdType;
  idNumber: string;
  // Masked like the ID number; absent until a tax PIN is added.
  taxPin?: string;
  reasons: string[];
  submittedAt: Date;
  verifiedAt?: Date;
}

// What a client choosing a worker sees: nothing beyond this.
export interface KycSummary {
  verified: true;
  name: string;
  idType: IdType;
  idNumberMasked: string;
  verifiedAt: Date;
}

export function maskIdNumber(idNumber: string): string {
  return `${"*".repeat(Math.max(idNumber.length - 3, 0))}${idNumber.slice(-3)}`;
}

// Keeps the first and last characters, e.g. A*********Z.
export function maskTaxPin(taxPin: string): string {
  return `${taxPin[0]}${"*".repeat(Math.max(taxPin.length - 2, 0))}${taxPin.slice(-1)}`;
}

const idHash = (idType: string, idNumber: string) =>
  createHash("sha256").update(`${idType}:${idNumber}`).digest("hex");

const normalizeName = (name: string) => name.toLowerCase().replace(/\s+/g, " ").trim();

function ageOn(dateOfBirth: string, today: Date): number {
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    today.getUTCMonth() < dob.getUTCMonth() ||
    (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

// The simulated verification provider. A real ID-verification service would
// replace only this function; everything around it stays the same.
export function runChecks(
  input: SubmitKycInput,
  accountName: string,
  idTakenByAnother: boolean,
  today = new Date(),
): string[] {
  const reasons: string[] = [];

  const formatOk =
    input.idType === "national_id" ? /^\d{7,8}$/.test(input.idNumber) : /^[A-Z0-9]{6,9}$/.test(input.idNumber);
  if (!formatOk) {
    reasons.push(
      input.idType === "national_id"
        ? "The national ID number must be 7 or 8 digits."
        : "The passport number must be 6 to 9 letters or digits.",
    );
  }

  const dob = new Date(`${input.dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(dob.getTime()) || dob.toISOString().slice(0, 10) !== input.dateOfBirth) {
    reasons.push("The date of birth is not a real date.");
  } else if (ageOn(input.dateOfBirth, today) < 18) {
    reasons.push("You must be 18 or older.");
  }

  if (normalizeName(input.fullName) !== normalizeName(accountName)) {
    reasons.push("The name on the ID must match the name on your account.");
  }

  const { front, back, selfie } = input.images;
  if (!front) {
    reasons.push(
      input.idType === "passport" ? "A photo of the passport page is required." : "A photo of the front of the ID is required.",
    );
  }
  if (input.idType === "national_id" && !back) reasons.push("A photo of the back of the ID is required.");
  if (!selfie) reasons.push("A selfie is required.");

  if (idTakenByAnother) reasons.push("This ID is already registered to another account.");
  if (!input.consent) reasons.push("You must consent to your ID details being stored and checked.");

  return reasons;
}

function toMyKyc(data: Record<string, any>): MyKyc {
  return {
    status: data.status,
    fullName: data.fullName,
    idType: data.idType,
    idNumber: maskIdNumber(data.idNumber),
    ...(data.taxPin && { taxPin: maskTaxPin(data.taxPin) }),
    reasons: data.reasons ?? [],
    submittedAt: toDate(data.submittedAt),
    ...(data.verifiedAt && { verifiedAt: toDate(data.verifiedAt) }),
  };
}

// Runs the checks and saves the outcome. A rejected worker can submit again.
export async function submitKyc(workerId: string, input: SubmitKycInput): Promise<MyKyc> {
  const db = getDb();
  const workerRef = db.collection("workers").doc(workerId);
  const kycRef = db.collection("kyc").doc(workerId);
  const filesRef = db.collection("kycFiles").doc(workerId);
  const indexRef = db.collection("kycIdIndex").doc(idHash(input.idType, input.idNumber));

  return db.runTransaction(async (tx) => {
    const [worker, existing, index] = await Promise.all([tx.get(workerRef), tx.get(kycRef), tx.get(indexRef)]);
    if (!worker.exists) throw new HttpError(404, "Worker not found");
    if (existing.exists && existing.data()!.status === "verified") {
      throw new HttpError(409, "You are already verified");
    }

    const idTakenByAnother = index.exists && index.data()!.workerId !== workerId;
    const reasons = runChecks(input, worker.data()!.name, idTakenByAnother);
    const now = new Date();
    const status: KycStatus = reasons.length === 0 ? "verified" : "rejected";

    const record = {
      status,
      fullName: input.fullName,
      idType: input.idType,
      idNumber: input.idNumber,
      dateOfBirth: input.dateOfBirth,
      ...(input.taxPin && { taxPin: input.taxPin }),
      consent: input.consent,
      consentAt: now,
      reasons,
      submittedAt: now,
      ...(status === "verified" && { verifiedAt: now }),
    };
    tx.set(kycRef, record);
    tx.set(filesRef, { workerId, images: input.images, updatedAt: now });
    // Only a verified ID is claimed, so a rejected attempt doesn't lock the number.
    if (status === "verified") tx.set(indexRef, { workerId, createdAt: now });

    return toMyKyc(record);
  });
}

// Adds or replaces the tax PIN on a verified record, so a worker who is already
// verified can add it when a payout asks for it.
export async function addTaxPin(workerId: string, taxPin: string): Promise<MyKyc> {
  const ref = getDb().collection("kyc").doc(workerId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()!.status !== "verified") {
    throw new HttpError(409, "Verify your identity before adding a tax PIN");
  }
  await ref.update({ taxPin, taxPinAddedAt: new Date() });
  return toMyKyc({ ...snap.data()!, taxPin });
}

// null when the worker has not submitted anything yet.
export async function getMyKyc(workerId: string): Promise<MyKyc | null> {
  const snap = await getDb().collection("kyc").doc(workerId).get();
  return snap.exists ? toMyKyc(snap.data()!) : null;
}

export function toSummary(data: Record<string, any> | undefined): KycSummary | null {
  if (!data || data.status !== "verified") return null;
  return {
    verified: true,
    name: data.fullName,
    idType: data.idType,
    idNumberMasked: maskIdNumber(data.idNumber),
    verifiedAt: toDate(data.verifiedAt),
  };
}

export async function getKycSummary(workerId: string): Promise<KycSummary | null> {
  const snap = await getDb().collection("kyc").doc(workerId).get();
  return toSummary(snap.exists ? snap.data() : undefined);
}

// Workers who are party to at least one dispute: the only ones an admin may view.
async function disputedWorkerIds(): Promise<string[]> {
  const snap = await getDb().collection("disputes").get();
  const docs = snap.docs as Array<{ data: () => Record<string, any> }>;
  return [...new Set(docs.map((d) => d.data().workerId as string))].filter(Boolean);
}

export interface AdminKycRow {
  workerId: string;
  workerName?: string;
  status: KycStatus | "not_submitted";
  idType?: IdType;
  verifiedAt?: Date;
}

export async function listDisputedWorkerKyc(): Promise<AdminKycRow[]> {
  const db = getDb();
  const ids = await disputedWorkerIds();
  return Promise.all(
    ids.map(async (workerId) => {
      const [worker, kyc] = await Promise.all([
        db.collection("workers").doc(workerId).get(),
        db.collection("kyc").doc(workerId).get(),
      ]);
      const data = kyc.exists ? kyc.data()! : undefined;
      return {
        workerId,
        workerName: worker.exists ? worker.data()!.name : undefined,
        status: data ? (data.status as KycStatus) : ("not_submitted" as const),
        ...(data && { idType: data.idType as IdType }),
        ...(data?.verifiedAt && { verifiedAt: toDate(data.verifiedAt) }),
      };
    }),
  );
}

export interface AdminKycDetail {
  workerId: string;
  workerName?: string;
  status: KycStatus;
  fullName: string;
  idType: IdType;
  idNumber: string;
  dateOfBirth: string;
  consent: boolean;
  reasons: string[];
  submittedAt: Date;
  verifiedAt?: Date;
  images: KycImages;
}

// Full KYC for a disputed worker. Every successful view is written to the access log.
export async function getKycForAdmin(adminId: string, workerId: string): Promise<AdminKycDetail> {
  const db = getDb();
  if (!(await disputedWorkerIds()).includes(workerId)) {
    throw new HttpError(403, "KYC can only be viewed for workers involved in a dispute");
  }

  const [worker, kyc, files] = await Promise.all([
    db.collection("workers").doc(workerId).get(),
    db.collection("kyc").doc(workerId).get(),
    db.collection("kycFiles").doc(workerId).get(),
  ]);
  if (!kyc.exists) throw new HttpError(404, "This worker has not submitted verification");

  await db.collection("kycAccessLog").add({ adminId, workerId, viewedAt: new Date() });

  const data = kyc.data()!;
  return {
    workerId,
    workerName: worker.exists ? worker.data()!.name : undefined,
    status: data.status,
    fullName: data.fullName,
    idType: data.idType,
    idNumber: data.idNumber,
    dateOfBirth: data.dateOfBirth,
    consent: data.consent,
    reasons: data.reasons ?? [],
    submittedAt: toDate(data.submittedAt),
    ...(data.verifiedAt && { verifiedAt: toDate(data.verifiedAt) }),
    images: files.exists ? (files.data()!.images ?? {}) : {},
  };
}
