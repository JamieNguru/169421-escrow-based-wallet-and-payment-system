import { getApps } from "firebase-admin/app";

import { getDb } from "../src/config/firebase";

describe("firestore connection", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  test("throws a clear error when no credentials are configured", () => {
    delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    delete process.env.FIRESTORE_EMULATOR_HOST;

    expect(() => getDb()).toThrow(/Firestore is not configured/);
  });

  test("returns a Firestore instance against the emulator without a key", () => {
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

    const db = getDb();

    expect(typeof db.collection).toBe("function");
    expect(getApps()).toHaveLength(1);
    expect(getDb()).toBe(db);
  });
});
