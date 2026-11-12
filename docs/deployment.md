# Deployment

The demo deployment uses free tiers only:

| Part | Host | Root |
|---|---|---|
| Trust-scoring service (Flask) | Hugging Face Spaces, Docker SDK | `trust-scoring-ml/` |
| Backend API (Express) | Vercel, serverless function | `backend/` |
| Web app (React) | Vercel, static build | `frontend/` |
| Database | Firebase Firestore (existing project) | - |

The web app rewrites `/api/*` to the backend project (`frontend/vercel.json`), so the browser sees one origin and no CORS or `VITE_API_URL` is needed. Deploy in the order below: each step needs the URL of the one before.

## 1. Trust-scoring service on Hugging Face Spaces

1. Train the two served models locally (the Olist CSVs must be in `data/olist/`):

   ```
   cd trust-scoring-ml
   python -m src.realistic        # client_trust_model_v2.joblib
   python -m src.history_model    # worker_trust_model_history.joblib
   ```

2. Create a Space at huggingface.co (SDK: **Docker**, hardware: free CPU) and clone it.
3. Copy into the Space folder: `Dockerfile`, `requirements-deploy.txt`, `app.py`, `src/`, and a `models/` folder with only `client_trust_model_v2.joblib` and `worker_trust_model_history.joblib`. Do not copy `data/`: the Olist data is CC BY-NC-SA and only the trained models are needed.
4. Commit and push. When the build finishes, check `https://<user>-<space>.hf.space/health`.

The Space sleeps after about 48 hours without traffic. The first trust request after that returns 503 while it wakes; the backend already treats that as "trust level unavailable", and the next request works.

## 2. Backend on Vercel

1. In Vercel, import the GitHub repository as a new project named **kaziforce-api**, with **Root Directory** `backend` and framework preset **Other**. `backend/vercel.json` sets the build (type check), the empty `public/` output and the rewrite of every path to `api/index.ts`.
2. Set these environment variables (Production and Preview):

   | Variable | Value |
   |---|---|
   | `JWT_SECRET` | A new long random string (not the local one) |
   | `FIREBASE_SERVICE_ACCOUNT_JSON` | The service account key file's contents, raw or base64 |
   | `ML_SERVICE_URL` | The Space URL from step 1, no trailing slash |
   | `DARAJA_SIMULATE` | `true` |
   | `ALLOW_SIMULATE_IN_PRODUCTION` | `true` (demo only: payments are simulated) |

3. Deploy and check `https://kaziforce-api.vercel.app/api/health`.
4. Create the Firestore indexes once, from `backend/` (needs the Firebase CLI and a login): `firebase deploy --only firestore:indexes --project escrow-wallet-ed29d`.
5. Create the admin account and, if wanted, the demo accounts, by running `npm run seed:admin` and `npm run seed:demo` locally with `.env` pointing at the same Firebase project.

## 3. Web app on Vercel

1. Import the repository again as a second project, **Root Directory** `frontend`, framework preset **Vite**.
2. If the backend project got a different URL than `kaziforce-api.vercel.app`, change the first rewrite in `frontend/vercel.json` to it.
3. Deploy. Production deploys from `main`; pull requests get preview deployments.

## Smoke test

Health check; register and log in; top up (simulated); post a job, apply, select, fund, submit and release; raise a dispute and resolve it as admin; open a worker's trust page and the client's applicant list; load the admin overview, disputes and refunds (these need the indexes); check one page at 375 px wide.

## Notes

- The deployment shares the Firebase project with local development.
- Vercel's Hobby plan is for non-commercial use.
- Secrets live only in the Vercel and Hugging Face dashboards. `.env` files and key files stay git-ignored.
