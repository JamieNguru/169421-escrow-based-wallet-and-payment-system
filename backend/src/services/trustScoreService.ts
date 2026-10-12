import { getDb } from "../config/firebase";
import { getMlServiceUrl } from "../config/mlService";
import { HttpError } from "../errors";

const COLLECTIONS = { client: "clients", worker: "workers" } as const;
const REQUEST_TIMEOUT_MS = 5000;
const UNAVAILABLE = "trust scoring unavailable";

export type ScoredRole = keyof typeof COLLECTIONS;

// Placeholder feature values for users with no stored stats. Once jobs and
// escrow transactions exist, compute these from them instead.
const DEFAULT_FEATURES: Record<ScoredRole, Record<string, number>> = {
  worker: { job_completion_rate: 0.8, dispute_rate: 0.1, response_time_hours: 24 },
  client: { payment_completion_rate: 0.9, refund_rate: 0.1, escrow_release_time_hours: 24 },
};

export interface TrustScore {
  userId: string;
  role: ScoredRole;
  trustLevel: string;
  probabilities: Record<string, number>;
}

// Features are the role's defaults overridden by the optional trustStats field
// on the user's document.
export async function getTrustFeatures(
  userId: string,
  role: ScoredRole,
): Promise<Record<string, number>> {
  const doc = await getDb().collection(COLLECTIONS[role]).doc(userId).get();
  const user = doc.data();
  if (!doc.exists || !user) {
    throw new HttpError(404, "User not found");
  }
  return { ...DEFAULT_FEATURES[role], ...(user.trustStats ?? {}) };
}

export async function getTrustScore(userId: string, role: ScoredRole): Promise<TrustScore> {
  const features = await getTrustFeatures(userId, role);

  let body: { trust_level?: unknown; probabilities?: unknown };
  try {
    const res = await fetch(`${getMlServiceUrl()}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, features }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`score service responded ${res.status}`);
    }
    body = await res.json();
  } catch (err) {
    console.error("Trust score request failed:", err);
    throw new HttpError(503, UNAVAILABLE);
  }

  if (typeof body.trust_level !== "string" || typeof body.probabilities !== "object") {
    throw new HttpError(503, UNAVAILABLE);
  }

  return {
    userId,
    role,
    trustLevel: body.trust_level,
    probabilities: body.probabilities as Record<string, number>,
  };
}
