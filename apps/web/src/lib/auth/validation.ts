import { z } from "zod";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "./config";

/**
 * Boundary validation for auth input. Email is normalized (trimmed +
 * lowercased) so uniqueness and lookups are case-insensitive.
 */
const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Enter your email address.")
  .max(320, "That email address is too long.")
  .email("Enter a valid email address.");

const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, "That password is too long.");

export const signUpSchema = z.object({
  // The team/account name. Defaults are applied by the caller when omitted.
  teamName: z
    .string()
    .trim()
    .min(1, "Enter a team name.")
    .max(120, "That team name is too long."),
  email,
  password,
});

export const logInSchema = z.object({
  email,
  // Login does not enforce the policy (it may have changed); just require a
  // non-empty, bounded string.
  password: z.string().min(1, "Enter your password.").max(PASSWORD_MAX_LENGTH),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type LogInInput = z.infer<typeof logInSchema>;
