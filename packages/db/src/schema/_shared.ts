import { timestamp } from "drizzle-orm/pg-core";

/**
 * Reusable column groups shared across domain tables.
 *
 * Every table gets `created_at` / `updated_at` (timestamptz). `updated_at` is
 * bumped at the ORM layer via `$onUpdate` on writes through Drizzle; the DB
 * default covers inserts and any raw SQL path. Column names are spelled in
 * snake_case explicitly to match the convention established by `app_meta`.
 */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
