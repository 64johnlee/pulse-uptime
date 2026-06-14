import { sql } from "drizzle-orm";
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { monitors } from "./monitors";

/** Lifecycle of an incident. Opens on a down transition, resolves on recovery. */
export const incidentStatus = pgEnum("incident_status", ["open", "resolved"]);

/**
 * An incident is a state-change record: a contiguous window during which a
 * monitor was down. The worker opens one when a monitor transitions up→down and
 * resolves it (sets `resolved_at`, status `resolved`) on down→up. This is the
 * source for downtime duration, history, and notifications.
 *
 * A partial unique index enforces the core invariant: at most one *open*
 * incident per monitor at any time. Resolved incidents accumulate freely.
 */
export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    status: incidentStatus("status").notNull().default("open"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    // Why it went down, captured from the triggering check (e.g. "HTTP 503").
    cause: text("cause"),
  },
  (t) => [
    index("incidents_monitor_idx").on(t.monitorId),
    uniqueIndex("incidents_one_open_per_monitor_uq")
      .on(t.monitorId)
      .where(sql`${t.status} = 'open'`),
  ],
);

export type Incident = typeof incidents.$inferSelect;
export type NewIncident = typeof incidents.$inferInsert;
