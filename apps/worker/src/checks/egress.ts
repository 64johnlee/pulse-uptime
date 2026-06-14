import dns from "node:dns";
import { promisify } from "node:util";
import ipaddr from "ipaddr.js";

/**
 * SSRF / egress hardening for the check runner.
 *
 * The worker fetches user-supplied targets, so without a guard a tenant could
 * point a monitor at our own infrastructure — the cloud metadata endpoint
 * (169.254.169.254), another tenant's internal service, or `localhost` — and
 * use Pulse as a confused-deputy SSRF proxy. We defend egress by resolving the
 * target's DNS and rejecting any address that is not a routable *public*
 * unicast address, unless the operator explicitly opts in.
 *
 * Self-hosters who genuinely want to monitor an internal network can set
 * `PULSE_ALLOW_PRIVATE_TARGETS=true` to disable the lock. The default is
 * locked. SECURITY-SENSITIVE — see AGENTS.md security policy; flagged for
 * review before public launch.
 */

const dnsLookup = promisify(dns.lookup);

/** True when private/internal targets must be blocked (the default). Read at
 * call time so config (and tests) can toggle it without reloading the module. */
export function isEgressLocked(): boolean {
  return process.env.PULSE_ALLOW_PRIVATE_TARGETS !== "true";
}

/** Raised when a target resolves to a non-public address and egress is locked.
 * Checkers translate this into a "down" result with a clear reason. */
export class EgressBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EgressBlockedError";
  }
}

/**
 * Classify a single IP literal. Returns a human-readable block reason, or
 * `null` when the address is a public unicast target that is safe to probe.
 *
 * Only `unicast` is allowed: that excludes loopback, RFC1918 private,
 * link-local (incl. the 169.254.169.254 metadata address), unique-local IPv6,
 * carrier-grade NAT, multicast, broadcast, and reserved space. IPv4-mapped
 * IPv6 (`::ffff:10.0.0.1`) is unwrapped first so a private v4 can't be
 * smuggled through an IPv6 literal.
 */
export function blockReason(ip: string): string | null {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    return `unparseable address "${ip}"`;
  }

  if (addr.kind() === "ipv6") {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) {
      addr = v6.toIPv4Address();
    }
  }

  const range = addr.range();
  return range === "unicast"
    ? null
    : `${range} address (${ip}) is not a public target`;
}

/**
 * Resolve `host` to all of its addresses and assert every one is a public
 * target. Rejects if *any* resolved address is non-public: an attacker can
 * otherwise return one public and one internal record and race which the
 * client connects to. Returns the validated address list (handy for callers
 * that want to connect to a pinned IP). When egress is unlocked, this still
 * resolves (so a bogus host fails fast) but performs no blocking.
 */
export async function assertPublicHost(host: string): Promise<string[]> {
  const addresses = ipaddr.isValid(host) ? [host] : await resolveAll(host);

  if (isEgressLocked()) {
    for (const ip of addresses) {
      const reason = blockReason(ip);
      if (reason) throw new EgressBlockedError(reason);
    }
  }

  return addresses;
}

async function resolveAll(host: string): Promise<string[]> {
  let records: { address: string }[];
  try {
    records = await dnsLookup(host, { all: true });
  } catch {
    throw new EgressBlockedError(`could not resolve host "${host}"`);
  }
  if (records.length === 0) {
    throw new EgressBlockedError(`no addresses for host "${host}"`);
  }
  return records.map((r) => r.address);
}

type LookupAddress = { address: string; family: number };

/**
 * A `dns.lookup`-compatible function for an undici `Agent`'s `connect` option.
 * It resolves the host and rejects the connection if *any* resolved address is
 * non-public, then passes the result through to undici in exactly the shape it
 * asked for (single vs. `all`). Running the guard at connect time (rather than
 * only pre-flight) closes the DNS-rebinding window for hostnames, since undici
 * re-runs lookup per connection. Note it only fires when a DNS lookup happens:
 * a *literal* IP host skips lookup, so callers must also pre-validate literals
 * (the http checker does this for the initial target and every redirect hop).
 */
export function guardedLookup(
  hostname: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callback: (err: NodeJS.ErrnoException | null, ...rest: any[]) => void,
): void {
  // Pass options straight through so undici's requested family/hints/all shape
  // is honored; we only intercept to validate.
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) {
      callback(err);
      return;
    }
    const list: LookupAddress[] = Array.isArray(address)
      ? (address as LookupAddress[])
      : [{ address: address as string, family: family as number }];

    if (isEgressLocked()) {
      for (const a of list) {
        const reason = blockReason(a.address);
        if (reason) {
          callback(new EgressBlockedError(reason));
          return;
        }
      }
    }
    callback(null, address, family);
  });
}

/** Walk an error's `cause` chain and return the egress block reason, if any.
 * `fetch` wraps the lookup rejection, so the real reason hides in `.cause`. */
export function egressBlockReason(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (current instanceof EgressBlockedError) return current.message;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}
