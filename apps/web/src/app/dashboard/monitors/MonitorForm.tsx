"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  HTTP_METHODS,
  INTERVAL_PRESETS,
  DEFAULT_INTERVAL_SECONDS,
  DEFAULT_METHOD,
} from "@/lib/monitors/config";
import type { MonitorFormState } from "./actions";
import styles from "./monitors.module.css";

export interface MonitorFormValues {
  name: string;
  target: string;
  method: string;
  intervalSeconds: number;
  expectedStatusCode: number | null;
  enabled: boolean;
}

type Action = (
  state: MonitorFormState,
  formData: FormData,
) => Promise<MonitorFormState>;

interface MonitorFormProps {
  action: Action;
  submitLabel: string;
  pendingLabel: string;
  defaults?: MonitorFormValues;
}

const EMPTY: MonitorFormValues = {
  name: "",
  target: "",
  method: DEFAULT_METHOD,
  intervalSeconds: DEFAULT_INTERVAL_SECONDS,
  expectedStatusCode: null,
  enabled: true,
};

export function MonitorForm({
  action,
  submitLabel,
  pendingLabel,
  defaults = EMPTY,
}: MonitorFormProps) {
  const [state, formAction, isPending] = useActionState<
    MonitorFormState,
    FormData
  >(action, {});

  // After a failed submit, echo back what the user typed; otherwise seed from
  // the row being edited (or empty for create).
  const v = state.values;
  const initial = {
    name: v?.name ?? defaults.name,
    target: v?.target ?? defaults.target,
    method: v?.method ?? defaults.method,
    intervalSeconds: v
      ? Number(v.intervalSeconds)
      : defaults.intervalSeconds,
    expectedStatusCode: v
      ? v.expectedStatusCode
      : defaults.expectedStatusCode === null
        ? ""
        : String(defaults.expectedStatusCode),
    enabled: v ? v.enabled : defaults.enabled,
  };
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form className={styles.form} action={formAction} noValidate>
      {state.error ? (
        <p className={styles.error} role="alert">
          <span aria-hidden="true">⚠</span>
          {state.error}
        </p>
      ) : null}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="name">
          Name
        </label>
        <input
          className={styles.input}
          id="name"
          name="name"
          type="text"
          required
          defaultValue={initial.name}
          placeholder="API health"
        />
        {fieldErrors.name ? (
          <span className={styles.fieldError}>{fieldErrors.name}</span>
        ) : null}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="target">
          URL
        </label>
        <input
          className={styles.input}
          id="target"
          name="target"
          type="url"
          inputMode="url"
          required
          defaultValue={initial.target}
          placeholder="https://api.example.com/health"
        />
        {fieldErrors.target ? (
          <span className={styles.fieldError}>{fieldErrors.target}</span>
        ) : null}
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="method">
            Method
          </label>
          <select
            className={styles.input}
            id="method"
            name="method"
            defaultValue={initial.method}
          >
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="intervalSeconds">
            Check interval
          </label>
          <select
            className={styles.input}
            id="intervalSeconds"
            name="intervalSeconds"
            defaultValue={String(initial.intervalSeconds)}
          >
            {INTERVAL_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>
          {fieldErrors.intervalSeconds ? (
            <span className={styles.fieldError}>
              {fieldErrors.intervalSeconds}
            </span>
          ) : null}
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="expectedStatusCode">
          Expected status <span className={styles.optional}>(optional)</span>
        </label>
        <input
          className={styles.input}
          id="expectedStatusCode"
          name="expectedStatusCode"
          type="number"
          min={100}
          max={599}
          defaultValue={initial.expectedStatusCode}
          placeholder="Any 2xx"
        />
        <span className={styles.hint}>
          Leave blank to treat any 2xx response as healthy.
        </span>
        {fieldErrors.expectedStatusCode ? (
          <span className={styles.fieldError}>
            {fieldErrors.expectedStatusCode}
          </span>
        ) : null}
      </div>

      <label className={styles.checkboxField}>
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={initial.enabled}
        />
        <span>Start checking right away</span>
      </label>

      <div className={styles.actions}>
        <button className={styles.submit} type="submit" disabled={isPending}>
          {isPending ? pendingLabel : submitLabel}
        </button>
        <Link className={styles.cancel} href="/dashboard/monitors">
          Cancel
        </Link>
      </div>
    </form>
  );
}
