"use client";

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
      className={`relative h-[18px] w-8 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        checked ? "border-transparent bg-ok" : "border-line-strong bg-neutral-soft"
      }`}
    >
      <span
        aria-hidden
        className={`absolute top-1/2 size-3 -translate-y-1/2 rounded-full transition-all ${
          checked ? "left-[16px] bg-surface" : "left-[2px] bg-fg-3"
        }`}
      />
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
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
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
