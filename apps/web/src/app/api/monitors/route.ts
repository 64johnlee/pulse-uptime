import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createMonitor, listMonitors } from "@/lib/monitors/service";
import { createMonitorSchema } from "@/lib/monitors/validation";

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

  const monitor = await createMonitor(session.account.id, parsed.data);
  return NextResponse.json({ success: true, data: monitor }, { status: 201 });
}
