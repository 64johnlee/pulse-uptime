/**
 * Pure logic for the `/api/health` probe, kept separate from the route handler
 * so it is unit-testable without a database or the Next.js runtime.
 */
export type HealthBody = {
  status: "ok" | "degraded";
  db: "up" | "down";
};

export type HealthResult = {
  body: HealthBody;
  httpStatus: number;
};

/**
 * Build the health response from whether Postgres is reachable.
 * 200 when the DB is up, 503 (degraded) otherwise.
 */
export function buildHealth(dbReachable: boolean): HealthResult {
  return dbReachable
    ? { body: { status: "ok", db: "up" }, httpStatus: 200 }
    : { body: { status: "degraded", db: "down" }, httpStatus: 503 };
}
