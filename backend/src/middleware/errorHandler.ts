import type { ErrorRequestHandler, RequestHandler } from "express";

import { HttpError } from "../errors";

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
};

// Express only treats a middleware as an error handler if it declares all four arguments.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status: number = typeof err?.status === "number" ? err.status : 500;

  // HttpError messages are written for clients (e.g. 503 "service unavailable");
  // anything else that reaches here is unexpected and stays hidden.
  if (status >= 500 && !(err instanceof HttpError)) {
    console.error(err);
    res.status(status).json({ error: "Internal server error" });
  } else {
    res.status(status).json({ error: err.message });
  }
};
