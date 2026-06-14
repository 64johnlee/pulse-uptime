import type { Monitor } from "@pulse/db/schema";
import { runHttpCheck } from "./http";
import { runPingCheck } from "./ping";
import { runTcpCheck } from "./tcp";
import type { ProbeResult } from "./types";

export type { ProbeResult } from "./types";
export { runHttpCheck } from "./http";
export { runPingCheck } from "./ping";
export { runTcpCheck } from "./tcp";

/**
 * Monitor types the worker can probe. All three persisted types are now
 * supported: `http`/`tcp` connect directly, and `ping` shells out to the OS
 * `ping` binary (no raw sockets — see ./ping.ts). The set is kept as the single
 * gate so an unknown future enum value is skipped rather than mishandled.
 */
export const SUPPORTED_TYPES: ReadonlySet<Monitor["type"]> = new Set([
  "http",
  "tcp",
  "ping",
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
    case "ping":
      return runPingCheck(monitor);
    default:
      return Promise.reject(
        new Error(`unsupported monitor type: ${monitor.type}`),
      );
  }
}
