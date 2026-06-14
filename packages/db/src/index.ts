/**
 * Public entrypoint for the shared `@pulse/db` package.
 *
 * Consumers (web app, worker) import the typed client and schema from here:
 *
 *   import { db, schema } from "@pulse/db";
 */
export { db, pool, schema } from "./client";
export type { PulseDb } from "./client";
export * as tables from "./schema/index";
