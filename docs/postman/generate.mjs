// Rebuilds the Postman collection and environment from docs/openapi.yaml.
// Run from the repository root: node docs/postman/generate.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const specPath = join(here, "..", "openapi.yaml");
const collectionPath = join(here, "escrow-wallet-api.postman_collection.json");
const environmentPath = join(here, "escrow-wallet-api.postman_environment.json");
const tmp = mkdtempSync(join(tmpdir(), "postman-"));
const specJsonPath = join(tmp, "openapi.json");

function npx(args) {
  const result = spawnSync(["npx", "--yes", ...args].join(" "), { stdio: "inherit", shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// The converter ignores request-body examples, so the spec is also bundled to JSON
// and the examples are copied onto the generated requests.
npx(["@redocly/cli@latest", "bundle", `"${specPath}"`, "--ext", "json", "-o", `"${specJsonPath}"`]);
npx([
  "openapi-to-postmanv2",
  "-s", `"${specPath}"`,
  "-o", `"${collectionPath}"`,
  "-O", "folderStrategy=Tags",
]);

const spec = JSON.parse(readFileSync(specJsonPath, "utf8"));
const collection = JSON.parse(readFileSync(collectionPath, "utf8"));

const operations = new Map();
for (const [path, methods] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    operations.set(`${method.toUpperCase()} ${path}`, op);
  }
}

// Ids used in path variables. Replace them in the environment after calling the API.
const pathDefaults = {
  jobId: "job1",
  workerId: "worker1",
  userId: "user1",
  id: "user1",
  role: "worker",
  checkoutRequestId: "sim-1",
};

let withExample = 0;
let withoutAuth = 0;

function visit(items) {
  for (const item of items) {
    if (item.item) {
      visit(item.item);
      continue;
    }
    const { request } = item;
    const path = "/" + request.url.path.map((s) => (s.startsWith(":") ? `{${s.slice(1)}}` : s)).join("/");
    const op = operations.get(`${request.method} ${path}`);
    if (!op) throw new Error(`No spec operation for ${request.method} ${path}`);

    const example = op.requestBody?.content?.["application/json"]?.example;
    if (example !== undefined) {
      request.body = {
        mode: "raw",
        raw: JSON.stringify(example, null, 2),
        options: { raw: { language: "json" } },
      };
      withExample++;
    }

    if (Array.isArray(op.security) && op.security.length === 0) {
      request.auth = { type: "noauth" };
      withoutAuth++;
    }

    for (const variable of request.url.variable ?? []) {
      variable.value = `{{${variable.key}}}`;
    }
  }
}
visit(collection.item);

collection.auth = { type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] };
collection.variable = [
  { key: "baseUrl", value: "http://localhost:4000" },
  { key: "token", value: "" },
  ...Object.entries(pathDefaults).map(([key, value]) => ({ key, value })),
];

const environment = {
  id: "escrow-wallet-local",
  name: "Escrow Wallet - Local",
  values: [
    { key: "baseUrl", value: "http://localhost:4000", type: "default", enabled: true },
    { key: "token", value: "", type: "secret", enabled: true },
    ...Object.entries(pathDefaults).map(([key, value]) => ({ key, value, type: "default", enabled: true })),
  ],
  _postman_variable_scope: "environment",
};

writeFileSync(collectionPath, JSON.stringify(collection, null, 2) + "\n");
writeFileSync(environmentPath, JSON.stringify(environment, null, 2) + "\n");
console.log(`Wrote ${operations.size} requests (${withExample} with a body example, ${withoutAuth} without auth).`);
