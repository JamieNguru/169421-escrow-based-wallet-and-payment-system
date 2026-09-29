function notFound(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

// Express only treats a middleware as an error handler if it declares all four arguments.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || 500;

  if (status >= 500) {
    console.error(err);
    return res.status(status).json({ error: "Internal server error" });
  }

  res.status(status).json({ error: err.message });
}

module.exports = { notFound, errorHandler };
