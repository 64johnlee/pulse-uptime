"use client";

import { useActionState } from "react";
import Link from "next/link";
import styles from "./auth.module.css";
import type { FormState } from "./actions";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

interface AuthFormProps {
  mode: "login" | "signup";
  action: Action;
}

const COPY = {
  signup: {
    eyebrow: "Get started",
    title: "Create your Pulse account",
    lede: "Spin up monitoring for your team in under a minute.",
    submit: "Create account",
    pending: "Creating account…",
    altText: "Already have an account?",
    altHref: "/login",
    altLink: "Log in",
  },
  login: {
    eyebrow: "Welcome back",
    title: "Log in to Pulse",
    lede: "Pick up where your dashboard left off.",
    submit: "Log in",
    pending: "Logging in…",
    altText: "New to Pulse?",
    altHref: "/signup",
    altLink: "Create an account",
  },
} as const;

export function AuthForm({ mode, action }: AuthFormProps) {
  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    action,
    {},
  );
  const copy = COPY[mode];

  return (
    <div className={styles.card}>
      <p className={styles.eyebrow}>{copy.eyebrow}</p>
      <h1 className={styles.title}>{copy.title}</h1>
      <p className={styles.lede}>{copy.lede}</p>

      <form className={styles.form} action={formAction} noValidate>
        {state.error ? (
          <p className={styles.error} role="alert">
            <span aria-hidden="true">⚠</span>
            {state.error}
          </p>
        ) : null}

        {mode === "signup" ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="teamName">
              Team name
            </label>
            <input
              className={styles.input}
              id="teamName"
              name="teamName"
              type="text"
              autoComplete="organization"
              required
              defaultValue={state.values?.teamName ?? ""}
              placeholder="Acme Inc."
            />
          </div>
        ) : null}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">
            Email
          </label>
          <input
            className={styles.input}
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={state.values?.email ?? ""}
            placeholder="you@example.com"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="password">
            Password
          </label>
          <input
            className={styles.input}
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
            minLength={mode === "signup" ? 8 : undefined}
            placeholder="••••••••"
          />
          {mode === "signup" ? (
            <span className={styles.hint}>At least 8 characters.</span>
          ) : null}
        </div>

        <button className={styles.submit} type="submit" disabled={isPending}>
          {isPending ? copy.pending : copy.submit}
        </button>
      </form>

      <p className={styles.alt}>
        {copy.altText} <Link href={copy.altHref}>{copy.altLink}</Link>
      </p>
    </div>
  );
}
