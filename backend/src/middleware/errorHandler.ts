import type { ErrorRequestHandler, RequestHandler } from "express";

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
};

// Express only treats a middleware as an error handler if it declares all four arguments.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status: number = typeof err?.status === "number" ? err.status : 500;

  if (status >= 500) {
    console.error(err);
    res.status(status).json({ error: "Internal server error" });
  } else {
    res.status(status).json({ error: err.message });
  }
};
