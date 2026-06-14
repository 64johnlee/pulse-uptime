import { execFile } from "node:child_process";
import os from "node:os";
import type { Monitor } from "@pulse/db/schema";
import { EgressBlockedError, assertPublicHost, logEgressBlock } from "./egress";
import type { ProbeResult } from "./types";

/**
 * Probe a host with ICMP echo by shelling out to the system `ping` binary.
 *
 * We deliberately do NOT open raw ICMP sockets ourselves: that needs
 * CAP_NET_RAW / root, which we don't want the worker to hold. The OS `ping` is
 * setuid (or uses the unprivileged ICMP socket the kernel grants via
 * `ping_group_range`), so one echo is enough to measure reachability + RTT
 * without privileges. `target` is a hostname or IP.
 *
 * Security: the target is resolved and validated through the egress guard
 * first (SSRF — no pinging internal/metadata hosts unless explicitly allowed),
 * and we invoke the resolved *IP literal* via `execFile` with an argument
 * vector (never a shell), so there is no command-injection surface.
 */
export async function runPingCheck(monitor: Monitor): Promise<ProbeResult> {
  const host = monitor.target.trim();

  let address: string;
  try {
    const [validated] = await assertPublicHost(host);
    if (!validated) throw new Error(`could not resolve host "${host}"`);
    address = validated;
  } catch (err) {
    if (err instanceof EgressBlockedError) logEgressBlock(monitor.id, err.message);
    return {
      status: "down",
      responseTimeMs: null,
      statusCode: null,
      error:
        err instanceof EgressBlockedError
          ? `blocked: ${err.message}`
          : `could not resolve host "${host}"`,
    };
  }

  const args = pingArgs(address, monitor.timeoutMs);
  const start = performance.now();

  return new Promise((resolve) => {
    execFile(
      "ping",
      args,
      // Hard backstop in case ping ignores its own deadline flag.
      { timeout: monitor.timeoutMs + 2000, windowsHide: true },
      (err, stdout) => {
        if (err) {
          // Non-zero exit = no reply (down). `err.killed` means our backstop
          // fired, i.e. a timeout.
          const killed = (err as { killed?: boolean }).killed === true;
          resolve({
            status: "down",
            responseTimeMs: null,
            statusCode: null,
            error: killed
              ? `timeout after ${monitor.timeoutMs}ms`
              : "host unreachable",
          });
          return;
        }
        resolve({
          status: "up",
          responseTimeMs: parseRttMs(stdout) ?? Math.round(performance.now() - start),
          statusCode: null,
          error: null,
        });
      },
    );
  });
}

/** Build the `ping` argument vector for a single echo with a deadline.
 * Flag spelling differs by platform; the deploy target is Linux (iputils). */
function pingArgs(address: string, timeoutMs: number): string[] {
  const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
  switch (os.platform()) {
    case "darwin":
      // BSD ping: -t = total timeout (s), -c = count, -n = numeric output.
      return ["-n", "-c", "1", "-t", String(timeoutSec), address];
    case "win32":
      // Windows ping: -n = count, -w = per-reply timeout (ms).
      return ["-n", "1", "-w", String(timeoutMs), address];
    default:
      // Linux iputils: -w = overall deadline (s), -c = count, -n = numeric.
      return ["-n", "-c", "1", "-w", String(timeoutSec), address];
  }
}

/** Pull the round-trip time out of ping's output (`time=12.3 ms`). */
function parseRttMs(stdout: string): number | null {
  const match = stdout.match(/time[=<]\s*([\d.]+)\s*ms/i);
  if (!match) return null;
  return Math.round(Number(match[1]));
}
