/**
 * Derive a trusted client identifier for rate limiting.
 *
 * `x-forwarded-for` is a client-appendable list: the request originator can
 * only PREPEND values, so the left-most entry is attacker-controlled and must
 * never be trusted (JJC-11). The right-most entry is the one written by the
 * closest trusted proxy, and it is correct whether that proxy *appends* the
 * real client IP (`<spoofed>, <realIP>`) or *overwrites* the header entirely
 * (`<realIP>`) — which is why we trust it as the primary source.
 *
 * `x-real-ip` is only a fallback for proxies that set it but not XFF: it is a
 * single value the client could also send, so it is only safe when the trusted
 * proxy overwrites it. We never prefer it over the right-most XFF hop.
 *
 * NOTE: this assumes exactly one trusted proxy in front of the app (our Vercel
 * deployment). With additional trusted hops, the index into XFF must change.
 */
export function clientKeyFromHeaders(
  get: (name: string) => string | null | undefined,
): string {
  const forwarded = get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);
    const rightmost = hops[hops.length - 1];
    if (rightmost) {
      return normalizeClientId(rightmost);
    }
  }

  const realIp = get("x-real-ip");
  if (realIp && realIp.trim()) {
    return normalizeClientId(realIp);
  }

  return "unknown";
}

/**
 * Canonicalize so the same client maps to one bucket: trim and lowercase (IPv6
 * is case-insensitive hex, so `2001:DB8::1` and `2001:db8::1` are one client).
 */
function normalizeClientId(value: string): string {
  return value.trim().toLowerCase();
}
