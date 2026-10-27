# Escrow Wallet frontend

React + TypeScript + Vite single-page app for the escrow wallet platform. It has three role-based areas (Client, Worker, Admin) built from the 18 wireframes, and talks to the Express backend in [`../backend`](../backend).

## Run it

```
cd frontend
npm install
npm run dev        # http://localhost:5173
```

In development Vite proxies `/api` to `http://localhost:4000`, so start the backend first (`cd backend && npm run dev`). For a deployed build, copy `.env.example` to `.env` and set `VITE_API_URL` to the backend's public URL.

```
npm run build      # typecheck + production build into dist/
npm run lint       # oxlint
```

## Layout

- `src/api/`: `http.ts` (fetch wrapper that adds the Bearer token), `api.ts` (one typed function per endpoint), `types.ts`
- `src/auth/`: `AuthProvider` (session kept in `localStorage`) and `RequireRole` (route guard)
- `src/components/`: `AppShell` (sidebar and header per role) and the shared UI in `ui.tsx`
- `src/pages/{auth,client,worker,admin,shared}/`: one file per wireframe screen
- `src/index.css`: Tailwind theme with the wireframe palette (green `#15803d`, ink, canvas, amber, red)

## Screens

| Role | Screens |
|---|---|
| Public | Login, Register |
| Client | Dashboard, Post a Job, Choose a Worker, Pay into escrow (from the wallet or with an M-Pesa prompt), Release payment, Report a problem, Wallet (with a top-up), History, My Trust |
| Worker | Dashboard (every job in progress, each with "Report a problem"), Find Jobs, Verification, Report a problem, Withdraw to M-Pesa, History, My Trust |
| Admin | Overview, Disputes, Resolve dispute, Users, Payments |

## Where the app differs from the wireframes

The API doesn't carry some of what the wireframes show, so these are left out rather than invented:

- Sign-up asks for an email and has no country/currency picker (every wallet is in KES).
- Job categories and "needed by" dates (jobs have a location, distance and photos, but no category or date).
- Per-applicant price on Choose a Worker: an application has no price, so the job's budget applies. The trust badge is shown.
- Trust inputs such as "jobs done" (the API returns the level and probabilities only).

## Photos and location

- Photos are shrunk in the browser (`src/lib/images.ts`) and sent as data URLs inside the job or dispute document, three at most, because no file storage is configured. Lists carry a photo count; the photos load when a worker taps "View photos" or an admin opens a dispute.
- "Use my current position" on Post a Job and "Near me" on Find Jobs use the browser's location (the browser asks for permission). Distances are straight-line, not driving distance.

## Paying with M-Pesa

The pay screen offers the wallet when its balance covers the job, and an M-Pesa prompt otherwise (the prompt tops the wallet up and pays in one step). The Wallet page has a "Top up with M-Pesa" card. While a prompt is open the screen polls the payment until it settles (`src/components/MpesaWait.tsx`).

To try it without Daraja, set `DARAJA_SIMULATE=true` in `backend/.env` and restart the backend: no prompt is sent, and the screen shows "Simulate a successful payment" and "Simulate a cancelled payment" buttons instead. See the backend README for the real setup.
