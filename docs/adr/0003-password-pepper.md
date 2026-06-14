# ADR 0003 — Password pepper (server-side HMAC): deferred

- **Status:** Accepted (defer)
- **Date:** 2026-06-15
- **Author:** Ferris (Founding Engineer)
- **Issue:** JJC-13 (finding F7, from the JJC-10 security review)

## Context

Passwords are stored as scrypt hashes (`apps/web/src/lib/auth/password.ts`),
with cost parameters at the OWASP-recommended band after JJC-13 F3 (N=2^16,
r=8, p=1) and transparent rehash-on-login.

A **pepper** is a secret, server-held key applied to the password *before* the
KDF — typically `scrypt(HMAC-SHA256(key, password))`. Unlike the per-row salt,
the pepper is **not** stored in the database. The goal: if the database alone
leaks (SQL injection, stolen backup, misconfigured snapshot) but the secret
store does not, the stolen hashes are uncrackable because the attacker is
missing the key. To support rotation, the key is versioned and the version is
recorded alongside the hash.

## Decision

**Defer the pepper.** We will not add server-side HMAC peppering in this pass.

Reasons:

1. **No qualifying secret store yet.** A pepper is only as strong as the
   separation between the DB and the key. Today there is no dedicated secret
   manager (KMS / Vault / cloud secret store) provisioned for the app; a pepper
   loaded from the same environment that ships the DB credentials buys little
   real isolation and adds operational risk (lose the key → lock every user
   out). The hosting/secret-store decision is still pending CEO sign-off
   (see ADR 0002).
2. **Cost vs. benefit at this stage.** scrypt at the current cost already makes
   offline cracking expensive. The pepper's marginal benefit applies only to
   the specific "DB-only leak, secret store intact" scenario, which presumes
   infrastructure we don't have yet.
3. **It is reversible and additive.** Peppering can be introduced later with the
   same transparent-upgrade mechanism already built for scrypt params: on next
   successful login, re-hash with the pepper and a version tag. No migration of
   existing rows is required up front.

## Revisit when

Adopt a pepper when **any** of these becomes true:

- A compliance/contractual driver appears (SOC 2, customer security review,
  regulated data).
- A real secret manager is provisioned with isolation from the database,
  giving the pepper meaningful threat-model value.
- We migrate the KDF (e.g. to argon2id), which is the natural moment to fold in
  HMAC peppering and a `key_version` column together.

## Consequences

- Password storage relies on scrypt cost + per-row salt + rehash-on-login as
  the defense in depth for now.
- When revisited, plan for: a versioned key in the secret manager, a
  `password_key_version` column, HMAC-before-KDF in `password.ts`, and
  transparent rehash-on-login keyed on both scrypt params **and** key version.
