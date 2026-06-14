import type { Metadata } from "next";
import { AuthForm } from "../AuthForm";
import { logInAction } from "../actions";
import { redirectIfAuthenticated } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Log in · Pulse",
};

export default async function LoginPage() {
  await redirectIfAuthenticated();
  return <AuthForm mode="login" action={logInAction} />;
}
