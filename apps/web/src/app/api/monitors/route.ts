import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { createMonitor, listMonitors } from "@/lib/monitors/service";
import { MonitorError } from "@/lib/monitors/errors";
import { createMonitorSchema } from "@/lib/monitors/validation";

const CREATE_LIMIT = 30;
const CREATE_WINDOW_MS = 5 * 60 * 1000;

/**
 * REST API for monitors (collection). Account-scoped via the session cookie —
 * the same tenancy boundary the UI uses. Returns the shared API envelope
 * ({ success, data?, error? }).
 *
 * GET  /api/monitors  → list the account's monitors
 * POST /api/monitors  → create a monitor (JSON body)
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { success: false, error: "Not authenticated." },
      { status: 401 },
    );
  }

  const monitors = await listMonitors(session.account.id);
  return NextResponse.json({ success: true, data: monitors });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { success: false, error: "Not authenticated." },
      { status: 401 },
    );
  }

  if (
    !rateLimit(
      `monitor-create:${session.account.id}`,
      CREATE_LIMIT,
      CREATE_WINDOW_MS,
    ).ok
  ) {
    return NextResponse.json(
      { success: false, error: "Rate limit exceeded. Try again shortly." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = createMonitorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Validation failed.",
        issues: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  try {
    const monitor = await createMonitor(session.account.id, parsed.data);
    return NextResponse.json({ success: true, data: monitor }, { status: 201 });
  } catch (err) {
    if (err instanceof MonitorError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 409 },
      );
    }
    throw err;
  }
}
