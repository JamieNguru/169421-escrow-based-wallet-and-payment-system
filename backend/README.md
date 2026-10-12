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
| `submit_work` | `in_escrow` to `work_submitted` | worker |
| `release` | `work_submitted` to `completed` | client, admin |
| `refund` | `in_escrow` or `work_submitted` to `refunded` | admin |
| `dispute` | `in_escrow` or `work_submitted` to `disputed` | client, worker |
| `resolve_release` | `disputed` to `completed` | admin |
| `resolve_refund` | `disputed` to `refunded` | admin |

Wallet effects for an amount `A`:

- `fund`: client `balance` -A, client `escrowBalance` +A
- `release`, `resolve_release`: client `escrowBalance` -A, worker `balance` +A
- `refund`, `resolve_refund`: client `escrowBalance` -A, client `balance` +A
- `submit_work`, `dispute`: no change

`transition(current, event, actor, amount)` throws `409` for an invalid state/event pair, `403` for an actor that isn't allowed, and `400` for a non-positive amount.

## Fund escrow

`POST /api/escrow/fund` (client only) moves funds from the client's wallet into escrow for a job. It runs the `fund` transition from the state machine and creates `escrows/{jobId}` with status `in_escrow`. The wallet update, the escrow doc and an `escrow_fund` ledger record (`transactions/fund-{jobId}`) are written in one Firestore transaction. `jobId` is not yet validated against the `jobs` collection.

Request body:

```json
{ "jobId": "job1", "workerId": "worker1", "amount": 500 }
```

Returns `201` with `{ "escrow": { jobId, clientId, workerId, amount, currency, status, createdAt, fundedAt } }`.

| Status | Cause |
|---|---|
| `400` | Missing or invalid `jobId`, `workerId` or `amount` (must be greater than 0) |
| `401` | Missing or invalid token |
| `403` | Caller is not a client |
| `404` | Worker or client wallet not found |
| `402` | Wallet `balance` is lower than `amount` |
| `409` | The job's escrow is already funded (or past `pending`) |

## View escrow status

`GET /api/escrow/:jobId` returns the escrow for a job, including its current `status`. A client can view escrows they funded, a worker can view escrows assigned to them, and an admin can view any.

Returns `200` with `{ "escrow": { jobId, clientId, workerId, amount, currency, status, createdAt, fundedAt } }`.

| Status | Cause |
|---|---|
| `401` | Missing or invalid token |
| `403` | Caller is not the escrow's client or worker, and not an admin |
| `404` | No escrow exists for the job |

## Mark work complete and confirm completion

`POST /api/escrow/:jobId/complete` (worker only) lets the assigned worker flag the job as done. It runs the `submit_work` transition, sets `status` to `work_submitted` and stamps `workSubmittedAt`. No money moves.

`POST /api/escrow/:jobId/confirm` (client only) lets the client who funded the job accept the work. It runs the `release` transition, moves the amount from the client's `escrowBalance` to the worker's `balance`, sets `status` to `completed` and stamps `completedAt`. The wallets, the escrow doc and an `escrow_release` ledger record (`transactions/release-{jobId}`) are written in one Firestore transaction.

Neither endpoint takes a body. Both return `200` with `{ "escrow": { jobId, clientId, workerId, amount, currency, status, createdAt, fundedAt, workSubmittedAt?, completedAt? } }`.

| Status | Cause |
|---|---|
| `401` | Missing or invalid token |
| `403` | Wrong role, or the caller is not the escrow's assigned worker (`complete`) or funding client (`confirm`) |
| `404` | No escrow exists for the job, or the client or worker wallet is missing (`confirm`) |
| `409` | `complete`: work was already submitted or the escrow is closed. `confirm`: the worker has not submitted work yet, or the escrow is already closed |

## View transaction history

`GET /api/transactions` returns the caller's ledger entries (`transactions` collection), newest first. An entry is included when the caller is its `fromUserId` or `toUserId`. Any role can call it. An admin can pass `userId` to view another user's history.

Query parameters (all optional):

| Param | Meaning |
|---|---|
| `limit` | Page size, 1 to 100 (default 20) |
| `cursor` | The `nextCursor` from the previous page |
| `userId` | Admin only: whose history to return |

Returns `200` with `{ "transactions": [{ id, jobId, type, amount, currency, fromUserId, toUserId, createdAt }], "nextCursor": "<ISO date-time>" | null }`. `type` is `escrow_fund` or `escrow_release`. `nextCursor` is `null` on the last page.

| Status | Cause |
|---|---|
| `400` | Invalid `limit` or `cursor` |
| `401` | Missing or invalid token |
| `403` | `userId` passed by a non-admin |

Firestore needs two composite indexes on `transactions`: `fromUserId` ascending + `createdAt` descending, and `toUserId` ascending + `createdAt` descending.

## Convert currency

`GET /api/wallet/convert` returns a live quote between KES, UGX, TZS and USD. Any signed-in role can call it. It is a quote only; it does not change any wallet or ledger. Rates come from a USD-based feed (default `open.er-api.com`, override with `EXCHANGE_RATE_API_URL`), are cached for an hour, and stale rates are served if a refresh fails.

Query parameters (all required):

| Param | Meaning |
|---|---|
| `from` | Source currency: `KES`, `UGX`, `TZS` or `USD` (case-insensitive) |
| `to` | Target currency, same options |
| `amount` | Amount to convert, greater than 0 |

Returns `200` with `{ "conversion": { from, to, amount, rate, converted, rateUpdatedAt } }`. `rate` is units of `to` per 1 `from`, and `converted` is rounded to 2 decimals.

| Status | Cause |
|---|---|
| `400` | Unsupported or missing currency, or `amount` missing, not a number or not above 0 |
| `401` | Missing or invalid token |
| `503` | The rate provider is unreachable and no cached rates exist |

## Initiate STK Push

`POST /api/payments/stk-push` (client only) starts an M-Pesa Daraja STK Push so the client can pay for a job's escrow from their phone. It prompts the phone and stores a `payments/{CheckoutRequestID}` doc with status `pending`. It does not touch the wallet, escrow or ledger; settling the payment from the Daraja callback is a separate step. Configure the `DARAJA_*` variables in `.env` (see `.env.example`). `DARAJA_CALLBACK_URL` must be a public HTTPS URL, so use a tunnel such as ngrok locally.

Request body (`phone` is optional and falls back to the phone saved at registration):

```json
{ "jobId": "job1", "workerId": "worker1", "amount": 500, "phone": "0708374149" }
```

`amount` must be a whole number of KES. Returns `202` with `{ "payment": { checkoutRequestId, merchantRequestId, jobId, clientId, workerId, amount, currency, phone, status, createdAt }, "message": "<Daraja customer message>" }`.

| Status | Cause |
|---|---|
| `400` | Missing or invalid `jobId`, `workerId`, `amount` or `phone`, or no phone on file |
| `401` | Missing or invalid token |
| `403` | Caller is not a client |
| `404` | Worker not found |
| `409` | The job's escrow is already funded |
| `502` / `503` | Daraja rejected the request / could not be reached |

## Withdraw to M-Pesa (B2C)

`POST /api/payments/withdraw` (worker only) pays part of the worker's wallet balance out to the phone saved at registration through Daraja B2C. The balance is debited straight away and a `withdrawals/{OriginatorConversationID}` doc is stored with status `pending`, along with a `withdrawal` ledger entry. If Daraja refuses the request the wallet is refunded before the error is returned. Configure the B2C `DARAJA_*` variables in `.env` (see `.env.example`). Set `DARAJA_B2C_SHORTCODE` to the **Party A** value on your Daraja Test Credentials page; a wrong shortcode makes Daraja reject the payout with a misleading "The security credential is locked" error.

Request body:

```json
{ "amount": 400 }
```

`amount` must be a whole number of KES. Returns `202` with `{ "withdrawal": { originatorConversationId, conversationId, workerId, amount, currency, phone, status, createdAt } }`.

Daraja reports the outcome to two public endpoints, `POST /api/payments/b2c/result/:secret` and `POST /api/payments/b2c/timeout/:secret`. Set `DARAJA_B2C_RESULT_URL` and `DARAJA_B2C_TIMEOUT_URL` to these, with `DARAJA_B2C_CALLBACK_SECRET` as `:secret` (Daraja does not sign callbacks; a wrong secret gets `404`). A successful result marks the withdrawal `completed` and stores the receipt. A failed result or a timeout marks it `failed`, refunds the wallet and writes a `withdrawal_reversal` ledger entry. Repeated callbacks are ignored.

| Status | Cause |
|---|---|
| `400` | Missing or invalid `amount` |
| `401` | Missing or invalid token |
| `402` | Insufficient wallet balance |
| `403` | Caller is not a worker |
| `404` | Worker or worker wallet not found |
| `409` | No valid phone number on file |
| `502` / `503` | Daraja rejected the request / could not be reached (wallet refunded) |

## Post a job

`POST /api/jobs` (client only) creates a job listing in `jobs/{id}` with status `open`. The id is generated by Firestore and `clientId` comes from the token.

Request body:

```json
{ "title": "Fix my sink", "description": "Leaking kitchen tap", "budget": 1500, "currency": "KES" }
```

`currency` is one of `KES`, `UGX`, `TZS`, `USD` (case-insensitive). Returns `201` with `{ "job": { "id", "clientId", "title", "description", "budget", "currency", "status", "createdAt" } }`.

| Status | Cause |
| --- | --- |
| `400` | Missing or invalid field |
| `401` | Missing or invalid token |
| `403` | Caller is not a client |

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
