import { NextResponse } from "next/server";
import { runMigrations } from "@pulse/db";

/**
 * One-off migration endpoint for initializing the database.
 * This should only be called once per deployment.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Basic security: check for authorization header
  const authHeader = request.headers.get("authorization");
  const expectedToken = process.env.MIGRATION_TOKEN || "dev-token";

  if (authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("[migrate] Starting database migrations...");

    await runMigrations();

    console.log("[migrate] ✓ Migrations complete");

    return NextResponse.json({
      status: "success",
      message: "Database migrations completed",
    });
  } catch (error) {
    console.error("[migrate] Error:", error);

    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
