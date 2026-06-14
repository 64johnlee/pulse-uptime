import type { Monitor } from "@pulse/db/schema";
import { runHttpCheck } from "./http";
import { runTcpCheck } from "./tcp";
import type { ProbeResult } from "./types";

export type { ProbeResult } from "./types";
export { runHttpCheck } from "./http";
export { runTcpCheck } from "./tcp";

/**
 * Monitor types the worker can currently probe. `ping` (ICMP) needs raw sockets
 * / elevated privileges, so it is deferred — the runner skips such monitors
 * rather than recording false failures. Track via a follow-up issue.
 */
export const SUPPORTED_TYPES: ReadonlySet<Monitor["type"]> = new Set([
  "http",
  "tcp",
]);

export function isSupported(monitor: Monitor): boolean {
  return SUPPORTED_TYPES.has(monitor.type);
}

/** Dispatch a monitor to the right checker. Callers should gate on
 * `isSupported` first; an unsupported type rejects rather than fabricating a
 * result. */
export function probe(monitor: Monitor): Promise<ProbeResult> {
  switch (monitor.type) {
    case "http":
      return runHttpCheck(monitor);
    case "tcp":
      return runTcpCheck(monitor);
    default:
      return Promise.reject(
        new Error(`unsupported monitor type: ${monitor.type}`),
      );
  }
}
