import express, { type Express } from "express";
import cors from "cors";

import adminRouter from "./routes/admin";
import authRouter from "./routes/auth";
import escrowRouter from "./routes/escrow";
import healthRouter from "./routes/health";
import jobsRouter from "./routes/jobs";
import kycRouter from "./routes/kyc";
import paymentsRouter from "./routes/payments";
import transactionsRouter from "./routes/transactions";
import trustScoreRouter from "./routes/trustScore";
import walletRouter from "./routes/wallet";
import { CURRENT_TERMS_VERSION, TERMS_PATH } from "./config/terms";
import { errorHandler, notFound } from "./middleware/errorHandler";

export function createApp(): Express {
  const app = express();

  app.use(cors());
  // Job and dispute photos arrive as data URLs, so allow more than the 100 kb default.
  app.use(express.json({ limit: "2mb" }));

  app.use("/api/health", healthRouter);
  app.get("/api/terms", (_req, res) => {
    res.json({ version: CURRENT_TERMS_VERSION, url: TERMS_PATH });
  });
  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/trust-score", trustScoreRouter);
  app.use("/api/escrow", escrowRouter);
  app.use("/api/transactions", transactionsRouter);
  app.use("/api/payments", paymentsRouter);
  app.use("/api/wallet", walletRouter);
  app.use("/api/jobs", jobsRouter);
  app.use("/api/kyc", kycRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
