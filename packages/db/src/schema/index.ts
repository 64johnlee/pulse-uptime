/**
 * Schema barrel. Every table module must be re-exported here so Drizzle Kit
 * (configured against this file) sees the full schema when generating
 * migrations, and so consumers can `import { schema } from "@pulse/db"`.
 */
export * from "./app-meta";
