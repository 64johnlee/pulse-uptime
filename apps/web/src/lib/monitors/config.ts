/**
 * Monitor configuration constants. Centralized so input bounds, allowed HTTP
 * methods, and the check-interval choices live in one place shared by
 * validation, the UI, and the (future) worker.
 */

/** HTTP methods we let users probe with. Kept small and safe for v1. */
export const HTTP_METHODS = ["GET", "HEAD", "POST"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

/** Interval bounds (seconds). Floor keeps us from hammering targets; ceiling
 * is one day. The worker enforces the same floor when scheduling. */
export const MIN_INTERVAL_SECONDS = 30;
export const MAX_INTERVAL_SECONDS = 86_400;

/** Presets surfaced in the UI dropdown. Any value in range is still valid. */
export const INTERVAL_PRESETS = [
  { label: "Every 30 seconds", value: 30 },
  { label: "Every minute", value: 60 },
  { label: "Every 5 minutes", value: 300 },
  { label: "Every 15 minutes", value: 900 },
  { label: "Every 30 minutes", value: 1800 },
  { label: "Every hour", value: 3600 },
] as const;

export const DEFAULT_INTERVAL_SECONDS = 60;
export const DEFAULT_METHOD: HttpMethod = "GET";

/** Bounds for an optional expected HTTP status code. */
export const MIN_STATUS_CODE = 100;
export const MAX_STATUS_CODE = 599;

export const MAX_NAME_LENGTH = 120;
export const MAX_TARGET_LENGTH = 2048;

/** Per-account monitor cap — bounds resource growth and create-spam for v1.
 * Generous for the target persona (small dev teams); revisit with billing. */
export const MAX_MONITORS_PER_ACCOUNT = 100;
