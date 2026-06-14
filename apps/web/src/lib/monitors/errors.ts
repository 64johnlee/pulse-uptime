/**
 * Domain errors for the monitor service. Mirrors the auth module's typed-error
 * pattern so callers (server actions, API routes) can branch on a stable
 * `code` and render a safe, user-facing message instead of leaking internals.
 */
export type MonitorErrorCode = "limit_reached";

export class MonitorError extends Error {
  readonly code: MonitorErrorCode;

  constructor(code: MonitorErrorCode, message: string) {
    super(message);
    this.name = "MonitorError";
    this.code = code;
  }
}
