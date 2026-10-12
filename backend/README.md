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

## Authorization

`src/middleware/auth.ts` protects routes. `authenticate` reads `Authorization: Bearer <token>` and sets `req.user` to `{ sub, role }`; `requireRole` then restricts a route to one or more roles.

```ts
router.post("/jobs", authenticate, requireRole("client"), handler);
router.get("/disputes", authenticate, requireRole("worker", "admin"), handler);
```

- A missing, malformed, wrong-secret or expired token returns `401`.
- A valid token with a role not in the list returns `403`.

## Trust score

The backend calls the Flask trust-scoring service (`trust-scoring-ml/`) at `ML_SERVICE_URL` (default `http://127.0.0.1:5000`) and returns `{ userId, role, trustLevel, probabilities }`.

- `GET /api/trust-score/me`: a client or worker's own score.
- `GET /api/trust-score/:userId?role=client|worker`: any client or worker's score, admin only.

Features come from the optional `trustStats` object on the user's document, with placeholder defaults for anything missing, until job and escrow history can be computed. A missing user returns `404`; if the service is down, times out (5s) or errors, the response is `503`.

## Escrow state machine

`src/services/escrowStateMachine.ts` defines the fund lifecycle as a pure module. It validates a status change and returns the wallet changes it implies; the caller applies them (e.g. in a Firestore transaction). `completed` and `refunded` are terminal.

| Event | From to | Allowed actor |
|---|---|---|
| `fund` | `pending` to `in_escrow` | client |
| `release` | `in_escrow` to `completed` | client, admin |
| `refund` | `in_escrow` to `refunded` | admin |
| `dispute` | `in_escrow` to `disputed` | client, worker |
| `resolve_release` | `disputed` to `completed` | admin |
| `resolve_refund` | `disputed` to `refunded` | admin |

Wallet effects for an amount `A`:

- `fund`: client `balance` -A, client `escrowBalance` +A
- `release`, `resolve_release`: client `escrowBalance` -A, worker `balance` +A
- `refund`, `resolve_refund`: client `escrowBalance` -A, client `balance` +A
- `dispute`: no change

`transition(current, event, actor, amount)` throws `409` for an invalid state/event pair, `403` for an actor that isn't allowed, and `400` for a non-positive amount.

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

- `src/app.ts`: builds the Express app (used by both the server and the tests)
- `src/server.ts`: loads `.env` and starts listening
- `src/config/`: external service setup (Firestore)
- `src/routes/`: route handlers, one file per resource
- `src/middleware/`: shared middleware (auth and role checks, 404 and error handling)
- `tests/`: Jest + Supertest tests
