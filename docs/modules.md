# Modules

The seven modules from the proposal, mapped to where they live in the code. Backend paths are under `backend/src/`, frontend paths under `frontend/src/pages/`. Endpoint details are in the [OpenAPI spec](openapi.yaml) and the [backend README](../backend/README.md).

## 1. System Documentation

This folder: [setup guide](setup-guide.md), [architecture](architecture.md), this module map, the [manual test pass](manual-test-pass.md), and the README in each of `backend/`, `frontend/` and `trust-scoring-ml/`.

## 2. Authentication & User Management

Registration and login (email or phone), JWT sessions, Client/Worker/Admin role checks, terms acceptance, worker identity verification (KYC) and tax-PIN compliance.

| Part | Where |
|---|---|
| Routes | `routes/auth.ts` (`/api/auth`), `routes/kyc.ts` (`/api/kyc`), admin user and KYC views in `routes/admin.ts` |
| Services and middleware | `services/userService.ts`, `kycService.ts`, `complianceService.ts`, `middleware/auth.ts`, `middleware/requireTerms.ts`, `config/jwt.ts`, `config/terms.ts` |
| Collections | `clients`, `workers`, `admins`, `emails`, `phones`, `kyc`, `kycFiles`, `kycIdIndex`, `kycAccessLog` |
| Screens | `auth/Login`, `auth/Register`, `Terms`, `worker/Verification`, `worker/KycCard`, `admin/Users`, `admin/KycList`, `admin/KycDetail`, `admin/Compliance` |
| Tests | `register`, `login`, `jwt`, `rbac`, `acceptTerms`, `requireTerms`, `phone`, `kyc`, `compliance` |

## 3. Escrow Payment

The wallet-and-escrow lifecycle: fund, submit work, release, with every wallet movement recorded.

| Part | Where |
|---|---|
| Routes | `routes/escrow.ts` (`/api/escrow`), `routes/wallet.ts` (`/api/wallet`), `routes/transactions.ts` (`/api/transactions`) |
| Services | `services/escrowService.ts`, `escrowStateMachine.ts`, `walletService.ts`, `transactionService.ts`, `exchangeRateService.ts` (currency display) |
| Collections | `escrows`, `wallets`, `transactions` |
| Screens | `client/PayEscrow`, `client/ReleasePayment`, `client/Wallet`, `worker/Dashboard`, `shared/History`, `shared/Statement` |
| Tests | `escrowFund`, `escrowComplete`, `escrowStatus`, `escrowStateMachine`, `wallet`, `transactions`, `convertCurrency`, `e2e/fullFlow` |

## 4. Trust Scoring

Two Random Forest models (worker and client) behind a Flask service. The backend works out each user's inputs and maps the result to Low, Medium, High or New.

| Part | Where |
|---|---|
| Service | `trust-scoring-ml/` (`app.py`, `src/predict.py`, `src/realistic.py`, notebooks, `reports/`) |
| Backend | `routes/trustScore.ts` (`/api/trust-score`), `services/trustScoreService.ts`, `config/mlService.ts` |
| Screens | `shared/Trust` |
| Tests | `trustScore` (backend); `trust-scoring-ml/tests/` (pytest) |

## 5. Payment Integration

M-Pesa Daraja in the sandbox: STK Push to fund a wallet or escrow, B2C to pay workers out.

| Part | Where |
|---|---|
| Routes | `routes/payments.ts` (`/api/payments`) including the secret-protected STK and B2C callbacks |
| Services | `services/darajaService.ts`, `paymentService.ts`, `withdrawalService.ts` |
| Config | `config/daraja.ts` |
| Collections | `payments`, `withdrawals` |
| Screens | `components/MpesaWait`, `client/PayEscrow`, `client/Wallet` (top-up), `worker/Withdraw`, `admin/Payments` |
| Tests | `stkPush`, `settlePayment`, `withdraw` |

## 6. Job Management

Clients post jobs, workers browse and apply, the client picks a worker.

| Part | Where |
|---|---|
| Routes | `routes/jobs.ts` (`/api/jobs`) |
| Services | `services/jobService.ts`, `applicationService.ts`, `jobPricing.ts` |
| Collections | `jobs`, `applications` |
| Screens | `client/PostJob`, `client/ChooseWorker`, `client/Dashboard`, `worker/FindJobs`, `worker/JobTile` |
| Tests | `postJob`, `browseJobs`, `applyJob`, `reviewApplications`, `selectWorker`, `myJobs`, `jobLocation` |

## 7. Dispute & Refund Management + Administration

Raising and resolving disputes, refund requests, and the admin overview and oversight screens.

| Part | Where |
|---|---|
| Routes | `routes/escrow.ts` (dispute, refund-request, process-refund, resolve-dispute), `routes/admin.ts` (`/api/admin`) |
| Services | `services/escrowService.ts`, `adminListService.ts`, `overviewService.ts` |
| Collections | `disputes`, `refundRequests` |
| Screens | `client/ReportProblem`, `admin/Disputes`, `admin/ResolveDispute`, `admin/RefundRequests`, `admin/Overview`, `admin/Payments`, `admin/Users` |
| Tests | `raiseDispute`, `resolveDispute`, `requestRefund`, `processRefund`, `adminDisputes`, `adminOverview`, `adminPayments`, `adminUsers` |

## Beyond the original seven

KYC, compliance, terms and currency conversion were added during development. They are listed above under the module they support (2 and 3) rather than as separate modules.
