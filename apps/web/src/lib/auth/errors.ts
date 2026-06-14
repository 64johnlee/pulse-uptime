/**
 * Typed auth errors. Messages are deliberately generic at the boundary so we
 * never reveal whether an email exists (prevents account enumeration).
 */
export type AuthErrorCode =
  | "email_taken"
  | "invalid_credentials"
  | "validation"
  | "rate_limited";

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}
