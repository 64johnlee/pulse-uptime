// Server-only by construction: importing next/headers throws if this module is
// ever pulled into a client bundle, so no separate `server-only` dep is needed.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { SessionContext } from "@pulse/db";
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  SESSION_TTL_MS,
} from "./config";
import { resolveSession, revokeSession } from "./service";

/**
 * Server-only session glue: the bridge between HTTP cookies and the pure auth
 * service. Import this from server components, server actions, and route
 * handlers — never from client components.
 */

/** Read and validate the current request's session, or null if none. */
export async function getSession(): Promise<SessionContext | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return resolveSession(token);
}

/** Like getSession, but redirects unauthenticated callers to /login. */
export async function requireSession(): Promise<SessionContext> {
  const context = await getSession();
  if (!context) redirect("/login");
  return context;
}

/** If already authenticated, bounce away from login/signup. */
export async function redirectIfAuthenticated(to = "/dashboard"): Promise<void> {
  const context = await getSession();
  if (context) redirect(to);
}

/** Persist a freshly issued session token in the response cookie. */
export async function setSessionCookie(
  token: string,
  expiresAt: Date,
): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    ...SESSION_COOKIE_OPTIONS,
    expires: expiresAt,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

/** Revoke the current session server-side and clear the cookie. */
export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (token) await revokeSession(token);
  store.delete(SESSION_COOKIE_NAME);
}
