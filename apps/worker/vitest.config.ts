import { defineConfig } from "vitest/config";

/**
 * Vitest config for the worker. Suites run in Node (probes use real sockets and
 * an in-process PGlite database), and integration tests that migrate a fresh DB
 * get a generous timeout.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    testTimeout: 20000,
  },
});
