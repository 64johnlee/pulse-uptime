import { NextResponse } from "next/server";
import { pool } from "@pulse/db";

/**
 * Liveness/readiness probe. Returns 200 when the app can reach Postgres, 503
 * otherwise. Used by deploy platforms and (later) the status page itself.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await pool.query("select 1");
    return NextResponse.json({ status: "ok", db: "up" });
  } catch (err) {
    console.error("[health] db check failed:", err);
    return NextResponse.json(
      { status: "degraded", db: "down" },
      { status: 503 },
    );
  }
}
