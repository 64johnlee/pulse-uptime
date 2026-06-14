import net from "node:net";
import type { Monitor } from "@pulse/db/schema";
import { EgressBlockedError, assertPublicHost, logEgressBlock } from "./egress";
import type { ProbeResult } from "./types";

/**
 * Probe a raw TCP endpoint (`target` is "host:port"). "up" means the connection
 * was established within the timeout; "down" means it timed out, was refused, or
 * the host could not be resolved. We close the socket immediately after connect
 * — for a port check, reachability is the signal, not the protocol on top.
 *
 * The host is resolved and validated through the egress guard first, and we
 * connect to the validated IP literal so the connection can't be re-pointed at
 * an internal address between resolution and connect (SSRF / DNS rebinding).
 */
export async function runTcpCheck(monitor: Monitor): Promise<ProbeResult> {
  const parsed = parseHostPort(monitor.target);
  if (!parsed) {
    return {
      status: "down",
      responseTimeMs: null,
      statusCode: null,
      error: `invalid tcp target "${monitor.target}" (expected host:port)`,
    };
  }

  const { host, port } = parsed;

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
    socket.connect(port, address);
  });
}

/** Split "host:port" into host + port. Handles IPv4, hostnames, and bracketed
 * IPv6 literals (`[2606:4700::1111]:443`) — the brackets are stripped so the
 * egress classifier sees a bare address. Returns null on a malformed target. */
function parseHostPort(target: string): { host: string; port: number } | null {
  const idx = target.lastIndexOf(":");
  if (idx <= 0) return null;
  const port = Number(target.slice(idx + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  // Strip the IPv6 bracket notation if present (host is everything before the
  // last colon, e.g. "[::1]" → "::1").
  const host = target.slice(0, idx).replace(/^\[|\]$/g, "");
  if (host.length === 0) return null;
  return { host, port };
}
