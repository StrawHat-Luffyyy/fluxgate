"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormError, TextField, useFocusFirstInvalid } from "@/components/ui/field";
import { ErrorState, PageHeader, Panel, ReadOnlyNote, Skeleton } from "@/components/ui/primitives";
import { api, fieldErrorFrom } from "@/lib/api";
import { formatCount } from "@/lib/format";
import { queryKeys, useMe, useRateLimit } from "@/lib/queries";
import type { RateLimitConfig, RateLimitStrategy } from "@/lib/types";
import { validateNumber } from "@/lib/validate";

const STRATEGIES: { value: RateLimitStrategy; label: string; summary: string }[] = [
  {
    value: "token_bucket",
    label: "Token bucket",
    summary: "Allows bursts up to the capacity, then a steady refill rate.",
  },
  {
    value: "leaky_bucket",
    label: "Leaky bucket",
    summary:
      "A meter that fills with each request and drains at a constant rate. Over the capacity, requests are refused at once, never queued.",
  },
  {
    value: "sliding_window",
    label: "Sliding window",
    summary: "Counts requests in a moving window. A hard cap with no burst allowance.",
  },
];

const strategyLabel = (strategy: RateLimitStrategy) =>
  STRATEGIES.find((option) => option.value === strategy)?.label ?? strategy;

/** Restates the settings in plain terms. Computed only from what would be saved. */
const describe = ({ strategy, capacity, refillRate, windowMs }: RateLimitConfig) => {
  if (strategy === "sliding_window") {
    return `At most ${formatCount(capacity)} requests in any ${formatCount(windowMs / 1000)} second window.`;
  }
  if (strategy === "leaky_bucket") {
    return `The meter holds ${formatCount(capacity)} requests and drains at ${formatCount(refillRate)} per second. A request that would overflow it gets a 429 straight away.`;
  }
  return `Bursts of up to ${formatCount(capacity)} requests, refilling at ${formatCount(refillRate)} per second.`;
};

type Errors = { capacity?: string; refillRate?: string; windowMs?: string };

function RateLimitForm({ config, canEdit }: { config: RateLimitConfig; canEdit: boolean }) {
  const client = useQueryClient();
  const [strategy, setStrategy] = useState(config.strategy);
  const [capacity, setCapacity] = useState(String(config.capacity));
  const [refillRate, setRefillRate] = useState(String(config.refillRate));
  const [windowSeconds, setWindowSeconds] = useState(String(config.windowMs / 1000));
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string>();
  useFocusFirstInvalid(errors);

  const usesWindow = strategy === "sliding_window";

  const draft: RateLimitConfig = {
    strategy,
    capacity: Number(capacity),
    refillRate: Number(refillRate),
    windowMs: Math.round(Number(windowSeconds) * 1000),
  };
  const dirty =
    draft.strategy !== config.strategy ||
    draft.capacity !== config.capacity ||
    draft.refillRate !== config.refillRate ||
    draft.windowMs !== config.windowMs;

  const validate = (): Errors => ({
    capacity: validateNumber(capacity, {
      min: 1,
      max: 1_000_000,
      integer: true,
      label: "Capacity",
    }),
    refillRate: usesWindow
      ? undefined
      : validateNumber(refillRate, { min: 0.001, max: 1_000_000, label: "Rate" }),
    windowMs: usesWindow
      ? validateNumber(windowSeconds, { min: 1, max: 86_400, label: "Window" })
      : undefined,
  });

  const save = useMutation({
    mutationFn: (body: RateLimitConfig) =>
      api<{ config: RateLimitConfig }>("/admin/rate-limit", { method: "PUT", body }),
    onSuccess: ({ config: saved }) => {
      // Changing the cached value remounts this form with the saved settings.
      client.setQueryData(queryKeys.rateLimit, saved);
      toast.success("Rate limit saved");
    },
    onError: (err) => {
      const { field, message } = fieldErrorFrom(err, ["capacity", "refillRate", "windowMs"]);
      if (field) setErrors({ [field]: message });
      else setFormError(message);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    setFormError(undefined);
    if (found.capacity || found.refillRate || found.windowMs) return;
    // Fields the chosen strategy ignores keep their saved values: the API requires all four.
    save.mutate({
      ...draft,
      refillRate: usesWindow ? config.refillRate : draft.refillRate,
      windowMs: usesWindow ? draft.windowMs : config.windowMs,
    });
  };

  const reset = () => {
    setStrategy(config.strategy);
    setCapacity(String(config.capacity));
    setRefillRate(String(config.refillRate));
    setWindowSeconds(String(config.windowMs / 1000));
    setErrors({});
    setFormError(undefined);
  };

  const hasErrors = Object.values(validate()).some(Boolean);

  return (
    <form noValidate onSubmit={submit} className="grid items-start gap-3 lg:grid-cols-[1fr_20rem]">
      <Panel title="Policy" description="One limit, shared by every key and route in this workspace.">
        <div className="flex flex-col gap-5">
          <FormError>{formError}</FormError>
          <fieldset disabled={!canEdit}>
            <legend className="pb-1.5 text-sm font-medium">Strategy</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {STRATEGIES.map((option) => {
                const selected = strategy === option.value;
                return (
                  <label
                    key={option.value}
                    className={`flex flex-col gap-1 rounded-md border p-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                      selected ? "border-accent bg-accent-soft" : "border-line-strong"
                    } ${canEdit ? "cursor-pointer hover:border-fg-3" : "cursor-not-allowed"}`}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <input
                        type="radio"
                        name="strategy"
                        value={option.value}
                        checked={selected}
                        onChange={() => setStrategy(option.value)}
                        className="accent-[var(--accent)]"
                      />
                      {option.label}
                    </span>
                    <span className="text-xs text-fg-2">{option.summary}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Capacity"
              type="number"
              inputMode="numeric"
              min={1}
              max={1_000_000}
              disabled={!canEdit}
              value={capacity}
              error={errors.capacity}
              hint={
                usesWindow
                  ? "Requests allowed per window."
                  : strategy === "leaky_bucket"
                    ? "The most the meter can hold."
                    : "The largest burst allowed."
              }
              onChange={(event) => setCapacity(event.target.value)}
            />
            {usesWindow ? (
              <TextField
                label="Window (seconds)"
                type="number"
                inputMode="numeric"
                min={1}
                max={86_400}
                disabled={!canEdit}
                value={windowSeconds}
                error={errors.windowMs}
                hint="Between 1 second and 1 day."
                onChange={(event) => setWindowSeconds(event.target.value)}
              />
            ) : (
              <TextField
                label={strategy === "leaky_bucket" ? "Drain rate (per second)" : "Refill rate (per second)"}
                type="number"
                inputMode="decimal"
                step="any"
                min={0.001}
                max={1_000_000}
                disabled={!canEdit}
                value={refillRate}
                error={errors.refillRate}
                hint="Sustained requests per second."
                onChange={(event) => setRefillRate(event.target.value)}
              />
            )}
          </div>

          {canEdit && (
            <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
              <Button onClick={reset} disabled={!dirty || save.isPending}>
                Discard
              </Button>
              <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
                Save changes
              </Button>
            </div>
          )}
        </div>
      </Panel>

      <Panel title={dirty ? "If you save" : "In effect now"}>
        <div className="flex flex-col gap-3 text-sm">
          <p className="font-medium">{strategyLabel(strategy)}</p>
          <p className="text-fg-2" data-testid="rate-limit-summary">
            {hasErrors ? "Fix the highlighted values to see what this would do." : describe(draft)}
          </p>
          <p className="border-t border-line pt-3 text-xs text-fg-3">
            Over the limit, the gateway answers 429. A saved change reaches other gateway instances
            within 5 seconds, or 60 if cache invalidation fails.
          </p>
        </div>
      </Panel>
    </form>
  );
}

export function RateLimitView() {
  const { data: me } = useMe();
  const { data: config, error, isPending, refetch } = useRateLimit();
  return (
    <>
      <PageHeader
        title="Rate limit"
        description="How much traffic this workspace may send through the gateway."
        actions={me && me.role !== "admin" ? <ReadOnlyNote /> : undefined}
      />
      {isPending ? (
        <div className="grid items-start gap-3 lg:grid-cols-[1fr_20rem]">
          <Panel title="Policy" description="Loading">
            <Skeleton className="h-60 w-full" />
          </Panel>
          <Panel title="In effect now">
            <Skeleton className="h-28 w-full" />
          </Panel>
        </div>
      ) : error ? (
        <Panel flush>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Panel>
      ) : (
        <RateLimitForm
          key={JSON.stringify(config)}
          config={config}
          canEdit={me?.role === "admin"}
        />
      )}
    </>
  );
}
