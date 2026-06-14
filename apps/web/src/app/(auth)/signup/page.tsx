import type { Metadata } from "next";
import { AuthForm } from "../AuthForm";
import { signUpAction } from "../actions";
import { redirectIfAuthenticated } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Sign up · Pulse",
};

export default async function SignupPage() {
  await redirectIfAuthenticated();
  return <AuthForm mode="signup" action={signUpAction} />;
}
