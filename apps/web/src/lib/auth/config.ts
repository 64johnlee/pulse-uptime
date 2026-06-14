/**
 * Auth configuration constants. Centralized so security-relevant tuning
 * (session lifetime, cookie flags, password hashing cost) lives in one place
 * for the CEO/security review flagged on JJC-5.
 */

/** Name of the opaque session cookie. `__Host-` prefix enforces Secure +
 * path=/ + no Domain, which browsers verify — a strong anti-fixation default.
 * Dropped to a plain name in development because `__Host-` requires HTTPS. */
export const SESSION_COOKIE_NAME =
  process.env.NODE_ENV === "production" ? "__Host-pulse_session" : "pulse_session";

/** Session lifetime. 30 days of inactivity-agnostic absolute expiry for v1;
 * sliding/refresh can be layered on later. */
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

/** Raw session token entropy (bytes) before base64url encoding. 32 bytes =
 * 256 bits, well beyond guessability. */
export const SESSION_TOKEN_BYTES = 32;

/**
 * scrypt cost parameters. N must be a power of two. 2^15 with r=8,p=1 lands in
 * the OWASP-acceptable range and runs in a few hundred ms on a typical server.
 * `maxmem` must exceed 128*N*r bytes (~33.5 MB here) or scrypt throws.
 */
export const SCRYPT_PARAMS = {
  N: 2 ** 15,
  r: 8,
  p: 1,
  keylen: 32,
  maxmem: 64 * 1024 * 1024,
} as const;

/** Password policy (validated at the boundary with zod). */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200; // bound work + avoid abuse

/** Cookie attributes shared by set/clear. */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
} as const;
