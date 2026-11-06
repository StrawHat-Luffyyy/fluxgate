"use client";

import type { KeyboardEvent } from "react";

/**
 * The ARIA radio group pattern: Tab enters at the selected option, arrows move and
 * select. Handled on the group, so it works for any buttons with role="radio" inside.
 */
export function moveRadioWithArrows<T extends string>(
  event: KeyboardEvent<HTMLElement>,
  values: readonly T[],
  value: T,
  onChange: (value: T) => void,
) {
  const step =
    event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
  if (step === 0) return;
  event.preventDefault();
  // From the focused radio, not the selected value, which can lag behind fast key
  // presses when the selection lives in the URL.
  const radios = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
  const from = radios.indexOf(event.target as HTMLElement);
  const current = from >= 0 ? from : values.indexOf(value);
  const next = (current + step + values.length) % values.length;
  onChange(values[next]);
  radios[next]?.focus();
}

export function Switch({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex h-6 w-8 shrink-0 items-center rounded-full disabled:cursor-not-allowed disabled:opacity-60"
    >
      {/* The button is the 24px target; this is only the track drawn inside it. */}
      <span
        aria-hidden
        className={`relative h-[18px] w-full rounded-full border transition-colors ${
          checked ? "border-transparent bg-ok" : "border-line-strong bg-neutral-soft"
        }`}
      >
        <span
          aria-hidden
          className={`absolute top-1/2 size-3 -translate-y-1/2 rounded-full transition-all ${
            checked ? "left-[16px] bg-surface" : "left-[2px] bg-fg-3"
          }`}
        />
      </span>
    </button>
  );
}

/** A connected single-choice control, for ranges and filters. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-md border border-line-strong bg-surface p-0.5"
      onKeyDown={(event) =>
        moveRadioWithArrows(
          event,
          options.map((option) => option.value),
          value,
          onChange,
        )
      }
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={`h-6 rounded-sm px-2.5 text-xs font-medium whitespace-nowrap transition-colors ${
              selected ? "bg-neutral-soft text-fg" : "text-fg-2 hover:text-fg"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
