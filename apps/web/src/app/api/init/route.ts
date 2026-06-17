import { NextResponse } from "next/server";
import { runMigrationsIfNeeded } from "@/lib/migrate-on-startup";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await runMigrationsIfNeeded();
    return NextResponse.json({ status: "initialized" });
  } catch (error) {
    console.error("[init] Initialization error:", error);
    return NextResponse.json(
      { status: "partial", error: String(error) },
      { status: 200 }
    );
  }
}
