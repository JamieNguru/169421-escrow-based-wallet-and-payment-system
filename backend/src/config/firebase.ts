import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

// Credentials come from a service account key file (FIREBASE_SERVICE_ACCOUNT_PATH).
// When FIRESTORE_EMULATOR_HOST is set, the Admin SDK talks to the local emulator
// and only the project id is needed.
function initApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return initializeApp({ projectId: projectId || "escrow-wallet-local" });
  }

  if (!keyPath) {
    throw new Error(
      "Firestore is not configured: set FIREBASE_SERVICE_ACCOUNT_PATH (or FIRESTORE_EMULATOR_HOST) in .env",
    );
  }

  const serviceAccount = JSON.parse(readFileSync(keyPath, "utf8"));
  return initializeApp({
    credential: cert(serviceAccount),
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
