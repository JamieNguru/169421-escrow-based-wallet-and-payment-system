# Backend

Node.js + Express API for the escrow-based wallet and payment system, written in TypeScript.

## Setup

```
npm install
cp .env.example .env
```

## Firestore

Create a Firebase project, enable Firestore, then download a service account key (Project settings > Service accounts) and point `FIREBASE_SERVICE_ACCOUNT_PATH` in `.env` at it. Key files are git-ignored. To work offline, set `FIRESTORE_EMULATOR_HOST` instead. Code gets the database via `getDb()` from `src/config/firebase.ts`.

## Run

```
npm run dev     # runs src/ directly with tsx, restarts on file changes
npm run build   # compiles src/ to dist/
npm start       # runs the compiled dist/server.js
```

The API listens on `PORT` from `.env` (default 4000). Check it's up with `GET /api/health`.

## Test and type-check

```
npm test          # Jest + Supertest (via ts-jest)
npm run typecheck # tsc --noEmit over src/ and tests/
```

TypeScript is pinned to 6.x because ts-jest doesn't support TypeScript 7 yet.

## Structure

- `src/app.ts` — builds the Express app (used by both the server and the tests)
- `src/server.ts` — loads `.env` and starts listening
- `src/config/` — external service setup (Firestore)
- `src/routes/` — route handlers, one file per resource
- `src/middleware/` — shared middleware (404 and error handling)
- `tests/` — Jest + Supertest tests
