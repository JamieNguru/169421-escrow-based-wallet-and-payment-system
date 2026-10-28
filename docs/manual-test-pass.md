# Manual test pass (issue #46)

A hand-run checklist for every Client, Worker and Admin flow. The automated suite (`backend/tests/e2e/fullFlow.test.ts`) already covers the money logic over an in-memory database, so this pass focuses on what it cannot see: the real browser UI, route guards, photo and location handling, the M-Pesa wait screen, the real Flask trust service, real Firestore, mobile layout, and error and empty states.

Mark each step `Pass`, `Fail` or `Skip` in the Result column and put a short note or the bug issue number in Notes.

## 1. Setup

| Item | How |
|---|---|
| Backend | `cd backend`, `npm install`, copy `.env.example` to `.env`, then `npm run dev` (port 4000). Check `GET /api/health`. |
| Firestore | Service account via `FIREBASE_SERVICE_ACCOUNT_PATH`, or the emulator via `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`. |
| Payments | `DARAJA_SIMULATE=true` (ignored when `NODE_ENV=production`). |
| Admin account | Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, then `npm run seed:admin`. |
| Trust service | `cd trust-scoring-ml`, activate `.venv`, `python app.py` (port 5000, or set `ML_SERVICE_URL`). |
| Frontend | `cd frontend`, `npm install`, `npm run dev`. Vite proxies `/api` to port 4000. |
| Browsers | Three separate profiles (or one normal and two private windows): client, worker, admin. |

Test data: client `client1`, worker `worker1`, admin from the seed. Use a fresh email and phone per run.

## 2. Public and auth

| # | Step | Expected | Result | Notes |
|---|---|---|---|---|
| A1 | Open `/`, `/login`, `/register`, `/terms` while logged out | Each page loads, no console errors | | |
| A2 | Register a client without ticking the terms box | Blocked with a clear message | Fail, then fixed | Button was disabled with no message. Now shows "Please agree to the terms of service to create your account" (checked after the fix). |
| A3 | Register a client with terms accepted | Account created, lands on the client dashboard | Pass | Dashboard shows KES 0 and Trust: New. Takes several seconds with only a "Creating account..." label. |
| A4 | Register a worker with terms accepted | Account created, lands on the worker dashboard | Pass | Redirected to `/worker`. |
| A5 | Log out, log in by email, then by phone | Both work; wrong password shows an error | Pass (partly) | Email login (client, worker) and phone login (worker, client) work. Logout works. Wrong-password error not checked. A logged-in user opening `/login` is sent to their dashboard. |
| A6 | As the client open `/worker/jobs` and `/admin` | Redirected away (RequireRole) | Pass | Both redirect to `/client`. |
| A7 | As the worker open `/client/post-job` and `/admin` | Redirected away | | |
| A8 | Toggle light and dark theme, reload | Theme applies and persists | | |

## 3. Worker onboarding

| # | Step | Expected | Result | Notes |
|---|---|---|---|---|
| W1 | Before verification, open Find Jobs and try to apply | Apply is locked with a prompt to verify | Pass | Card shows "Verify your identity to apply". |
| W2 | `/worker/verification`: submit the simulated KYC | Status moves to pending or verified as designed | Pass | Two steps (details, then three photos and consent). Verified immediately on submit. |
| W3 | As admin open `/admin/kyc`, then the worker's detail page | Submission visible; approve it | Pass | List shows the worker as Verified; detail shows the ID details and all three photos, with a "this view has been logged" notice. Nothing to approve: the simulated check verifies automatically. |
| W4 | Back as the worker, refresh | Verified badge shown, apply unlocked | Pass | "Verified on 27 Oct" and "Send your quote" appear. |

## 4. Job to payout (happy path)

| # | Step | Expected | Result | Notes |
|---|---|---|---|---|
| J1 | Client posts a job with photos and a location | Job appears on the client dashboard as open | Pass (no photos) | Posted without photos; location typed, "Use my current position" not tried. |
| J2 | Worker sees the job in Find Jobs and applies with a quote | Application saved, quote shown | Pass | Quote of KES 1,200 shown as sent. |
| J3 | Worker edits the quote | New quote saved | Pass | Changed to KES 1,100. |
| J4 | Client opens Applicants, picks the worker | Job moves to assigned, quote becomes the agreed price | Pass | Applicant card shows quote, "KES 100 above budget", Verified and Trust: New. A confirm step states the price. Lands on the pay screen. |
| J5 | Client opens the pay screen with KES 0 in the wallet | Only the M-Pesa option is offered | Pass | Wallet option disabled with an explanation. The price showed "…" for about 10 seconds while the exchange-rate feed timed out (X6, fixed). |
| J6 | Pay by M-Pesa prompt, click the simulate-success button | MpesaWait screen resolves, escrow funded, wallet and ledger change correctly | Pass | Dashboard shows KES 1,100 held and the job In progress. |
| J7 | Top up the wallet from the Wallet page (simulate) | Balance rises by the amount | Pass | KES 1,000 quick-pick, simulate success, balance KES 1,000 and "added" message. |
| J8 | Second job: pay from wallet | "Pay from wallet" offered when balance covers it; escrow funded | Pass | Wallet option is the default, balance went 1,000 to 300, KES 700 held. |
| J9 | Worker marks the work done | Job shows awaiting release | Pass | Worker sees "Waiting for the client to check your work". Client gets "Check & pay worker". |
| J10 | Client releases payment | Worker wallet credited, client history and worker history match | Pass, display issue fixed | Worker wallet shows KES 1,100. Both histories listed the held and released rows with a sign each, reading as KES 2,200 moved. Now only amounts that change the viewer's wallet carry a sign (client: -held; worker: +released). |
| J11 | Worker withdraws to M-Pesa | Balance reduced, withdrawal listed (B2C is stubbed or sandbox) | Pass (simulate), label fixed | Withdrew KES 100: balance 1,100 to 1,000. The worker list said "Sent" while admin said Pending, because the list only knows the request was made. Now labelled "Requested". No real B2C was called. |
| J12 | Compare wallets, history and `/admin/payments` | Totals reconcile, no money created or lost | Pass | Client wallet read KES 400 after the 700 dispute refund and two 300 jobs funded (1,000 - 700 + 700 - 600 = 400), which matches. Admin payments showed released 1,100 and refunded 700 as expected. Top-ups were labelled "Escrow payment"; now "Wallet top-up". |

## 5. Payment edge cases

| # | Step | Expected | Result | Notes |
|---|---|---|---|---|
| P1 | Simulate a failed or cancelled payment | MpesaWait shows the failure reason; wallet unchanged | Pass | "Simulated: the request was cancelled", Pay button usable again, retry worked. |
| P2 | Pay a client who has not accepted terms | Blocked until terms accepted | | |
| P3 | Click simulate twice quickly | Wallet credited only once | Pass | Two quick clicks funded KES 1,100 once, not twice. |
| P4 | Start payment with Daraja vars unset and simulate off | Clear "not configured" message, not "Internal server error" | | |
| P5 | Reload the page mid-wait | Payment state recovered or a sensible message shown | | |

## 6. Disputes and refunds

| # | Step | Expected | Result | Notes |
|---|---|---|---|---|
| D1 | Client raises a dispute on a funded job | Job marked disputed, appears in `/admin/disputes` | Pass (re-run 2026-10-28) | Client side works ("Under review"). After the disputes index was created, `/admin/disputes` lists the open dispute with both parties, the reason and a Review link (it failed with a 500 before that, X7). |
| D2 | Admin opens the dispute and resolves in the worker's favour | Funds go to the worker | Pass | Detail page (opened by URL) resolved "Pay the worker"; dispute shows resolved/release. Also resolved one as "Refund the client" (KES 700 back to the client wallet). |
| D3 | Repeat with the worker raising it; admin resolves for the client | Funds return to the client wallet | Pass, gap fixed | The worker had no way to raise a dispute in the UI (API only). Added a worker report screen at `/worker/report/:jobId`, linked from the dashboard; a dispute raised there reached the admin queue. |
| D4 | Client requests a refund | Appears in `/admin/refunds` | Pass (re-run 2026-10-28) | Request sent from the UI. `/admin/refunds` now opens (it failed before the index, X7). The client dashboard keeps showing the job as plain "In progress" with no sign a refund is pending (not fixed). |
| D5 | Admin processes the refund | Client wallet credited, status updated on both sides | Partly | Processed earlier through the API. After the index, the Approved tab on `/admin/refunds` shows the request as Refunded. Approving from the UI was not re-run because no pending request was left. |

## 7. Admin

| # | Step | Expected | Result | Notes |
|---|---|---|---|---|
| M1 | `/admin` overview | Counts and totals plausible against the data created | Pass, one number to check (re-run 2026-10-28) | Cards load (escrow KES 200, 1 open dispute, 7 active users, which includes accounts that were already there) and the "Disputes needing action" panel now lists the dispute. The overview says "1 job" held while the Payments page says "0 funded jobs" for the same KES 200 (not investigated). |
| M2 | `/admin/users`: suspend the worker | Status changes | Pass | Suspend asks for a reason with a browser `prompt()` (stubbed in the test browser). Status became Suspended. |
| M3 | As the suspended worker try to log in and use the app | Blocked with a clear message | Pass (API) | Login returns 403 "This account has been suspended". Login page rendering of that message not viewed. |
| M4 | Reactivate the worker | Access restored | Pass | Restore returned the worker to Active. |
| M5 | `/admin/payments` | Lists the payments from section 4 and 5 | Pass (re-run 2026-10-28) | Unfiltered list correct (top-up, escrow payments, failed one with its reason, withdrawal). Pending shows the withdrawal, Completed the top-up and escrow payment, Failed the cancelled payment with its reason (all three returned 500 before the indexes, X7). |

## 8. Trust levels

| # | Step | Expected | Result | Notes |
|---|---|---|---|---|
| T1 | New user on `/client/trust` or `/worker/trust` | Shows New | Pass | Dashboards show "Trust: New". |
| T2 | Settle three jobs for one user | Level comes from the scoring service | Skip | Only one job was settled normally. Covered by the automated e2e test. |
| T3 | Admin sees the same level on the user's row | Values match | Pass | Check button on the worker's row showed New. |
| T4 | Stop the Flask service and reload a trust page | Graceful fallback, no crash | Skip | Could not reliably stop the service from this session. |

## 9. Cross-cutting

| # | Step | Expected | Result | Notes |
|---|---|---|---|---|
| X1 | Repeat J1 to J10 at a 375px wide viewport | No overlap, horizontal scroll or unreachable buttons | Partly | Worker screens (dashboard, jobs, verification, wallet, history, trust, report) have no horizontal overflow at 375px and the bottom nav works. Client and admin screens not checked. |
| X2 | Visit each list screen with no data | Sensible empty state | Partly | Worker Find Jobs shows "No jobs match" and the dashboard "No open jobs right now". Others not checked. |
| X3 | Stop the backend and use the app | Error message shown, no blank screen | Skip | Not run. |
| X4 | Check the browser console across all sections | No uncaught errors | Partly | No errors seen in the console during the sections run. |
| X5 | Upload a large or non-image file as a job photo | Rejected or handled cleanly | | Valid JPEGs accepted for KYC photos. Large and non-image files not tried yet. |
| X6 | Exchange-rate feed failure | App still usable, no long stalls | Fail, then fixed | The feed host was unreachable from the test machine, so `/api/wallet/convert` returned 503 after a 10 second timeout on each of three parallel calls, and the pay screen held back the KES price until all three failed. Fixed: simultaneous requests share one provider call, a failure is remembered for 30 seconds, and a KES job shows its price at once. Covered by two new backend tests; not re-checked in the browser. |

### Findings and what was done

| Finding | Status |
|---|---|
| **X7, Firestore indexes missing (blocker for admin).** `GET /api/admin/disputes?status=open`, `/refund-requests?status=pending` and `/payments?status=...` return 500 on the real project (`FAILED_PRECONDITION: The query requires an index`), so the Disputes list, Refund requests list, Payments filter tabs and the overview's disputes panel fail. The README listed the indexes by hand, omitted `refundRequests`, and nothing declared them. The in-memory test database cannot catch this. | Added `backend/firestore.indexes.json` (11 indexes) and `backend/firebase.json`, corrected the README. The CLI deploy was refused for the service account (HTTP 403), so on 2026-10-28 the disputes, payments, withdrawals and refundRequests indexes were created in the Firebase console and the affected screens re-checked. The `jobs` status + currency + createdAt index is still not created in the project; run `firebase deploy --only firestore:indexes --project escrow-wallet-ed29d` from `backend/` to add it. |
| **X6, slow pay screen** when the exchange-rate feed is down. | Fixed (see X6). |
| **A2, no message** when the terms box is unticked. | Fixed and checked. |
| **J10, double-counted history.** | Fixed and checked on the worker history. |
| **J11, withdrawal shown as "Sent"** when only requested. | Relabelled "Requested" in the worker list and History. |
| **Admin payments** labelled top-ups "Escrow payment". | Fixed and checked. |
| **D3, workers could not raise a dispute in the UI.** The worker dashboard also listed only one job in progress. | Added a worker report screen and link; the dashboard now lists every job in progress. Checked end to end. Nav highlight fixed by using `/worker/report/:jobId`. |
| **D4, no sign of a pending refund request** on the client dashboard. | Not fixed. |
| Overview card "Held in escrow KES 600" counts "1 funded job" while two jobs were held. | Not investigated. |
| `PostJob.tsx` fails lint (`useMyLocation` called inside a callback). | Existing, not changed. |

## 10. Optional: real Daraja sandbox

Needs the `DARAJA_*` keys, shortcode 174379, an HTTPS tunnel such as ngrok for `DARAJA_CALLBACK_URL` (ending in `/api/payments/stk/callback/<DARAJA_STK_CALLBACK_SECRET>`), and the B2C variables for withdrawals. Set `DARAJA_SIMULATE=false` and repeat J5, J6, J11 and P1 with a real sandbox prompt.

## 11. Results log

| Date | Commit | Tester | Sections run | Passed | Failed | Bug issues |
|---|---|---|---|---|---|---|
| 2026-10-27 | `c0a242f` plus the fixes on this branch | Claude, in the built-in browser against the local stack (simulate mode, real Firestore) | 2 to 9 in full or part; 10 (real sandbox) not run | See Result column | A2, D1, J5 (slow), X6, X7 (all with fixes above; X7 verified fixed on 2026-10-28) | None filed; fixed in this branch |
