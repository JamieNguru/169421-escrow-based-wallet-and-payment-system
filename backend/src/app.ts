import express, { type Express } from "express";
import cors from "cors";

import healthRouter from "./routes/health";
import { errorHandler, notFound } from "./middleware/errorHandler";

export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use("/api/health", healthRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
