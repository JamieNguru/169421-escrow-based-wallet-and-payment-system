const express = require("express");
const cors = require("cors");

const healthRouter = require("./routes/health");
const { notFound, errorHandler } = require("./middleware/errorHandler");

function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use("/api/health", healthRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
