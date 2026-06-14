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
 * scrypt cost parameters. N must be a power of two. The previous N=2^15 was
 * below the current OWASP scrypt floor; we bump to 2^16 (r=8, p=1), which lands
 * in the recommended 2^16–2^17 band and runs in ~200–400ms on a typical server
 * — a defensible balance of attacker cost vs. per-login memory footprint.
 * `maxmem` must EXCEED 128*N*r bytes (= 64 MiB at N=2^16) or scrypt throws, so
 * we give it 128 MiB of headroom. Hashes carry their own N/r/p, so old-param
 * rows keep verifying and are transparently upgraded on next login
 * (see password.ts `needsRehash` + service.ts `authenticate`).
 */
export const SCRYPT_PARAMS = {
  N: 2 ** 16,
  r: 8,
  p: 1,
  keylen: 32,
  maxmem: 128 * 1024 * 1024,
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
