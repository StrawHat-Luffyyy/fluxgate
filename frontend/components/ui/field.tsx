"use client";

import {
  useEffect,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

/**
 * Moves focus to the first field in error, so a keyboard or screen reader user lands
 * on the problem. Pass the state set only on submit, never something that changes
 * while typing, or this would pull focus away mid-word.
 */
export function useFocusFirstInvalid(errors: object) {
  useEffect(() => {
    if (!Object.values(errors).some(Boolean)) return;
    document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);
}

const control =
  "block w-full rounded-md border bg-surface text-sm text-fg placeholder:text-fg-3 transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:-outline-offset-1";

const controlState = (error?: string) =>
  error ? "border-bad" : "border-line-strong hover:border-fg-3";

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string;
}

function FieldShell({
  id,
  label,
  hint,
  error,
  children,
}: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-bad">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-fg-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, { hint, error }: FieldProps) =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

export function TextField({
  label,
  hint,
  error,
  mono,
  className = "",
  ...props
}: FieldProps & { mono?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { label, hint, error })}
        className={`${control} ${controlState(error)} h-8 px-2.5 ${mono ? "font-mono text-xs" : ""} ${className}`}
        {...props}
      />
    </FieldShell>
  );
}

export function SelectField({
  label,
  hint,
  error,
  children,
  ...props
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { label, hint, error })}
        className={`${control} ${controlState(error)} h-8 px-2`}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
}

/** A compact select for table rows and filter bars. The label is for assistive tech. */
export function InlineSelect({
  label,
  className = "",
  children,
  ...props
}: { label: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      aria-label={label}
      className={`h-7 rounded-md border border-line-strong bg-surface px-1.5 text-xs text-fg transition-colors hover:border-fg-3 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

/** For errors that belong to the whole form rather than one input. */
export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
      {children}
    </p>
  );
}
