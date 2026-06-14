import type { NextConfig } from "next";
import { STATIC_SECURITY_HEADERS } from "./src/lib/security/headers";

/**
 * Baseline security headers applied to every response (HSTS, nosniff, framing,
 * referrer, permissions). The Content-Security-Policy is NOT here: it carries a
 * per-request nonce and is attached by middleware.ts instead (see F6). Keeping
 * the static set in lib/security/headers.ts gives both surfaces one source of
 * truth and makes the policy unit-testable.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @pulse/db ships as TypeScript source from the workspace; let Next compile it.
  transpilePackages: ["@pulse/db"],
  async headers() {
    return [{ source: "/:path*", headers: [...STATIC_SECURITY_HEADERS] }];
  },
};

export default nextConfig;
