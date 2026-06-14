import { relations } from "drizzle-orm";
import { accounts, users } from "./auth";
import { checks } from "./checks";
import { incidents } from "./incidents";
import { monitors } from "./monitors";

/**
 * Drizzle relation metadata. Purely an ORM convenience for typed relational
 * queries (`db.query.accounts.findFirst({ with: { monitors: true } })`) — it
 * emits no SQL and adds no constraints (those live on the table definitions via
 * `references()`). Kept in one file so the table modules stay free of circular
 * import churn.
 *
 * Tenancy follows the JJC-5 auth model: a user belongs to one account, and an
 * account owns its monitors. Monitors own their append-only checks and their
 * incidents.
 */
export const accountsRelations = relations(accounts, ({ many }) => ({
  users: many(users),
  monitors: many(monitors),
}));

export const usersRelations = relations(users, ({ one }) => ({
  account: one(accounts, {
    fields: [users.accountId],
    references: [accounts.id],
  }),
}));

export const monitorsRelations = relations(monitors, ({ one, many }) => ({
  account: one(accounts, {
    fields: [monitors.accountId],
    references: [accounts.id],
  }),
  checks: many(checks),
  incidents: many(incidents),
}));

export const checksRelations = relations(checks, ({ one }) => ({
  monitor: one(monitors, {
    fields: [checks.monitorId],
    references: [monitors.id],
  }),
}));

export const incidentsRelations = relations(incidents, ({ one }) => ({
  monitor: one(monitors, {
    fields: [incidents.monitorId],
    references: [monitors.id],
  }),
}));
