import { NextResponse, type NextRequest } from "next/server";
import { buildContentSecurityPolicy } from "@/lib/security/headers";

/**
 * Attaches a per-request, nonce-based Content-Security-Policy (F6).
 *
 * The nonce is set on BOTH the forwarded request headers (so Next.js can read
 * it and stamp its own inline bootstrap scripts) and the response (so the
 * browser enforces it). The static headers (HSTS, nosniff, etc.) are applied in
 * next.config.ts and cover every route, including /api.
 */
export function middleware(request: NextRequest): NextResponse {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildContentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  /**
   * Run on document/page requests only. Static assets, image optimizer, and API
   * routes don't need a script CSP; excluding them keeps the nonce off cacheable
   * assets. The `missing` clause skips prefetches.
   */
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
