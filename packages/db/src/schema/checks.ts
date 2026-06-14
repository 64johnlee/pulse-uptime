import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { monitors } from "./monitors";

/** Outcome of a single probe. Binary by design; nuance lives in the columns. */
export const checkStatus = pgEnum("check_status", ["up", "down"]);

/**
 * A check is one probe result for a monitor — the raw time-series the worker
 * appends to. This table is append-only and the highest-volume one in Pulse, so
 * it deliberately omits the `updated_at` machinery and carries no defaults that
 * imply mutation. Status pages, uptime %, and latency graphs read from here.
 *
 * Indexed by (monitor_id, checked_at desc) for "latest N checks for a monitor"
 * and time-range queries. Partitioning by time can come later (ADR 0001) without
 * changing this shape.
 */
export const checks = pgTable(
  "checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: checkStatus("status").notNull(),
    // Round-trip latency of the probe; null when the request never completed.
    responseTimeMs: integer("response_time_ms"),
    // HTTP status code for http monitors; null for tcp/ping or on failure.
    statusCode: integer("status_code"),
    // Human-readable failure reason on a "down" check (e.g. "connection timeout").
    error: text("error"),
  },
  (t) => [
    index("checks_monitor_checked_idx").on(t.monitorId, t.checkedAt.desc()),
  ],
);

export type Check = typeof checks.$inferSelect;
export type NewCheck = typeof checks.$inferInsert;
