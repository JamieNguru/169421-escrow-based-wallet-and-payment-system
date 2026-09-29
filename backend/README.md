# Backend

Node.js + Express API for the escrow-based wallet and payment system.

## Setup

```
npm install
cp .env.example .env
```

## Run

```
npm run dev     # restarts on file changes
npm start
```

The API listens on `PORT` from `.env` (default 4000). Check it's up with `GET /api/health`.

## Test

```
npm test
```

## Structure

- `src/app.js` — builds the Express app (used by both the server and the tests)
- `src/server.js` — loads `.env` and starts listening
- `src/routes/` — route handlers, one file per resource
- `src/middleware/` — shared middleware (404 and error handling)
- `tests/` — Jest + Supertest tests
