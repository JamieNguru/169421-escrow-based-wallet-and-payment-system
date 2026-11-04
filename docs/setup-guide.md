# Setup guide

How to go from a fresh clone to the whole system running locally: trust-scoring service, backend and frontend.

## Prerequisites

| Tool | Version | Used for |
|---|---|---|
| Node.js | 22 or newer | Backend and frontend |
| Python | 3.12 | Trust-scoring service |
| Firebase project | Any (free Spark plan) | Firestore. Or use the local Firestore emulator instead |

## 1. Clone

```
git clone https://github.com/JamieNguru/169421-escrow-based-wallet-and-payment-system.git
cd 169421-escrow-based-wallet-and-payment-system
```

## 2. Trust-scoring service (port 5000)

```
cd trust-scoring-ml
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python -m src.realistic         # trains and saves the v2 worker and client models
python app.py
```

Trained models (`models/*.joblib`) and datasets (`data/`) are git-ignored, so the models must be trained locally. Training needs the datasets listed in the [ML README](../trust-scoring-ml/README.md#data). Check it with `GET http://127.0.0.1:5000/health`.

If this service is down, the backend still runs; trust-score requests return `503` and everything else works.

## 3. Backend (port 4000)

```
cd backend
npm install
cp .env.example .env
```

Then fill in `.env`:

| Group | Variables | Notes |
|---|---|---|
| Server and auth | `PORT`, `JWT_SECRET`, `JWT_EXPIRES_IN` | `JWT_SECRET` must be a long random string |
| Firestore | `FIREBASE_SERVICE_ACCOUNT_PATH`, `FIREBASE_PROJECT_ID` | Key from Firebase console > Project settings > Service accounts. Never commit it. For offline work set `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` instead |
| Services | `ML_SERVICE_URL`, `EXCHANGE_RATE_API_URL` | Both optional; defaults are `http://127.0.0.1:5000` and open.er-api.com |
| M-Pesa STK Push | `DARAJA_CONSUMER_KEY`, `DARAJA_CONSUMER_SECRET`, `DARAJA_SHORTCODE`, `DARAJA_PASSKEY`, `DARAJA_CALLBACK_URL`, `DARAJA_STK_CALLBACK_SECRET`, `DARAJA_BASE_URL` | Sandbox credentials from developer.safaricom.co.ke |
| M-Pesa B2C (withdrawals) | `DARAJA_B2C_SHORTCODE`, `DARAJA_INITIATOR_NAME`, `DARAJA_SECURITY_CREDENTIAL`, `DARAJA_B2C_CALLBACK_SECRET`, `DARAJA_B2C_RESULT_URL`, `DARAJA_B2C_TIMEOUT_URL` | From the Daraja Test Credentials page (Sandbox) |
| Paystack (payments in) | `PAYMENT_PROVIDER=paystack`, `PAYSTACK_SECRET_KEY` | Client M-Pesa payments go through Paystack instead of Daraja. Use a `sk_test_` key from the Paystack dashboard (Test Mode). In test mode, pay with Paystack's test number `0710000000`; other numbers are declined. Optional webhook: `<public url>/api/payments/paystack/webhook`. Withdrawals do not use Paystack (starter accounts cannot pay out), so they stay on Daraja or `DARAJA_SIMULATE` |
| Local shortcut | `DARAJA_SIMULATE=true` | No real M-Pesa calls; the UI shows simulate buttons. Ignored when `NODE_ENV=production` |
| Seeding | `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `DEMO_PASSWORD` | Used only by the seed scripts |
| Compliance | `TAX_PIN_THRESHOLD_KES` | Optional, defaults to 100000 |

**Fastest local setup:** Firestore (key or emulator) + `JWT_SECRET` + `DARAJA_SIMULATE=true`. No Daraja account or tunnel is needed.

**Real Daraja sandbox:** Safaricom posts results to a public HTTPS URL, so run a tunnel (for example ngrok on port 4000) and set the callback URLs to `https://<tunnel>/api/payments/stk/callback/<DARAJA_STK_CALLBACK_SECRET>` and the two `b2c/result` and `b2c/timeout` URLs with `<DARAJA_B2C_CALLBACK_SECRET>`. Daraja does not sign callbacks, so the secret in the path is the check.

Seed and start:

```
npm run seed:admin     # creates the first admin from ADMIN_*
npm run seed:demo      # optional: demo accounts with a trust history
npm run dev
```

Check it with `GET http://localhost:4000/api/health`.

### Try the API

Every public endpoint is described in [`openapi.yaml`](openapi.yaml). To call them from Postman:

1. Import `docs/postman/escrow-wallet-api.postman_collection.json` and `docs/postman/escrow-wallet-api.postman_environment.json`, then select the **Escrow Wallet - Local** environment.
2. Send **Sign in and get a JWT** (Auth folder) with a registered or seeded account.
3. Copy the `token` from the response into the environment's `token` variable. Every other request sends it as a Bearer token.
4. Set `jobId`, `workerId`, `checkoutRequestId` and the other id variables to real ids as you go.

After editing `openapi.yaml`, rebuild the collection from the repository root with `node docs/postman/generate.mjs`.

## 4. Frontend (port 5173)

```
cd frontend
npm install
npm run dev
```

Vite proxies `/api` to `http://localhost:4000`, so no `.env` is needed locally. For a deployed build, set `VITE_API_URL` (see `frontend/.env.example`).

## 5. Check it works

1. Open http://localhost:5173 and register a client and a worker (in separate browser profiles), accepting the terms.
2. Log in as the seeded admin.
3. Walk through the flows in [`manual-test-pass.md`](manual-test-pass.md).

## Tests and linting

| Where | Command |
|---|---|
| Backend | `npm test`, `npm run typecheck`, `npm run lint` (in `backend/`) |
| Backend end-to-end only | `npm test -- e2e` |
| Frontend | `npm run lint`, `npm run build` (in `frontend/`) |
| Trust service | `pytest`, `ruff check .` (in `trust-scoring-ml/`, venv active) |

The backend tests use an in-memory Firestore, so they need no Firebase project or network.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Backend exits with a Node engine error | Upgrade to Node 22 or newer |
| A Firestore credentials or connection error on start | Check `FIREBASE_SERVICE_ACCOUNT_PATH`, or set `FIRESTORE_EMULATOR_HOST` and start the emulator |
| Trust score returns `503` | Start the Flask service, or fix `ML_SERVICE_URL`. The call times out after 5 seconds |
| Flask fails with a missing model file | Run `python -m src.realistic` in `trust-scoring-ml/` |
| STK Push never completes | The callback URL must be public HTTPS and end with the secret. Use a tunnel, or `DARAJA_SIMULATE=true` |
| Frontend calls fail with a network error | Make sure the backend is running on port 4000 |
