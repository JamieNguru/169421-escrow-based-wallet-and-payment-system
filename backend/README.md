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
{ "name": "Jane Doe", "email": "jane@example.com", "phone": "0712345678", "password": "at-least-8-chars", "role": "client", "acceptTerms": true }
```

- `role` is `client` or `worker`; admins cannot self-register.
- `acceptTerms` must be `true`, otherwise `400`. See [Terms of service](#terms-of-service).
- `phone` accepts `07xx`, `01xx`, `+254...` or `254...` and is stored as `254XXXXXXXXX`.
- Returns `201` with `{ id, name, email, phone, role, termsAccepted }`, `400` for invalid input, `409` if the email or phone number is taken.
- Users are stored in the `clients` or `workers` collection with a bcrypt `passwordHash`. `emails/{email}` and `phones/{phone}` docs enforce uniqueness across both roles and are how login finds a user.

`POST /api/auth/login` takes `{ "identifier", "password" }`, where `identifier` is an email or a Kenyan mobile number (`0712345678`, `+254712345678`, ...), and returns `{ token, user }`. `email` is still accepted as the field name. The token is a JWT (HS256) with `sub` (user id) and `role`, valid for `JWT_EXPIRES_IN` (default `1d`) and signed with `JWT_SECRET`. Send it as `Authorization: Bearer <token>`. A wrong email, phone or password, or an unknown email or phone, returns the same `401`, and invalid input returns `400`. Admins sign in the same way.

The login `user` includes `termsAccepted`, which is `false` when the user has not accepted the current terms version.

Accounts created before phone login have no `phones/{phone}` entry, so run `npm run backfill:phones` once to add them (a phone shared by two accounts is reported and left alone).

Admins cannot self-register. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` and run `npm run seed:admin` to create one in the `admins` collection.

## Terms of service

The terms (including the dispute clause) are shown by the frontend at `/terms`. `src/config/terms.ts` holds the current version (`CURRENT_TERMS_VERSION`, e.g. `2026-10-v1`); bump it when the terms change and every user is asked to accept again.

- `GET /api/terms` returns `{ version, url }`.
- Registration stores `termsVersion` and `termsAcceptedAt` on the client or worker document.
- `POST /api/auth/accept-terms` (any signed-in client or worker, no body) records acceptance of the current version and returns `{ termsAccepted: true, termsVersion }`. Admins get `403`.
- Users with no stored version (accounts created before this feature) or an older one get `termsAccepted: false` at login. They can still sign in and browse, but `POST /api/jobs`, `POST /api/escrow/fund`, `POST /api/escrow/:jobId/dispute`, `POST /api/payments/stk-push`, `/top-up` and `/withdraw` return `403` until they accept. Admins are exempt.
- The wording needs a legal or supervisor review before launch.

## Authorization

`src/middleware/auth.ts` protects routes. `authenticate` reads `Authorization: Bearer <token>` and sets `req.user` to `{ sub, role }`; `requireRole` then restricts a route to one or more roles.

```ts
router.post("/jobs", authenticate, requireRole("client"), handler);
router.get("/disputes", authenticate, requireRole("worker", "admin"), handler);
```

- A missing, malformed, wrong-secret or expired token returns `401`.
- A valid token with a role not in the list returns `403`.

## Trust score

The backend calls the Flask trust-scoring service (`trust-scoring-ml/`) at `ML_SERVICE_URL` (default `http://127.0.0.1:5000`) and returns `{ userId, role, trustLevel, probabilities }` (`trustLevel` is `High`, `Medium`, `Low` or `New`).

- `GET /api/trust-score/me`: a client or worker's own score.
- `GET /api/trust-score/:userId?role=client|worker`: any client or worker's score, admin only.

**Where the model's inputs come from.** They are worked out from what the user has actually done (`src/services/trustScoreService.ts`):

| Role | Input | How it is computed |
|---|---|---|
| Worker | `job_completion_rate` | Settled jobs paid out (`completed` or `split`) over all settled jobs (those plus `refunded`) |
| Worker | `dispute_rate` | Disputes on the worker's jobs over their funded jobs |
| Worker | `response_time_hours` | Average time from funding to the worker marking the work done |
| Client | `payment_completion_rate` | Same paid-out over settled share, for the client's jobs |
| Client | `refund_rate` | Refund requests plus disputes the client raised, over their funded jobs |
| Client | `escrow_release_time_hours` | Average time from the work being marked done to the client releasing |

An input that can't be worked out yet (for example, no job has been submitted) falls back to a neutral value near the middle of the training data.

**New users are not scored.** Until a user has `MIN_FINISHED_JOBS` (3) settled jobs, the response is `{ userId, role, trustLevel: "New", probabilities: {}, finishedJobs, jobsNeeded }` and the model is not called. The models were trained on users with hundreds of transactions, so a brand-new account's empty history looked like a bad one and was always scored Low. `New` users are counted under `New` in the admin overview and are never in its low-trust list.

A `trustStats` object on a user's document still overrides the computed inputs (and skips the 3-job rule), so demo accounts can be given any history.

A missing user returns `404`; if the service is down, times out (5s) or errors, the response is `503`.

## Escrow state machine

`src/services/escrowStateMachine.ts` defines the fund lifecycle as a pure module. It validates a status change and returns the wallet changes it implies; the caller applies them (e.g. in a Firestore transaction). `completed`, `refunded` and `split` are terminal.

| Event | From to | Allowed actor |
|---|---|---|
| `fund` | `pending` to `in_escrow` | client |
| `submit_work` | `in_escrow` to `work_submitted` | worker |
| `release` | `work_submitted` to `completed` | client, admin |
| `refund` | `in_escrow` or `work_submitted` to `refunded` | admin |
| `dispute` | `in_escrow` or `work_submitted` to `disputed` | client, worker |
| `resolve_release` | `disputed` to `completed` | admin |
| `resolve_refund` | `disputed` to `refunded` | admin |
| `resolve_split` | `disputed` to `split` | admin |

Wallet effects for an amount `A`:

- `fund`: client `balance` -A, client `escrowBalance` +A
- `release`, `resolve_release`: client `escrowBalance` -A, worker `balance` +A
- `refund`, `resolve_refund`: client `escrowBalance` -A, client `balance` +A
- `resolve_split` with client share `C`: client `escrowBalance` -A, client `balance` +C, worker `balance` +(A-C) (applied by `splitEffects`, since it needs `C`)
- `submit_work`, `dispute`: no change

`transition(current, event, actor, amount)` throws `409` for an invalid state/event pair, `403` for an actor that isn't allowed, and `400` for a non-positive amount.

## Fund escrow

`POST /api/escrow/fund` (client only) moves funds from the client's wallet into escrow for a job. It runs the `fund` transition from the state machine and creates `escrows/{jobId}` with status `in_escrow`. The wallet update, the escrow doc and an `escrow_fund` ledger record (`transactions/fund-{jobId}`) are written in one Firestore transaction. The job must exist, belong to the caller and be assigned to `workerId`.

The amount is set by the server, not the client: it is the job's agreed price (the accepted quote, or the posted `budget` for jobs assigned before quotes existed), converted to whole KES at the current rate if the job is in another currency. `amount` is optional; if you send one that differs, the request fails with `409`.

Request body:

```json
{ "jobId": "job1", "workerId": "worker1" }
```

Returns `201` with `{ "escrow": { jobId, clientId, workerId, amount, currency, status, createdAt, fundedAt } }`.

| Status | Cause |
|---|---|
| `400` | Missing or invalid `jobId` or `workerId`, or an invalid `amount` |
| `401` | Missing or invalid token |
| `403` | Caller is not a client, or the job belongs to someone else |
| `404` | Job, worker or client wallet not found |
| `402` | Wallet `balance` is lower than the amount due |
| `409` | The job has no worker or a different one, the `amount` sent is not the amount due, or the escrow is already funded (or past `pending`) |

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

## Request refund

`POST /api/escrow/:jobId/refund-request` (client only) lets the client who funded a job ask for their money back. Only an admin can run the `refund` transition, so this just stores `refundRequests/{jobId}` with status `pending`; no money moves and the escrow status does not change. The escrow must be `in_escrow` or `work_submitted`, and each job can have one request.

Body: `{ "reason": "..." }` (1-1000 characters). Returns `201` with `{ "refundRequest": { jobId, clientId, workerId, amount, currency, reason, status, createdAt } }`.

| Status | Cause |
|---|---|
| `400` | `reason` is missing, empty or longer than 1000 characters, or a photo is invalid |
| `401` | Missing or invalid token |
| `403` | Wrong role, or the caller is not the client who funded the job |
| `404` | No escrow exists for the job |
| `409` | The escrow is not `in_escrow` or `work_submitted`, or a refund was already requested |

## Process refund

`POST /api/escrow/:jobId/process-refund` (admin only) approves a pending refund request. It runs the `refund` transition, returns the escrowed money to the client's balance, sets the escrow to `refunded` and stamps `refundedAt`, and marks `refundRequests/{jobId}` as `approved` with `processedBy` and `processedAt`. It writes one ledger entry (`refund-{jobId}`). A request can only be processed once.

No body. Returns `200` with `{ "refundRequest": { ...request fields, status: "approved", processedBy, processedAt } }`.

| Status | Cause |
|---|---|
| `401` | Missing or invalid token |
| `403` | The caller is not an admin |
| `404` | No escrow, refund request or client wallet exists for the job |
| `409` | The request was already processed, or the escrow is no longer `in_escrow` or `work_submitted` (for example it was disputed or released) |

## Raise dispute

`POST /api/escrow/:jobId/dispute` (client or worker) lets either party on a job dispute it. It runs the `dispute` transition, sets the escrow `status` to `disputed` and stamps `disputedAt`, and stores `disputes/{jobId}` with status `open`. No money moves; an admin resolves the dispute later. The escrow must be `in_escrow` or `work_submitted`, so each job can be disputed once. The caller must be the escrow's client or its assigned worker.

Body: `{ "reason": "...", "photos": ["data:image/jpeg;base64,..."] }`. `reason` is 1-1000 characters. `photos` is optional evidence: up to 3 PNG, JPEG or WebP data URLs, each under about 220 KB (they are stored inside the dispute document). Returns `201` with `{ "dispute": { jobId, clientId, workerId, amount, currency, raisedBy, raisedByRole, reason, photoCount, previousStatus, status, createdAt } }`; the photos themselves are only returned to admins (see Resolve dispute).

| Status | Cause |
|---|---|
| `400` | `reason` is missing, empty or longer than 1000 characters |
| `401` | Missing or invalid token |
| `403` | Wrong role, or the caller is not the escrow's client or assigned worker |
| `404` | No escrow exists for the job |
| `409` | The escrow is not `in_escrow` or `work_submitted` (including already disputed) |

## Resolve dispute

`POST /api/escrow/:jobId/resolve-dispute` (admin only) settles a disputed escrow. It runs the `resolve_release`, `resolve_refund` or `resolve_split` transition, moves the money in one transaction, and marks `disputes/{jobId}` as `resolved`. `release` pays the worker, sets the escrow to `completed` and stamps `completedAt`. `refund` returns the money to the client's balance, sets the escrow to `refunded` and stamps `refundedAt`. `split` returns `clientAmount` to the client and pays the worker the rest (rounded to cents), sets the escrow to `split` with `clientAmount` and `workerAmount`, and stamps `completedAt`. Release and refund write one ledger entry (`release-{jobId}` or `refund-{jobId}`); a split writes both, each for its own share. A dispute can only be resolved once.

Body: `{ "decision": "release" | "refund" | "split", "clientAmount": 200, "resolution": "..." }`. `resolution` is 1-1000 characters. `clientAmount` is required for a split and must be greater than 0 and less than the escrow amount. Returns `200` with `{ "dispute": { ...dispute fields, status: "resolved", decision, clientAmount, workerAmount, resolution, resolvedBy, resolvedAt } }` (the amounts only for a split).

| Status | Cause |
|---|---|
| `400` | `decision` is not `release`, `refund` or `split`, a split has a missing or out-of-range `clientAmount`, or `resolution` is missing, empty or longer than 1000 characters |
| `401` | Missing or invalid token |
| `403` | The caller is not an admin |
| `404` | No escrow, dispute or wallet exists for the job |
| `409` | The escrow is not `disputed` (including already resolved) |

## Manage users (admin)

All three endpoints are admin only. Users are read from the `clients`, `workers` and `admins` collections and never include `passwordHash`. A user with no `status` field counts as `active`.

- `GET /api/admin/users?role=&status=&limit=&startAfter=` lists users from every collection, newest first. `role` is `client`, `worker` or `admin`; `status` is `active` or `suspended`; `limit` is 1-100 (default 25). Returns `200` with `{ "users": [{ id, name, email, phone?, role, status, statusReason?, createdAt }], "nextCursor"? }`. Pass `nextCursor` back as `startAfter` for the next page; it is absent on the last page.
- `GET /api/admin/users/:role/:id` returns `200` with `{ "user": { ...same fields, wallet?: { id, balance, escrowBalance, currency } } }`. Admins have no wallet.
- `PATCH /api/admin/users/:role/:id/status` with `{ "status": "active" | "suspended", "reason": "..." }` (`reason` is required, 1-1000 characters, for both) suspends or reactivates a client or worker. It stamps `status`, `statusReason`, `statusUpdatedAt` and `statusUpdatedBy` and returns `200` with `{ "user": { ... } }`. Admin accounts cannot be suspended, which also stops an admin suspending themselves.

A suspended user gets `403` from `POST /api/auth/login`, after the password check. Tokens issued before the suspension stay valid until they expire (`JWT_EXPIRES_IN`, default 1 day).

| Status | Cause |
|---|---|
| `400` | Invalid query, `role` or body |
| `401` | Missing or invalid token |
| `403` | The caller is not an admin, or the target is an admin account |
| `404` | No user with that role and id |

## Monitor platform activity (admin)

`GET /api/admin/overview` (admin only) returns a snapshot of platform activity, aggregated from the `jobs`, `escrows`, `payments`, `withdrawals`, `disputes`, `refundRequests`, `clients` and `workers` collections. Returns `200` with:

```json
{
  "jobs": { "total": 3, "byStatus": { "open": 1, "assigned": 2 } },
  "escrows": {
    "total": 4,
    "byStatus": { "in_escrow": 1, "completed": 3 },
    "amounts": { "held": { "KES": 150 }, "released": { "KES": 200 }, "refunded": { "USD": 30 } }
  },
  "payments": { "total": 2, "byStatus": { "pending": 1, "completed": 1 } },
  "withdrawals": { "total": 1, "byStatus": { "failed": 1 } },
  "disputes": { "total": 2, "open": 1, "resolved": 1 },
  "refundRequests": { "total": 2, "pending": 1, "approved": 1 },
  "trust": {
    "scored": 2,
    "unavailable": 1,
    "byLevel": { "client": { "High": 2 }, "worker": {} },
    "lowTrustUsers": [{ "id": "w1", "role": "worker", "name": "James Mwangi" }]
  },
  "activity": { "paymentsToday": 124, "failedPaymentsToday": 2, "activeUsers": 284 }
}
```

`activity` counts payments created since midnight East Africa Time (UTC+3) and users whose status is not `suspended`. `trust.lowTrustUsers` is the watch list for the admin dashboard.

`amounts.held` covers escrows that are `in_escrow`, `work_submitted` or `disputed`, and each amount is summed per currency. `trust` scores every client and worker through the ML service (see Trust score), ten at a time; a user whose score can't be fetched counts as `unavailable` instead of failing the request, so this call is slow on a large user base.

| Status | Cause |
|---|---|
| `401` | Missing or invalid token |
| `403` | The caller is not an admin |

## Dashboard data endpoints

These feed the frontend dashboards.

`GET /api/wallet` (client or worker) returns the caller's wallet: `{ "wallet": { id, balance, escrowBalance, currency } }`. `404` if the user has no wallet.

`GET /api/jobs/mine` (client or worker) returns `{ "jobs": [...] }`, newest first: the jobs a client posted, or the jobs assigned to a worker. Each job carries `escrowStatus` once funded, `counterpartyName` (the hired worker for a client, the client for a worker) and, for a client's open jobs, `applicantCount`.

`GET /api/admin/disputes` (admin only) lists disputes newest first with `jobTitle`, `clientName`, `workerName` and `photoCount`. Query: `status` (`open` or `resolved`), `limit` (1 to 100, default 25), `cursor` (the previous `nextCursor`). Returns `{ "disputes": [...], "nextCursor" }`.

`GET /api/admin/disputes/:jobId` (admin only) returns one dispute the same way with its evidence `photos` included, or `404`.

`GET /api/admin/payments` (admin only) merges STK pushes (`kind: "payment"`) and withdrawals (`kind: "withdrawal"`) into one feed, newest first, with `userName` and any `failureReason`. Query: `status` (`pending`, `completed` or `failed`), `limit`, `cursor`. Returns `{ "payments": [...], "nextCursor" }`.

| Status | Cause |
|---|---|
| `400` | Invalid `status`, `limit` or `cursor` |
| `401` | Missing or invalid token |
| `403` | Wrong role |

Firestore composite indexes needed: `jobs` on `clientId` + `createdAt` desc and on `workerId` + `createdAt` desc; `disputes`, `refundRequests`, `payments` and `withdrawals` on `status` + `createdAt` desc. All indexes the app uses are declared in `backend/firestore.indexes.json`. Deploy them once per Firebase project with `firebase deploy --only firestore:indexes --project <project-id>` from `backend/`. Without them the filtered admin lists (disputes, refund requests, payments) return `500`.

## View transaction history

`GET /api/transactions` returns the caller's ledger entries (`transactions` collection), newest first. An entry is included when the caller is its `fromUserId` or `toUserId`. Any role can call it. An admin can pass `userId` to view another user's history.

Query parameters (all optional):

| Param | Meaning |
|---|---|
| `limit` | Page size, 1 to 100 (default 20) |
| `cursor` | The `nextCursor` from the previous page |
| `userId` | Admin only: whose history to return |

Returns `200` with `{ "transactions": [{ id, jobId, type, amount, currency, fromUserId, toUserId, createdAt }], "nextCursor": "<ISO date-time>" | null }`. `type` is `wallet_topup`, `escrow_fund`, `escrow_release` or `escrow_refund`. `nextCursor` is `null` on the last page. `worker.kyc` is the limited [KYC summary](#worker-kyc), or `null` if the worker is not verified.

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

## Pay with M-Pesa (STK Push)

A client pays with an M-Pesa STK Push prompt on their phone, either for a job or to top up the wallet. Every payment is in whole KES. Configure the `DARAJA_*` variables in `.env` (see `.env.example`).

1. **Start it:** `POST /api/payments/stk-push` (pay for a job) or `POST /api/payments/top-up` (add to the wallet). Both prompt the phone and store a `payments/{CheckoutRequestID}` doc with status `pending`. Nothing else changes yet.
2. **Settle it:** when the customer answers, Daraja calls `POST /api/payments/stk/callback/:secret`. A successful payment credits the client's wallet; a job payment is then moved straight into that job's escrow, exactly as `POST /api/escrow/fund` does (the escrow is `in_escrow`, with `topup-{id}` and `fund-{jobId}` ledger entries). A cancelled or failed payment is marked `failed` with Daraja's reason and moves no money.
3. **Watch it:** the app polls `GET /api/payments/:checkoutRequestId` until the status leaves `pending`.

Settlement runs in one transaction and is safe to repeat: only a `pending` payment is settled, so a repeated callback changes nothing. The money is kept in the wallet instead of the escrow when the job isn't the client's, has a different worker, or is already funded. A success for a different amount than was requested is not trusted: it credits nothing and the payment is marked `failed`, which shows on the admin payments list.

**Callback URL.** Daraja doesn't sign callbacks, so the secret is part of the path and a wrong one looks like a missing route (`404`). Set `DARAJA_STK_CALLBACK_SECRET` to a long random string, and `DARAJA_CALLBACK_URL` to `https://<public host>/api/payments/stk/callback/<that secret>`. Daraja can only reach a public HTTPS address, so locally use a tunnel such as ngrok.

**Test mode.** With `DARAJA_SIMULATE=true` (ignored when `NODE_ENV=production`) no request goes to Daraja and no Daraja settings are needed. The payment is stored with `simulated: true` and an id starting `sim-`, and `POST /api/payments/:checkoutRequestId/simulate` with `{ "outcome": "success" | "failure" }` settles it the way a callback would. That endpoint is a `404` outside test mode and a `409` for a real payment.

### Start a job payment

`POST /api/payments/stk-push` (client only):

```json
{ "jobId": "job1", "workerId": "worker1", "phone": "0708374149" }
```

`phone` is optional and falls back to the phone saved at registration. The amount is worked out by the server from the job (see Fund escrow); an optional whole-number `amount` that differs gets `409`, and a job that is not the caller's, not found, or not assigned to `workerId` gets `403`, `404` or `409`. The price the client was asked to pay (`agreedPrice`, `agreedCurrency`) is stored on the payment, and settling only funds the escrow if the job still has that price; otherwise the money stays in the wallet. Returns `202` with `{ "payment": { checkoutRequestId, merchantRequestId, kind: "escrow", jobId, workerId, clientId, amount, currency, phone, status, createdAt }, "message": "<Daraja customer message>", "simulated": false }`.

### Top up the wallet

`POST /api/payments/top-up` (client only): `{ "amount": 1000, "phone": "0708374149" }`. `amount` is a whole number of KES from 1 to 250,000; `phone` is optional. Returns `202` in the same shape, with `kind: "top_up"`.

### Check a payment

`GET /api/payments/:checkoutRequestId` (client only) returns `{ "payment": { ...payment, status: "pending" | "completed" | "failed", receipt, failureReason, settlement, settledAt } }`. `settlement` is `escrow_funded` or `wallet_credited`.

| Status | Cause |
|---|---|
| `400` | Missing or invalid `jobId`, `workerId`, `amount` or `phone`, or no phone on file |
| `401` | Missing or invalid token |
| `403` | Caller is not a client, or the payment is someone else's |
| `404` | Worker or payment not found |
| `409` | The job's escrow is already funded |
| `502` / `503` | Daraja rejected the request / could not be reached, or M-Pesa isn't configured on the server (`"M-Pesa is not set up on this server yet"`; the missing setting is in the server log) |

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
{
  "title": "Fix my sink", "description": "Leaking kitchen tap", "budget": 1500, "currency": "KES",
  "location": { "label": "Kilimani, Nairobi", "lat": -1.2921, "lng": 36.7872 },
  "photos": ["data:image/jpeg;base64,..."]
}
```

`currency` is one of `KES`, `UGX`, `TZS`, `USD` (case-insensitive). `location` is optional: `label` is required, and `lat` and `lng` come together (they let workers see a distance). `photos` is optional: up to 3 PNG, JPEG or WebP data URLs, each under about 220 KB. Photos are stored inside the job document (no file storage is configured), so the server accepts request bodies up to 2 MB.

Returns `201` with `{ "job": { "id", "clientId", "title", "description", "budget", "currency", "status", "location", "photoCount", "createdAt" } }`. Lists and responses carry `photoCount`, never the photos.

`GET /api/jobs/:jobId` (any signed-in role) returns `{ "job": { ...job, "photos": [...] } }` with the photos included, or `404`.

| Status | Cause |
| --- | --- |
| `400` | Missing or invalid field |
| `401` | Missing or invalid token |
| `403` | Caller is not a client |

## Browse jobs

`GET /api/jobs` (worker only) lists open jobs, newest first. Query parameters (all optional): `limit` (1 to 100, default 20), `cursor` (the previous page's `nextCursor`), `currency`, and `lat` plus `lng` (the worker's position, sent together). When a position is sent, each job that has coordinates includes `distanceKm`, the straight-line distance rounded to 0.1 km. Returns `{ "jobs": [...], "nextCursor" }`. Jobs carry `photoCount`, not photos; fetch one job with `GET /api/jobs/:jobId` to see them.

## Apply for a job

`POST /api/jobs/:jobId/apply` (worker only) records the calling worker's application in `applications/{jobId}_{workerId}` with status `pending`. `workerId` comes from the token, and the deterministic id means a worker can apply to a job only once.

Request body:

```json
{ "price": 1200, "message": "I can start tomorrow" }
```

`price` is the worker's quote: a number greater than 0, in the job's currency (the server copies the currency from the job). The job's `budget` is only a guide. `message` is optional, at most 1000 characters. Returns `201` with `{ "application": { "id", "jobId", "workerId", "price", "currency", "message", "status", "createdAt" } }` (`message` is omitted when not given).

| Status | Cause |
| --- | --- |
| `400` | Missing or invalid `price`, or invalid `message` |
| `401` | Missing or invalid token |
| `403` | Caller is not a worker, or the worker is not verified (see [Worker KYC](#worker-kyc)) |
| `404` | Job or worker not found |
| `409` | Job is not open, or the worker already applied |

### Edit a quote

`PATCH /api/jobs/:jobId/application` (worker only) changes the caller's own quote while the application is `pending` and the job is `open`. Body: `{ "price": 1000, "message": "..." }` with at least one of the two. Returns `200` with `{ "application" }`. `400` for an invalid or empty body, `404` if the worker has not applied, `409` once the application is no longer pending or the job is no longer open.

`GET /api/jobs` includes `myApplication` (`price`, `currency`, `message`, `status`) on each job the calling worker has applied to.

## Worker KYC

A worker must be verified before they can apply for jobs. Verification is **simulated**: the checks run automatically on submit and there is no admin review queue. A real ID-verification provider would replace only `runChecks` in `services/kycService.ts`.

`POST /api/kyc` and `GET /api/kyc/me` are worker only.

Request body for `POST /api/kyc`:

```json
{
  "fullName": "Amina Njeri", "idType": "national_id", "idNumber": "12345678",
  "dateOfBirth": "1995-04-12", "consent": true,
  "images": { "front": "data:image/jpeg;base64,...", "back": "data:image/jpeg;base64,...", "selfie": "data:image/jpeg;base64,..." }
}
```

`idType` is `national_id` (images: front, back, selfie) or `passport` (front, selfie). Images are data URLs, validated like job photos. The checks are: ID number format (national ID 7-8 digits, passport 6-9 letters or digits), age 18 or over, name matches the account, required images present, ID not registered to another account, and consent given. If all pass the worker is `verified`; otherwise `rejected` with plain-language `reasons`, and they can resubmit. Returns `201` with `{ "kyc": { "status", "fullName", "idType", "idNumber" (masked), "reasons", "submittedAt", "verifiedAt" } }`. `409` if already verified. `GET /api/kyc/me` returns the same shape, or `{ "kyc": null }` before the first submission.

Who sees what:

| Who | Sees |
| --- | --- |
| Worker | Own status and reasons, ID number masked |
| Client (applications list) | `kyc` summary only: `verified`, `name`, `idType`, `idNumberMasked` (last 3 digits), `verifiedAt` |
| Admin | Only for workers who are party to at least one dispute (`GET /api/admin/kyc` lists them). `GET /api/admin/kyc/:workerId` returns the full record and images, or `403` if the worker has no dispute. Each successful view is written to `kycAccessLog`. The dispute detail embeds the limited summary as `workerKyc`. |

Storage: `kyc/{workerId}` holds the details and check results; images live in `kycFiles/{workerId}` so they never travel with lists; `kycIdIndex/{sha256(idType:idNumber)}` maps a verified ID to its worker so one ID can't be used by two accounts.

**Privacy note.** ID numbers, dates of birth and photos are sensitive personal data (Kenya Data Protection Act 2019). They are kept out of every list, masked for clients, shown in full only through a dispute with an audit log, and consent is recorded with the submission. For production, move images to a private storage bucket with signed URLs and add a retention policy.

## Tax records and compliance

The platform can't stop someone under-declaring income; it can verify who is paid, keep the records and point out patterns. All amounts are KES, and "year" follows Kenyan time (UTC+3).

**Tax PIN.** A worker can add a KRA PIN (a letter, nine digits, a letter, e.g. `A123456789Z`) as an optional `taxPin` on `POST /api/kyc`, or later with `POST /api/kyc/tax-pin` `{ "taxPin": "A123456789Z" }` (verified workers only: `409` otherwise, `400` for a malformed PIN). It is stored on the KYC record and only ever returned masked (`A*********Z`).

**Payout limit.** A worker with no tax PIN can withdraw up to `TAX_PIN_THRESHOLD_KES` (default 100,000) in a calendar year, counting withdrawals that did not fail. Going past it returns `403` from `POST /api/payments/withdraw` and nothing is debited; adding a tax PIN lifts the limit.

**Statement.** `GET /api/wallet/statement?year=2026` (client or worker, `year` defaults to the current one) returns `{ "statement": { year, role, currency, months: [12 x { month, jobs, received, withdrawn }], totals, tax } }`. Clients get `paid` and `refunded` instead of `received` and `withdrawn`. It is built from the ledger; `tax` (workers only) has the masked PIN and the yearly limit.

**Flags (admin).** `GET /api/admin/compliance` returns `{ "flags": [{ type, severity, subject, counterparty?, jobCount, amount, detail }], "thresholdKes" }`, high severity first. The rules are in `services/complianceService.ts`, with limits in `config/compliance.ts`:

| `type` | Raised when |
|---|---|
| `possible_splitting` | 5 or more paid jobs under KES 10,000 each between the same client and worker, adding up to KES 50,000 or more, within 14 days |
| `refund_after_delivery` | 2 or more refunded jobs between the same two people where the work had been marked done |
| `no_tax_pin` | A worker was paid KES 100,000 or more this year with no tax PIN on file |

Flags are prompts to look at the history, not findings. Which obligations apply (reporting, withholding) depends on the law and should be checked with a tax adviser before launch.

## Review applications

`GET /api/jobs/:jobId/applications` (client only) lists the applications for one of the caller's own jobs, newest first. Each application includes the applicant's `id`, `name` and `email` from `workers/{workerId}`, and their `trustLevel` (`High`, `Medium` or `Low`) from the trust-scoring service. Scores are cached for 5 minutes and fetched ten at a time; if the service can't score a worker, `trustLevel` is left out instead of failing the request.

Query parameters: `limit` (1 to 100, default 20) and `cursor` (the previous page's `nextCursor`, an ISO date-time). Needs a Firestore composite index on `applications` (`jobId` ascending, `createdAt` descending).

Returns `200` with:

```json
{
  "applications": [
    {
      "id": "job1_worker1", "jobId": "job1", "workerId": "worker1", "message": "I can start tomorrow",
      "status": "pending", "createdAt": "2026-10-12T08:01:00.000Z",
      "worker": {
        "id": "worker1", "name": "Amina", "email": "amina@example.com", "trustLevel": "High",
        "kyc": { "verified": true, "name": "Amina Njeri", "idType": "national_id", "idNumberMasked": "*****678", "verifiedAt": "2026-10-10T09:00:00.000Z" }
      }
    }
  ],
  "nextCursor": null
}
```

`nextCursor` is `null` on the last page.

| Status | Cause |
| --- | --- |
| `400` | Invalid `limit` or `cursor` |
| `401` | Missing or invalid token |
| `403` | Caller is not a client, or does not own the job |
| `404` | Job not found |

## Select worker

`POST /api/jobs/:jobId/select` (client only) picks one applicant for the caller's own job. Body: `{ "workerId": "worker1" }`.

In one transaction the job moves to `assigned` with `workerId` set, the chosen application becomes `selected`, and every other application for the job becomes `rejected`. The chosen quote is copied onto the job as `agreedPrice` and `agreedCurrency`, which locks the price: from then on it is what the client pays. Applications made before quotes existed leave the job on its `budget`. The job then no longer appears in browse jobs.

Returns `200` with `{ "job": { ... }, "application": { ... } }`.

| Status | Cause |
| --- | --- |
| `400` | Missing or invalid `workerId` |
| `401` | Missing or invalid token |
| `403` | Caller is not a client, or does not own the job |
| `404` | Job not found, or that worker has not applied |
| `409` | Job already has a worker |

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

### End-to-end test

```
npm test -- e2e
```

`tests/e2e/fullFlow.test.ts` runs the real routes and services together against one shared in-memory Firestore (`tests/helpers/memoryDb.ts`). It covers registration, the terms and KYC gates, top-up, job posting through payout, an M-Pesa-funded escrow, disputes, refunds, withdrawal and trust scores. Only the M-Pesa payout call and the trust-scoring service (`fetch`) are stubbed, and `DARAJA_SIMULATE` is on.

## Structure

- `src/app.ts`: builds the Express app (used by both the server and the tests)
- `src/server.ts`: loads `.env` and starts listening
- `src/config/`: external service setup (Firestore)
- `src/routes/`: route handlers, one file per resource
- `src/middleware/`: shared middleware (auth and role checks, 404 and error handling)
- `tests/`: Jest + Supertest tests
