/**
 * The normalized outcome of a single probe, shaped to map directly onto a row
 * in the `checks` table. Every checker (http/tcp/…) returns this so the runner
 * can persist results without knowing how the probe was performed.
 */
export interface ProbeResult {
  /** Binary health verdict for this probe. */
  status: "up" | "down";
  /** Round-trip latency in ms; null when the request never completed. */
  responseTimeMs: number | null;
  /** HTTP status code for http monitors; null for tcp/ping or on failure. */
  statusCode: number | null;
  /** Human-readable failure reason on a "down" result; null when up. */
  error: string | null;
}
