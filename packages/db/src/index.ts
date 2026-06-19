/**
 * Public entrypoint for the shared `@pulse/db` package.
 *
 * Consumers (web app, worker) import the typed client and schema from here:
 *
 *   import { db, schema } from "@pulse/db";
 */
export { db, pool, schema } from "./client";
export type { PulseDb } from "./client";

// Migration runner (applies pending SQL migrations against the shared client).
export { runMigrations } from "./migrator";

// Typed auth repository (storage layer for accounts, users, sessions).
export * as authRepo from "./repositories/auth";
export type {
  Account,
  NewAccount,
  User,
  NewUser,
  Session,
  NewSession,
} from "./schema/auth";
export type {
  SessionContext,
  CreateAccountWithUserResult,
} from "./repositories/auth";

// Typed monitors repository (account-scoped storage layer for monitors).
export * as monitorsRepo from "./repositories/monitors";
export type { Monitor, NewMonitor } from "./schema/monitors";
export type {
  CreateMonitorInput,
  UpdateMonitorInput,
} from "./repositories/monitors";
