"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  checkAccountThrottle,
  clearAuthFailures,
  recordAuthFailure,
} from "@/lib/auth/account-throttle";
import { AuthError } from "@/lib/auth/errors";
import { rateLimit } from "@/lib/auth/rate-limit";
import { authenticate, signUp } from "@/lib/auth/service";
import { destroyCurrentSession, setSessionCookie } from "@/lib/auth/session";

/**
 * Auth server actions. Next.js server actions are same-origin POSTs with
 * built-in Origin validation, which provides CSRF protection for these
 * state-changing operations without a manual token.
 *
 * Actions return a typed FormState consumed by useActionState on the client to
 * render inline errors. A successful action ends in redirect(), which throws
 * to short-circuit — so the returned state only ever carries failures.
 */
export interface FormState {
  error?: string;
  values?: { email?: string; teamName?: string };
}

// Coarse anti-abuse limits (per process). See lib/auth/rate-limit.ts caveats.
const LOGIN_LIMIT = 10;
const SIGNUP_LIMIT = 5;
const WINDOW_MS = 15 * 60 * 1000;

async function clientKey(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export async function signUpAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const teamName = String(formData.get("teamName") ?? "");
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const values = { teamName, email };

  const ip = await clientKey();
  if (!rateLimit(`signup:${ip}`, SIGNUP_LIMIT, WINDOW_MS).ok) {
    return { error: "Too many attempts. Please try again later.", values };
  }

  try {
    const { token, expiresAt } = await signUp({ teamName, email, password });
    await setSessionCookie(token, expiresAt);
  } catch (err) {
    if (err instanceof AuthError) return { error: err.message, values };
    console.error("[auth] signup failed:", err);
    return { error: "Something went wrong. Please try again.", values };
  }
  redirect("/dashboard");
}

export async function logInAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const values = { email };

  const ip = await clientKey();
  if (!rateLimit(`login:${ip}`, LOGIN_LIMIT, WINDOW_MS).ok) {
    return { error: "Too many attempts. Please try again later.", values };
  }

  // Per-account backoff (F2): blocks credential-stuffing against one email even
  // when the attacker rotates source IPs. The IP limiter above can't see that.
  if (!checkAccountThrottle(email).ok) {
    return {
      error: "Too many failed attempts for this account. Please wait and try again.",
      values,
    };
  }

  try {
    const { token, expiresAt } = await authenticate({ email, password });
    clearAuthFailures(email);
    await setSessionCookie(token, expiresAt);
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.code === "invalid_credentials") recordAuthFailure(email);
      return { error: err.message, values };
    }
    console.error("[auth] login failed:", err);
    return { error: "Something went wrong. Please try again.", values };
  }
  redirect("/dashboard");
}

export async function logOutAction(): Promise<void> {
  await destroyCurrentSession();
  redirect("/login");
}
