# Backend

Node.js + Express API for the escrow-based wallet and payment system, written in TypeScript.

## Setup

```
npm install
cp .env.example .env
```

## Firestore

Create a Firebase project, enable Firestore, then download a service account key (Project settings > Service accounts) and point `FIREBASE_SERVICE_ACCOUNT_PATH` in `.env` at it. Key files are git-ignored. To work offline, set `FIRESTORE_EMULATOR_HOST` instead. Code gets the database via `getDb()` from `src/config/firebase.ts`.

## Auth

`POST /api/auth/register` creates a client or worker account.

```
{ "name": "Jane Doe", "email": "jane@example.com", "phone": "0712345678", "password": "at-least-8-chars", "role": "client" }
```

- `role` is `client` or `worker`; admins cannot self-register.
- `phone` accepts `07xx`, `01xx`, `+254...` or `254...` and is stored as `254XXXXXXXXX`.
- Returns `201` with `{ id, name, email, phone, role }`, `400` for invalid input, `409` if the email is taken.
- Users are stored in the `clients` or `workers` collection with a bcrypt `passwordHash`. An `emails/{email}` doc enforces uniqueness across both.

`POST /api/auth/login` takes `{ "email", "password" }` and returns `{ token, user }`. The token is a JWT (HS256) with `sub` (user id) and `role`, valid for `JWT_EXPIRES_IN` (default `1d`) and signed with `JWT_SECRET`. Send it as `Authorization: Bearer <token>`. A wrong email or password returns the same `401`, and invalid input returns `400`. Admins sign in the same way.

Admins cannot self-register. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` and run `npm run seed:admin` to create one in the `admins` collection.

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
