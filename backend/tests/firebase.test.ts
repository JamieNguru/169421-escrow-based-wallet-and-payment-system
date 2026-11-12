import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getApps } from "firebase-admin/app";

import { getDb, loadServiceAccount } from "../src/config/firebase";

describe("loadServiceAccount", () => {
  const key = { type: "service_account", project_id: "demo-project", client_email: "x@demo.iam.gserviceaccount.com" };

  test("reads raw JSON from FIREBASE_SERVICE_ACCOUNT_JSON", () => {
    expect(loadServiceAccount({ FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(key) })).toEqual(key);
  });

  test("reads base64-encoded JSON from FIREBASE_SERVICE_ACCOUNT_JSON", () => {
    const encoded = Buffer.from(JSON.stringify(key)).toString("base64");
    expect(loadServiceAccount({ FIREBASE_SERVICE_ACCOUNT_JSON: encoded })).toEqual(key);
  });

  test("prefers the inline key over the file path", () => {
    expect(
      loadServiceAccount({ FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(key), FIREBASE_SERVICE_ACCOUNT_PATH: "/nowhere.json" }),
    ).toEqual(key);
  });

  test("falls back to the key file", () => {
    const dir = mkdtempSync(join(tmpdir(), "fb-key-"));
    const path = join(dir, "key.json");
    writeFileSync(path, JSON.stringify(key));
    expect(loadServiceAccount({ FIREBASE_SERVICE_ACCOUNT_PATH: path })).toEqual(key);
  });

  test("rejects an inline value that is not JSON", () => {
    expect(() => loadServiceAccount({ FIREBASE_SERVICE_ACCOUNT_JSON: "not json at all" })).toThrow(/not valid JSON/);
  });

  test("returns undefined when nothing is set", () => {
    expect(loadServiceAccount({})).toBeUndefined();
  });
});

describe("firestore connection", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  test("throws a clear error when no credentials are configured", () => {
    delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
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
