// Tax and monitoring limits. The payout limit can be changed per deployment.
const configured = Number(process.env.TAX_PIN_THRESHOLD_KES);

// A worker with no tax PIN on file can withdraw up to this much (KES) in a calendar year.
export const TAX_PIN_THRESHOLD_KES = Number.isFinite(configured) && configured > 0 ? configured : 100_000;

// Kenyan time (UTC+3, no daylight saving): statements and the "year" for the limit follow it.
export const EAT_OFFSET_MS = 3 * 3_600_000;

// Possible splitting: this many jobs between the same two people inside the window, each
// under the per-job limit but adding up to at least the total.
export const SPLIT_MIN_JOBS = 5;
export const SPLIT_WINDOW_DAYS = 14;
export const SPLIT_JOB_LIMIT_KES = 10_000;
export const SPLIT_TOTAL_KES = 50_000;

// Refund after delivery: refunded jobs where the work had already been handed over.
export const REFUND_AFTER_DELIVERY_MIN = 2;
