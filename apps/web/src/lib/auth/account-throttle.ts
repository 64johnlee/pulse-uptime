/**
 * Per-account login throttle (F2 — Broken Authentication hardening).
 *
 * The per-IP rate limiter (rate-limit.ts) is trivially bypassed by an attacker
 * rotating source IPs against a single victim email. This module complements it
 * by counting consecutive failed logins for a normalized email and applying
 * EXPONENTIAL BACKOFF once a small free-attempt budget is spent.
 *
 * Why backoff and not a hard lockout: a hard lockout lets anyone lock a victim
 * out by spamming bad passwords (account-DoS), and a "this account is locked"
 * signal is an account-enumeration oracle. Backoff raises the attacker's cost
 * without ever fully denying the legitimate owner — the delay simply grows.
 *
 * Caveat (same as rate-limit.ts): in-memory and per-process, so it does NOT
 * coordinate across instances. Swap the backing store for Redis before
 * horizontal scaling. Keyed purely by email — it is, by construction,
 * independent of source IP.
 */

/** Failed attempts allowed before backoff begins. */
const FREE_ATTEMPTS = 5;
/** First backoff step, doubled per subsequent failure. */
const BASE_DELAY_MS = 1_000;
/** Backoff ceiling, so the delay can't grow unbounded. */
const MAX_DELAY_MS = 15 * 60 * 1000;
/** Idle period after which an account's failure history decays to zero. */
const RESET_WINDOW_MS = 60 * 60 * 1000;

interface FailureState {
  failures: number;
  /** Epoch ms before which login is throttled (0 = not currently blocked). */
  blockedUntil: number;
  /** Epoch ms after which the record is considered stale and cleared. */
  resetAt: number;
}

const accounts = new Map<string, FailureState>();

export interface ThrottleResult {
  ok: boolean;
  retryAfterMs: number;
}

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Whether a login attempt for this email is currently allowed. Call before
 * verifying the password. A stale record (past its reset window) is dropped and
 * treated as a clean slate.
 */
export function checkAccountThrottle(
  email: string,
  now: number = Date.now(),
): ThrottleResult {
  const key = normalize(email);
  const state = accounts.get(key);
  if (!state) return { ok: true, retryAfterMs: 0 };
  if (now >= state.resetAt) {
    accounts.delete(key);
    return { ok: true, retryAfterMs: 0 };
  }
  if (now < state.blockedUntil) {
    return { ok: false, retryAfterMs: state.blockedUntil - now };
  }
  return { ok: true, retryAfterMs: 0 };
}

/**
 * Record a failed login for this email and arm the next backoff window. Call
 * after a password verification fails.
 */
export function recordAuthFailure(email: string, now: number = Date.now()): void {
  const key = normalize(email);
  const existing = accounts.get(key);
  // Decay a stale record before counting against it.
  const base =
    existing && now < existing.resetAt ? existing.failures : 0;
  const failures = base + 1;

  let blockedUntil = 0;
  if (failures > FREE_ATTEMPTS) {
    const step = failures - FREE_ATTEMPTS - 1;
    const delay = Math.min(BASE_DELAY_MS * 2 ** step, MAX_DELAY_MS);
    blockedUntil = now + delay;
  }

  accounts.set(key, {
    failures,
    blockedUntil,
    resetAt: now + RESET_WINDOW_MS,
  });
}

/** Clear an account's failure history. Call after a successful login. */
export function clearAuthFailures(email: string): void {
  accounts.delete(normalize(email));
}

/** Opportunistically evict stale records so the map can't grow unbounded. */
export function sweepAccountThrottle(now: number = Date.now()): void {
  for (const [key, state] of accounts) {
    if (now >= state.resetAt) accounts.delete(key);
  }
}
