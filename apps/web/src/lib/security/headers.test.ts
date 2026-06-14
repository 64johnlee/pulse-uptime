import { describe, it, expect } from "vitest";
import {
  HSTS_VALUE,
  STATIC_SECURITY_HEADERS,
  buildContentSecurityPolicy,
} from "./headers";

/**
 * F6 header assertions: HSTS is present and preload-eligible, and the CSP is
 * nonce-based with no `'unsafe-inline'` in script-src.
 */
describe("static security headers (F6)", () => {
  const byKey = (key: string) =>
    STATIC_SECURITY_HEADERS.find((h) => h.key === key)?.value;

  it("includes a one-year HSTS header with includeSubDomains + preload", () => {
    expect(byKey("Strict-Transport-Security")).toBe(HSTS_VALUE);
    expect(HSTS_VALUE).toContain("max-age=31536000");
    expect(HSTS_VALUE).toContain("includeSubDomains");
    expect(HSTS_VALUE).toContain("preload");
  });

  it("keeps the other baseline headers", () => {
    expect(byKey("X-Content-Type-Options")).toBe("nosniff");
    expect(byKey("X-Frame-Options")).toBe("DENY");
    expect(byKey("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(byKey("Permissions-Policy")).toContain("geolocation=()");
  });

  it("does not put CSP in the static set (it is per-request)", () => {
    expect(byKey("Content-Security-Policy")).toBeUndefined();
  });
});

describe("content security policy (F6)", () => {
  it("embeds the request nonce in script-src", () => {
    const csp = buildContentSecurityPolicy("abc123", false);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
  });

  it("drops 'unsafe-inline' from script-src in production", () => {
    const csp = buildContentSecurityPolicy("nonce", false);
    const scriptSrc = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("script-src"));
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("allows 'unsafe-eval' only in development (for HMR)", () => {
    const dev = buildContentSecurityPolicy("nonce", true);
    expect(dev).toContain("'unsafe-eval'");
  });

  it("locks down framing, objects, and base-uri", () => {
    const csp = buildContentSecurityPolicy("nonce", false);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("default-src 'self'");
  });
});
