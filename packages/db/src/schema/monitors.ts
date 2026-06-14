import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "./auth";
import { timestamps } from "./_shared";

/** Probe protocol. `target` is interpreted per type (see column comment). */
export const monitorType = pgEnum("monitor_type", ["http", "tcp", "ping"]);

/**
 * Current rolled-up state of a monitor. `unknown` until the first check runs;
 * `paused` is distinct from `enabled=false` at the worker level but mirrored
 * here for cheap display. `up`/`down` reflect the latest check outcome.
 */
export const monitorStatus = pgEnum("monitor_status", [
  "up",
  "down",
  "paused",
  "unknown",
]);

/**
 * A monitor is a single thing we probe on a schedule for one account.
 *
 * Scheduling lives on the row so the worker can claim due work with
 * `SELECT ... WHERE enabled AND next_check_at <= now() ORDER BY next_check_at
 * FOR UPDATE SKIP LOCKED` (see ADR 0001). After each probe the worker writes
 * the outcome to `checks`, updates `status`/`last_checked_at`, and pushes
 * `next_check_at` forward by `interval_seconds`. The partial index on
 * `next_check_at` (enabled only) keeps that claim query fast.
 */
export const monitors = pgTable(
  "monitors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: monitorType("type").notNull().default("http"),
    // http: full URL; tcp: "host:port"; ping: hostname or IP.
    target: text("target").notNull(),
    // HTTP method for http monitors; ignored for tcp/ping.
    method: text("method").notNull().default("GET"),
    intervalSeconds: integer("interval_seconds").notNull().default(60),
    timeoutMs: integer("timeout_ms").notNull().default(10000),
    // Expected HTTP status for http monitors (null = any 2xx is healthy).
    expectedStatusCode: integer("expected_status_code"),
    enabled: boolean("enabled").notNull().default(true),
    status: monitorStatus("status").notNull().default("unknown"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...timestamps,
  },
  (t) => [
    index("monitors_account_idx").on(t.accountId),
    // Supports the worker's "due monitors" claim query; only enabled rows are
    // ever claimable, so keep them out of the index entirely.
    index("monitors_due_idx").on(t.nextCheckAt).where(sql`${t.enabled}`),
  ],
);

export type Monitor = typeof monitors.$inferSelect;
export type NewMonitor = typeof monitors.$inferInsert;
