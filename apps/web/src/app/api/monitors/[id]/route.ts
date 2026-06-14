import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import {
  deleteMonitor,
  getMonitor,
  updateMonitor,
} from "@/lib/monitors/service";
import { updateMonitorSchema } from "@/lib/monitors/validation";

/**
 * REST API for a single monitor. Account-scoped: the service constrains every
 * query to the session's account, so an id that belongs to another tenant
 * reads as 404 — never a cross-account leak.
 *
 * GET    /api/monitors/:id  → fetch one monitor
 * PATCH  /api/monitors/:id  → replace editable fields (JSON body)
 * DELETE /api/monitors/:id  → remove the monitor
 */
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// Fresh response per call — NextResponse objects are mutable, so they must
// never be shared across requests.
const unauthorized = () =>
  NextResponse.json(
    { success: false, error: "Not authenticated." },
    { status: 401 },
  );

const notFound = () =>
  NextResponse.json(
    { success: false, error: "Monitor not found." },
    { status: 404 },
  );

export async function GET(_request: Request, context: RouteContext) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { id } = await context.params;
  const monitor = await getMonitor(session.account.id, id);
  if (!monitor) return notFound();

  return NextResponse.json({ success: true, data: monitor });
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await getSession();
  if (!session) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = updateMonitorSchema.safeParse(body);
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

  const { id } = await context.params;
  const monitor = await updateMonitor(session.account.id, id, parsed.data);
  if (!monitor) return notFound();

  return NextResponse.json({ success: true, data: monitor });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { id } = await context.params;
  const removed = await deleteMonitor(session.account.id, id);
  if (!removed) return notFound();

  return NextResponse.json({ success: true, data: { id } });
}
