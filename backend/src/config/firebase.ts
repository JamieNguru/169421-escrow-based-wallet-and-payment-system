import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp, type App, type ServiceAccount as AdminServiceAccount } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

type ServiceAccount = { project_id?: string; [key: string]: unknown };

// The service account key, from FIREBASE_SERVICE_ACCOUNT_JSON (the key file's
// contents, raw or base64, for hosts with no file system such as Vercel) or else
// from the file at FIREBASE_SERVICE_ACCOUNT_PATH. Undefined when neither is set.
export function loadServiceAccount(env: NodeJS.ProcessEnv = process.env): ServiceAccount | undefined {
  const inline = env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) {
    const json = inline.startsWith("{") ? inline : Buffer.from(inline, "base64").toString("utf8");
    try {
      return JSON.parse(json);
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON or base64-encoded JSON");
    }
  }
  if (env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    return JSON.parse(readFileSync(env.FIREBASE_SERVICE_ACCOUNT_PATH, "utf8"));
  }
  return undefined;
}

// When FIRESTORE_EMULATOR_HOST is set, the Admin SDK talks to the local emulator
// and only the project id is needed.
function initApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  const projectId = process.env.FIREBASE_PROJECT_ID;

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return initializeApp({ projectId: projectId || "escrow-wallet-local" });
  }

  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) {
    throw new Error(
      "Firestore is not configured: set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON (or FIRESTORE_EMULATOR_HOST) in .env",
    );
  }

  return initializeApp({
    // The key file uses snake_case fields (private_key, client_email), which cert() accepts.
    credential: cert(serviceAccount as unknown as AdminServiceAccount),
    projectId: projectId || serviceAccount.project_id,
  });
}

let db: Firestore | undefined;

export function getDb(): Firestore {
  if (!db) {
    db = getFirestore(initApp());
  }
  return db;
}
