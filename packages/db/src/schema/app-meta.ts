import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Baseline table proving the migration pipeline end-to-end.
 *
 * `app_meta` is a tiny key/value store for application-level metadata (e.g. a
 * schema marker, feature flags during bootstrap). The real domain model
 * (accounts, monitors, checks, incidents) lands in JJC-4 and will add its own
 * migration on top of this baseline.
 */
export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AppMeta = typeof appMeta.$inferSelect;
export type NewAppMeta = typeof appMeta.$inferInsert;
