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
| Client | Dashboard, Post a Job, Choose a Worker, Pay into escrow (M-Pesa STK push), Release payment, Report a problem, Wallet, History, My Trust |
| Worker | Dashboard, Find Jobs, Withdraw to M-Pesa, History, My Trust |
| Admin | Overview, Disputes, Resolve dispute, Users, Payments |

## Where the app differs from the wireframes

The API doesn't carry some of what the wireframes show, so these are left out rather than invented:

- Log in with email (the API has no phone login); sign-up also asks for an email and has no country/currency picker.
- Job location, distance, categories and "needed by" dates, and job photos.
- Per-applicant price and trust level on Choose a Worker, and the client's trust level on job cards.
- The "split" option when resolving a dispute (the API supports release or refund only), and dispute photos.
- Trust inputs such as "jobs done" (the API returns the level and probabilities only).
