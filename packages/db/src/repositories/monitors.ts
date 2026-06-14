import { and, desc, eq } from "drizzle-orm";
import { db as defaultDb, type PulseDb } from "../client";
import { monitors } from "../schema/monitors";
import type { Monitor } from "../schema/monitors";

/**
 * Monitors repository — the only place that talks to the `monitors` table.
 *
 * Storage concerns only; callers (the web app's monitor service) own
 * validation and normalization. Every function accepts an optional db handle
 * so tests can inject a PGlite-backed instance.
 *
 * Tenancy: every read and write is scoped by `accountId`. There is no
 * "get by id" without an account — a monitor id alone is never enough to
 * touch a row, so one tenant can never read or mutate another's data even if
 * an id leaks. This mirrors the account-scoping contract documented on the
 * auth schema (JJC-5).
 */

/** Fields a caller may set when creating a monitor. */
export interface CreateMonitorInput {
  name: string;
  target: string;
  method?: string;
  intervalSeconds?: number;
  timeoutMs?: number;
  expectedStatusCode?: number | null;
  enabled?: boolean;
}

/**
 * Fields a caller may change. All optional — only provided keys are written.
 * `accountId`, `id`, `status`, and scheduling columns are intentionally not
 * editable here (scheduling/state is owned by the worker, JJC-7).
 */
export interface UpdateMonitorInput {
  name?: string;
  target?: string;
  method?: string;
  intervalSeconds?: number;
  timeoutMs?: number;
  expectedStatusCode?: number | null;
  enabled?: boolean;
}

/** List an account's monitors, newest first. */
export async function listMonitors(
  accountId: string,
  dbh: PulseDb = defaultDb,
): Promise<Monitor[]> {
  return dbh
    .select()
    .from(monitors)
    .where(eq(monitors.accountId, accountId))
    .orderBy(desc(monitors.createdAt));
}

/** Fetch a single monitor owned by `accountId`, or undefined. */
export async function getMonitor(
  accountId: string,
  id: string,
  dbh: PulseDb = defaultDb,
): Promise<Monitor | undefined> {
  const [monitor] = await dbh
    .select()
    .from(monitors)
    .where(and(eq(monitors.id, id), eq(monitors.accountId, accountId)))
    .limit(1);
  return monitor;
}

/** Create a monitor for an account. `type` is always "http" for v1. */
export async function createMonitor(
  accountId: string,
  input: CreateMonitorInput,
  dbh: PulseDb = defaultDb,
): Promise<Monitor> {
  const [monitor] = await dbh
    .insert(monitors)
    .values({
      accountId,
      name: input.name,
      type: "http",
      target: input.target,
      method: input.method ?? "GET",
      intervalSeconds: input.intervalSeconds,
      timeoutMs: input.timeoutMs,
      expectedStatusCode: input.expectedStatusCode ?? null,
      enabled: input.enabled,
    })
    .returning();
  if (!monitor) throw new Error("failed to create monitor");
  return monitor;
}

/**
 * Patch a monitor owned by `accountId`. Returns the updated row, or undefined
 * if no monitor with that id belongs to the account. A no-op patch (no keys)
 * still returns the current row.
 */
export async function updateMonitor(
  accountId: string,
  id: string,
  input: UpdateMonitorInput,
  dbh: PulseDb = defaultDb,
): Promise<Monitor | undefined> {
  // Build the patch from only the keys the caller provided so we never clobber
  // columns with undefined. `expectedStatusCode: null` is a deliberate clear.
  const patch: Partial<typeof monitors.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.target !== undefined) patch.target = input.target;
  if (input.method !== undefined) patch.method = input.method;
  if (input.intervalSeconds !== undefined)
    patch.intervalSeconds = input.intervalSeconds;
  if (input.timeoutMs !== undefined) patch.timeoutMs = input.timeoutMs;
  if (input.expectedStatusCode !== undefined)
    patch.expectedStatusCode = input.expectedStatusCode;
  if (input.enabled !== undefined) patch.enabled = input.enabled;

  if (Object.keys(patch).length === 0) {
    return getMonitor(accountId, id, dbh);
  }

  const [monitor] = await dbh
    .update(monitors)
    .set(patch)
    .where(and(eq(monitors.id, id), eq(monitors.accountId, accountId)))
    .returning();
  return monitor;
}

/**
 * Delete a monitor owned by `accountId`. Returns true if a row was removed,
 * false if nothing matched (unknown id or not this account's monitor).
 */
export async function deleteMonitor(
  accountId: string,
  id: string,
  dbh: PulseDb = defaultDb,
): Promise<boolean> {
  const deleted = await dbh
    .delete(monitors)
    .where(and(eq(monitors.id, id), eq(monitors.accountId, accountId)))
    .returning({ id: monitors.id });
  return deleted.length > 0;
}
