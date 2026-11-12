# Deployment

The demo deployment uses free tiers only:

| Part | Host | Root |
|---|---|---|
| Trust-scoring service (Flask) | Render, free Docker web service | `trust-scoring-ml/` |
| Backend API (Express) | Vercel, serverless function | `backend/` |
| Web app (React) | Vercel, static build | `frontend/` |
| Database | Firebase Firestore (existing project) | - |

The web app rewrites `/api/*` to the backend project (`frontend/vercel.json`), so the browser sees one origin and no CORS or `VITE_API_URL` is needed. Deploy in the order below: each step needs the URL of the one before.

## Live demo

| Part | URL |
|---|---|
| Web app | https://kaziforce-tau.vercel.app |
| Backend API | https://kaziforce-api.vercel.app (health: `/api/health`) |
| Trust-scoring service | https://kaziforce-trust-scoring.onrender.com (health: `/health`) |

Payments run in simulate mode on this deployment, and it shares the Firebase project used for development. The trust service sleeps after 15 minutes idle on Render's free tier, so the first trust level after a pause can show as unavailable for up to a minute.

## 1. Trust-scoring service on Render

Hugging Face now needs a paid plan for Docker Spaces, so the service runs on Render's free tier, which needs no card.

1. The two served models are committed (`trust-scoring-ml/models/client_trust_model_v2.joblib` and `worker_trust_model_history.joblib`); every other model file stays git-ignored. To retrain them, run `python -m src.realistic` and `python -m src.history_model` (the latter needs the Olist CSVs in `data/olist/`, which are never committed), then commit the two files.
2. Sign in to render.com with GitHub, choose **New > Blueprint**, pick this repository and apply `render.yaml`. It creates the `kaziforce-trust-scoring` free Docker web service from `trust-scoring-ml/`, with `/health` as the health check.
3. When the deploy is live, check `https://kaziforce-trust-scoring.onrender.com/health`.

A free Render service sleeps after 15 minutes without traffic and takes up to about a minute to wake. The backend gives the service 5 seconds, so the first trust request after a pause returns "trust level unavailable" while it wakes, and the next one works.

The worker model was trained on the Olist dataset (CC BY-NC-SA 4.0), so the service is for non-commercial use.

## 2. Backend on Vercel

1. In Vercel, import the GitHub repository as a new project named **kaziforce-api**, with **Root Directory** `backend` and framework preset **Other**. `backend/vercel.json` sets the build (type check), the empty `public/` output and the rewrite of every path to `api/index.ts`.
2. Set these environment variables (Production and Preview):

   | Variable | Value |
   |---|---|
   | `JWT_SECRET` | A new long random string (not the local one) |
   | `FIREBASE_SERVICE_ACCOUNT_JSON` | The service account key file's contents, raw or base64 |
   | `ML_SERVICE_URL` | The Render URL from step 1, no trailing slash |
   | `DARAJA_SIMULATE` | `true` |
   | `ALLOW_SIMULATE_IN_PRODUCTION` | `true` (demo only: payments are simulated) |

3. Deploy and check `https://kaziforce-api.vercel.app/api/health`.
4. Create the Firestore indexes once, from `backend/` (needs the Firebase CLI and a login): `firebase deploy --only firestore:indexes --project escrow-wallet-ed29d`.
5. Create the admin account and, if wanted, the demo accounts, by running `npm run seed:admin` and `npm run seed:demo` locally with `.env` pointing at the same Firebase project.

## 3. Web app on Vercel

1. Import the repository again as a second project, **Root Directory** `frontend`, framework preset **Vite**.
2. If the backend project got a different URL than `kaziforce-api.vercel.app`, change the first rewrite in `frontend/vercel.json` to it.
3. Deploy. The project name `kaziforce` was taken on `vercel.app`, so the web app is at `kaziforce-tau.vercel.app`. Vercel deploys the project's production branch on every push; pull requests get preview deployments.

## Smoke test

Health check; register and log in; top up (simulated); post a job, apply, select, fund, submit and release; raise a dispute and resolve it as admin; open a worker's trust page and the client's applicant list; load the admin overview, disputes and refunds (these need the indexes); check one page at 375 px wide.

## Notes

- The deployment shares the Firebase project with local development.
- Vercel's Hobby plan is for non-commercial use.
- Secrets live only in the Vercel dashboard. `.env` files and key files stay git-ignored.
