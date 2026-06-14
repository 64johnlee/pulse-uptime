import {
  pgTable,
  text,
  timestamp,
  uuid,
  index,
} from "drizzle-orm/pg-core";

/**
 * Authentication & tenancy schema (JJC-5).
 *
 * Tenancy model for v1: an `account` is the team/tenant that owns all data.
 * A `user` belongs to exactly one account and authenticates with email +
 * password. Sign-up creates an account and its first user together. The model
 * is intentionally shaped so multi-user accounts are a later additive change
 * (no schema migration needed to add more users to an account).
 *
 * EVERY future domain table (monitors, checks, incidents — JJC-4) MUST carry an
 * `account_id` FK and be queried through the account-scoped helpers so data is
 * isolated per tenant. See apps/web/src/lib/auth.
 */
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // Stored lowercased; uniqueness is case-insensitive by normalizing at the
    // application boundary before insert/lookup.
    email: text("email").notNull().unique(),
    // scrypt-derived hash, self-describing format — never the raw password.
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("users_account_id_idx").on(t.accountId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // SHA-256 of the opaque session token. The raw token lives only in the
    // user's cookie; a DB leak alone cannot be replayed as a session.
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
