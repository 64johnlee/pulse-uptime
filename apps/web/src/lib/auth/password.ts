import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type BinaryLike,
  type ScryptOptions,
} from "node:crypto";
import { SCRYPT_PARAMS } from "./config";

/**
 * Password hashing using Node's built-in scrypt — a memory-hard KDF that is
 * an OWASP-recommended choice and requires no native dependency.
 *
 * Stored format (single self-describing string, so cost params can evolve
 * without a schema change):
 *
 *   scrypt$N$r$p$<saltB64>$<hashB64>
 *
 * Never store or log the raw password.
 */
/**
 * Promise wrapper around scrypt. Hand-rolled (rather than util.promisify) so the
 * options-bearing overload is typed correctly — promisify resolves to the
 * no-options signature.
 */
function scryptAsync(
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

const SALT_BYTES = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const { N, r, p, keylen, maxmem } = SCRYPT_PARAMS;
  const derived = (await scryptAsync(password.normalize("NFKC"), salt, keylen, {
    N,
    r,
    p,
    maxmem,
  })) as Buffer;
  return [
    "scrypt",
    N,
    r,
    p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Constant-time verification. Returns false for any malformed/legacy hash
 * rather than throwing, so a corrupt row can never crash the login path.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4] ?? "", "base64");
  const expected = Buffer.from(parts[5] ?? "", "base64");
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const derived = (await scryptAsync(
      password.normalize("NFKC"),
      salt,
      expected.length,
      { N, r, p, maxmem: SCRYPT_PARAMS.maxmem },
    )) as Buffer;
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * Whether a stored hash was produced with weaker parameters than the current
 * policy and should be transparently re-hashed after a successful login. Returns
 * false for anything unparseable (a malformed row never verifies, so there is
 * nothing to upgrade). The check is "below current" for N — never trigger a
 * downgrade — and "differs from current" for r/p.
 */
export function needsRehash(stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  return N < SCRYPT_PARAMS.N || r !== SCRYPT_PARAMS.r || p !== SCRYPT_PARAMS.p;
}
