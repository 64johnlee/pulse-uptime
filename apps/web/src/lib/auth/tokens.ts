import { createHash, randomBytes } from "node:crypto";
import { SESSION_TOKEN_BYTES } from "./config";

/**
 * Session token primitives.
 *
 * The raw token is a high-entropy random string handed to the client in an
 * HttpOnly cookie. Only its SHA-256 hash is persisted, so a database leak
 * cannot be replayed as a live session (the attacker would still need the raw
 * token from the cookie). SHA-256 is appropriate here because the input is
 * already 256 bits of uniform randomness — no slow KDF is needed.
 */
export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
