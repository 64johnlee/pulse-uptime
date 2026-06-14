import net from "node:net";
import type { Monitor } from "@pulse/db/schema";
import type { ProbeResult } from "./types";

/**
 * Probe a raw TCP endpoint (`target` is "host:port"). "up" means the connection
 * was established within the timeout; "down" means it timed out, was refused, or
 * the host could not be resolved. We close the socket immediately after connect
 * — for a port check, reachability is the signal, not the protocol on top.
 */
export function runTcpCheck(monitor: Monitor): Promise<ProbeResult> {
  const parsed = parseHostPort(monitor.target);
  if (!parsed) {
    return Promise.resolve({
      status: "down",
      responseTimeMs: null,
      statusCode: null,
      error: `invalid tcp target "${monitor.target}" (expected host:port)`,
    });
  }

  const { host, port } = parsed;
  const start = performance.now();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (result: ProbeResult): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(monitor.timeoutMs);
    socket.once("connect", () =>
      finish({
        status: "up",
        responseTimeMs: Math.round(performance.now() - start),
        statusCode: null,
        error: null,
      }),
    );
    socket.once("timeout", () =>
      finish({
        status: "down",
        responseTimeMs: null,
        statusCode: null,
        error: `connection timeout after ${monitor.timeoutMs}ms`,
      }),
    );
    socket.once("error", (err: NodeJS.ErrnoException) =>
      finish({
        status: "down",
        responseTimeMs: null,
        statusCode: null,
        error: err.code ?? err.message,
      }),
    );
    socket.connect(port, host);
  });
}

/** Split "host:port" (IPv4/hostname). Returns null on a malformed target. */
function parseHostPort(target: string): { host: string; port: number } | null {
  const idx = target.lastIndexOf(":");
  if (idx <= 0) return null;
  const host = target.slice(0, idx);
  const port = Number(target.slice(idx + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port };
}
