import type { Monitor } from "@pulse/db/schema";

/**
 * Build a fully-typed `Monitor` for unit tests, overriding only the fields a
 * given test cares about. The checkers read just a handful of columns, but
 * keeping the object complete avoids unsafe casts.
 */
export function makeMonitor(overrides: Partial<Monitor> = {}): Monitor {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: "00000000-0000-0000-0000-000000000001",
    accountId: "00000000-0000-0000-0000-0000000000aa",
    name: "Test Monitor",
    type: "http",
    target: "https://example.com",
    method: "GET",
    intervalSeconds: 60,
    timeoutMs: 5000,
    expectedStatusCode: null,
    enabled: true,
    status: "unknown",
    lastCheckedAt: null,
    nextCheckAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
