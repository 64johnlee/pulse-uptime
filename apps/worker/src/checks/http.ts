import { Agent, fetch, type Response } from "undici";
import type { Monitor } from "@pulse/db/schema";
import {
  EgressBlockedError,
  assertPublicHost,
  egressBlockReason,
  guardedLookup,
} from "./egress";
import type { ProbeResult } from "./types";

const USER_AGENT = "PulseBot/1.0 (+https://pulse.dev)";

/** Redirects are followed manually so each hop is re-validated; cap the chain
 * so a redirect loop can't keep the worker probing forever. */
const MAX_REDIRECTS = 5;

/**
 * Dispatcher whose connect step resolves hostnames through the egress guard, so
 * a monitor pointed at an internal name that resolves to a private/link-local
 * address is refused at connect time. This also defeats DNS rebinding (undici
 * re-runs the lookup per connection). Note the connect guard only sees DNS
 * lookups: a *literal* IP target (`http://127.0.0.1`) skips lookup entirely, so
 * we additionally pre-validate every hop's host below. Shared across probes —
 * undici pools connections.
 */
const egressGuardedAgent = new Agent({ connect: { lookup: guardedLookup } });

/**
 * Probe an HTTP(S) target. The monitor is "up" when the response status matches
 * `expectedStatusCode` (if set) or is any 2xx otherwise. Latency is measured to
 * the response headers (time-to-first-byte); the body is discarded so we never
 * download large payloads. A timeout, DNS failure, refused connection, or an
 * SSRF-blocked target is a "down" result with a human-readable reason.
 */
export async function runHttpCheck(monitor: Monitor): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), monitor.timeoutMs);
  const start = performance.now();
  try {
    const res = await fetchWithValidatedRedirects(monitor, controller.signal);
    const responseTimeMs = Math.round(performance.now() - start);

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
    const blocked =
      err instanceof EgressBlockedError ? err.message : egressBlockReason(err);
    return {
      status: "down",
      responseTimeMs: null,
      statusCode: null,
      error: aborted
        ? `timeout after ${monitor.timeoutMs}ms`
        : blocked
          ? `blocked: ${blocked}`
          : describeError(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch `monitor.target`, following redirects manually so that every hop's
 * destination is validated through the egress guard before we connect to it.
 * `redirect: "manual"` is required: undici's automatic follow would connect to
 * a literal-IP `Location` (e.g. a public→`http://169.254.169.254` 302) without
 * a DNS lookup, bypassing the connect-time guard. Returns the first
 * non-redirect response; throws `EgressBlockedError` on a blocked hop or once
 * the redirect cap is exceeded.
 */
async function fetchWithValidatedRedirects(
  monitor: Monitor,
  signal: AbortSignal,
): Promise<Response> {
  let url = monitor.target;
  for (let hop = 0; ; hop += 1) {
    // Pre-flight check on the literal host (catches `http://127.0.0.1`, the
    // metadata IP, RFC1918 literals, …) and resolves+validates hostnames.
    await assertTargetPublic(url);

    const res = await fetch(url, {
      method: monitor.method,
      redirect: "manual",
      signal,
      headers: { "user-agent": USER_AGENT },
      dispatcher: egressGuardedAgent,
    });

    const location = res.headers.get("location");
    if (!isRedirect(res.status) || !location) {
      // Terminal response: release the socket instead of buffering the body.
      await res.body?.cancel().catch(() => undefined);
      return res;
    }

    await res.body?.cancel().catch(() => undefined);
    if (hop >= MAX_REDIRECTS) {
      throw new EgressBlockedError(`too many redirects (> ${MAX_REDIRECTS})`);
    }
    // Resolve relative redirects against the current URL.
    url = new URL(location, url).toString();
  }
}

/** Validate that a URL targets an http(s) host that resolves to a public
 * address. Throws `EgressBlockedError` for a non-http scheme or a blocked
 * host. IPv6 literals arrive bracketed from the URL parser — strip them so the
 * address classifier can parse them. */
async function assertTargetPublic(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new EgressBlockedError(`invalid url "${rawUrl}"`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new EgressBlockedError(`unsupported scheme "${parsed.protocol}"`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  await assertPublicHost(host);
}

/** 3xx statuses that carry a `Location` we would otherwise follow. */
function isRedirect(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
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
