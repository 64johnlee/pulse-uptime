/**
 * Centralized web security headers (F6).
 *
 * Two kinds of headers:
 *  - STATIC headers (HSTS, nosniff, framing, referrer, permissions) are the
 *    same on every response and are attached in next.config.ts.
 *  - The Content-Security-Policy is PER-REQUEST because it carries a fresh
 *    nonce, so it is built here and attached by middleware.ts.
 *
 * Keeping both in one module means the policy has a single source of truth and
 * can be unit-tested without booting Next.
 */

interface SecurityHeader {
  key: string;
  value: string;
}

/** HSTS: 1 year, subdomains, preload-eligible. */
export const HSTS_VALUE = "max-age=31536000; includeSubDomains; preload";

/**
 * Headers identical on every response. CSP is intentionally NOT here — it needs
 * a per-request nonce (see buildContentSecurityPolicy + middleware).
 */
export const STATIC_SECURITY_HEADERS: SecurityHeader[] = [
  { key: "Strict-Transport-Security", value: HSTS_VALUE },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

/**
 * Build a nonce-based Content-Security-Policy. `script-src` no longer carries
 * `'unsafe-inline'`: only scripts bearing the per-request nonce execute, and
 * `'strict-dynamic'` lets those trusted scripts load their own dependencies
 * (Next.js propagates the nonce to its bootstrap scripts automatically once it
 * sees it on the request). `style-src` keeps `'unsafe-inline'` for now because
 * Next/React inject inline styles without a nonce hook; that is a much weaker
 * vector than inline script and is tracked for a later pass.
 *
 * In development Next uses eval for HMR/refresh, so `'unsafe-eval'` is added
 * only when not in production.
 */
export function buildContentSecurityPolicy(
  nonce: string,
  isDev: boolean = process.env.NODE_ENV !== "production",
): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(isDev ? ["'unsafe-eval'"] : []),
  ];

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
