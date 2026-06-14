import { and, asc, eq, lte } from "drizzle-orm";
import type { PulseDb } from "@pulse/db";
import * as schema from "@pulse/db/schema";
import type { Monitor } from "@pulse/db/schema";
import { isSupported, probe as defaultProbe, type ProbeResult } from "./checks";

const DEFAULT_BATCH_SIZE = 50;

export interface RunDeps {
  db: PulseDb;
  /** Wall clock, injectable for deterministic tests. Defaults to `new Date()`. */
  now?: () => Date;
  /** Probe implementation, injectable for tests. Defaults to the real dispatch. */
  probe?: (monitor: Monitor) => Promise<ProbeResult>;
  /** Max monitors claimed per tick. */
  batchSize?: number;
}

export interface RunSummary {
  claimed: number;
  recorded: number;
  skipped: number;
  incidentsOpened: number;
  incidentsResolved: number;
}

type RecordOutcome = "opened" | "resolved" | "none";

/**
 * Run one scheduling tick: claim every monitor that is due, probe each, persist
 * the result, and open/resolve incidents on up↔down transitions. Pure with
 * respect to its injected `db`/`now`/`probe`, so the same path the loop runs is
 * exercised verbatim in tests.
 */
export async function runDueChecks(deps: RunDeps): Promise<RunSummary> {
  const now = deps.now?.() ?? new Date();
  const probe = deps.probe ?? defaultProbe;
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;

  const due = await claimDueMonitors(deps.db, now, batchSize);
  const summary: RunSummary = {
    claimed: due.length,
    recorded: 0,
    skipped: 0,
    incidentsOpened: 0,
    incidentsResolved: 0,
  };

  for (const monitor of due) {
    if (!isSupported(monitor)) {
      summary.skipped += 1;
      console.warn(
        `[worker] skipping monitor ${monitor.id}: type "${monitor.type}" not yet supported`,
      );
      continue;
    }

    let result: ProbeResult;
    try {
      result = await probe(monitor);
    } catch (err) {
      // Probe dispatch should never throw for supported types, but never let a
      // single bad monitor take down the tick.
      result = {
        status: "down",
        responseTimeMs: null,
        statusCode: null,
        error: err instanceof Error ? err.message : "probe failed",
      };
    }

    const outcome = await recordResult(deps.db, monitor, result, now);
    summary.recorded += 1;
    if (outcome === "opened") summary.incidentsOpened += 1;
    if (outcome === "resolved") summary.incidentsResolved += 1;
  }

  return summary;
}

/**
 * Atomically claim due monitors and push their `next_check_at` forward so a
 * subsequent tick (or a second worker) won't re-claim them. `FOR UPDATE SKIP
 * LOCKED` lets multiple workers share the table without blocking each other.
 */
async function claimDueMonitors(
  db: PulseDb,
  now: Date,
  batchSize: number,
): Promise<Monitor[]> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(schema.monitors)
      .where(
        and(
          eq(schema.monitors.enabled, true),
          lte(schema.monitors.nextCheckAt, now),
        ),
      )
      .orderBy(asc(schema.monitors.nextCheckAt))
      .limit(batchSize)
      .for("update", { skipLocked: true });

    for (const monitor of due) {
      const nextCheckAt = new Date(
        now.getTime() + monitor.intervalSeconds * 1000,
      );
      await tx
        .update(schema.monitors)
        .set({ nextCheckAt })
        .where(eq(schema.monitors.id, monitor.id));
    }

    return due;
  });
}

/**
 * Persist one probe result and reconcile incident state in a single
 * transaction:
 *  - append the check row (append-only time series),
 *  - on up→down (including an unknown→down first check) open an incident,
 *  - on down→up resolve the open incident,
 *  - roll the monitor's cached `status`/`last_checked_at` forward.
 *
 * The partial unique index (one open incident per monitor) makes the open path
 * idempotent under races via ON CONFLICT DO NOTHING.
 */
async function recordResult(
  db: PulseDb,
  monitor: Monitor,
  result: ProbeResult,
  checkedAt: Date,
): Promise<RecordOutcome> {
  return db.transaction(async (tx) => {
    await tx.insert(schema.checks).values({
      monitorId: monitor.id,
      checkedAt,
      status: result.status,
      responseTimeMs: result.responseTimeMs,
      statusCode: result.statusCode,
      error: result.error,
    });

    let outcome: RecordOutcome = "none";
    const wasDown = monitor.status === "down";

    if (result.status === "down" && !wasDown) {
      const opened = await tx
        .insert(schema.incidents)
        .values({
          monitorId: monitor.id,
          status: "open",
          startedAt: checkedAt,
          cause: result.error,
        })
        .onConflictDoNothing()
        .returning({ id: schema.incidents.id });
      if (opened.length > 0) outcome = "opened";
    } else if (result.status === "up" && wasDown) {
      const resolved = await tx
        .update(schema.incidents)
        .set({ status: "resolved", resolvedAt: checkedAt })
        .where(
          and(
            eq(schema.incidents.monitorId, monitor.id),
            eq(schema.incidents.status, "open"),
          ),
        )
        .returning({ id: schema.incidents.id });
      if (resolved.length > 0) outcome = "resolved";
    }

    await tx
      .update(schema.monitors)
      .set({ status: result.status, lastCheckedAt: checkedAt })
      .where(eq(schema.monitors.id, monitor.id));

    return outcome;
  });
}
