import type { Monitor } from "@pulse/db/schema";
import type { ProbeResult } from "./types";

const USER_AGENT = "PulseBot/1.0 (+https://pulse.dev)";

/**
 * Probe an HTTP(S) target. The monitor is "up" when the response status matches
 * `expectedStatusCode` (if set) or is any 2xx otherwise. Latency is measured to
 * the response headers (time-to-first-byte); the body is discarded so we never
 * download large payloads. A timeout, DNS failure, or refused connection is a
 * "down" result with a human-readable reason.
 */
export async function runHttpCheck(monitor: Monitor): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), monitor.timeoutMs);
  const start = performance.now();
  try {
    const res = await fetch(monitor.target, {
      method: monitor.method,
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT },
    });
    const responseTimeMs = Math.round(performance.now() - start);
    // We only need status + TTFB; release the socket instead of buffering body.
    await res.body?.cancel().catch(() => undefined);

    const healthy =
      monitor.expectedStatusCode != null
        ? res.status === monitor.expectedStatusCode
        : res.status >= 200 && res.status < 300;

    if (healthy) {
      return {
        status: "up",
        responseTimeMs,
        statusCode: res.status,
        error: null,
      };
    }
    return {
      status: "down",
      responseTimeMs,
      statusCode: res.status,
      error:
        monitor.expectedStatusCode != null
          ? `expected HTTP ${monitor.expectedStatusCode}, got ${res.status}`
          : `HTTP ${res.status}`,
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      status: "down",
      responseTimeMs: null,
      statusCode: null,
      error: aborted ? `timeout after ${monitor.timeoutMs}ms` : describeError(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Pull the most useful message out of a fetch failure (Node wraps the real
 * network error — ENOTFOUND, ECONNREFUSED, … — in `error.cause`). */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return "unknown error";
  const cause = (err as { cause?: unknown }).cause;
  if (cause && typeof cause === "object" && "code" in cause) {
    return String((cause as { code: unknown }).code);
  }
  if (cause instanceof Error && cause.message) return cause.message;
  return err.message;
}
