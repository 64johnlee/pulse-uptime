/**
 * Public surface of the auth module. Server-only glue (`session.ts`) is
 * exported separately to keep `import "server-only"` out of code that only
 * needs the pure service/validation pieces.
 */
export { AuthError, type AuthErrorCode } from "./errors";
export {
  authenticate,
  signUp,
  resolveSession,
  revokeSession,
  type SessionIssue,
} from "./service";
export {
  getSession,
  requireSession,
  redirectIfAuthenticated,
  setSessionCookie,
  destroyCurrentSession,
} from "./session";
export { signUpSchema, logInSchema } from "./validation";
export type { SignUpInput, LogInInput } from "./validation";
