import { NextResponse } from "next/server";
import { pool } from "@pulse/db";

import { buildHealth } from "@/lib/health";
import { runMigrationsIfNeeded } from "@/lib/migrate-on-startup";

/**
 * Liveness/readiness probe. Returns 200 when the app can reach Postgres, 503
 * otherwise. Used by deploy platforms and (later) the status page itself.
 * Response shaping lives in `@/lib/health` so it can be unit-tested without a DB.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  // Ensure migrations run on first health check
  try {
    await runMigrationsIfNeeded();
  } catch (err) {
    console.warn("[health] migration warning:", err);
  }

  let dbReachable = false;
  try {
    await pool.query("select 1");
    dbReachable = true;
  } catch (err) {
    console.error("[health] db check failed:", err);
  }

  const { body, httpStatus } = buildHealth(dbReachable);
  return NextResponse.json(body, { status: httpStatus });
}
