import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Vitest config for the web app. Tests run in a Node environment (the current
 * suites cover pure logic, no DOM), and the `@/*` path alias mirrors the
 * TypeScript `paths` mapping in tsconfig.json.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
