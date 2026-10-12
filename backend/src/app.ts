import express, { type Express } from "express";
import cors from "cors";

import authRouter from "./routes/auth";
import escrowRouter from "./routes/escrow";
import healthRouter from "./routes/health";
import jobsRouter from "./routes/jobs";
import paymentsRouter from "./routes/payments";
import transactionsRouter from "./routes/transactions";
import trustScoreRouter from "./routes/trustScore";
import walletRouter from "./routes/wallet";
import { errorHandler, notFound } from "./middleware/errorHandler";

export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use("/api/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/trust-score", trustScoreRouter);
  app.use("/api/escrow", escrowRouter);
  app.use("/api/transactions", transactionsRouter);
  app.use("/api/payments", paymentsRouter);
  app.use("/api/wallet", walletRouter);
  app.use("/api/jobs", jobsRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
