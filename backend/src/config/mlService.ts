const DEFAULT_ML_SERVICE_URL = "http://127.0.0.1:5000";

// Base URL of the trust-scoring Flask service (trust-scoring-ml/app.py).
export function getMlServiceUrl(): string {
  return (process.env.ML_SERVICE_URL || DEFAULT_ML_SERVICE_URL).replace(/\/+$/, "");
}
