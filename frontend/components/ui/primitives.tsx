import { AlertCircle, CheckCircle2, CircleDashed, Lock, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { errorMessage } from "@/lib/api";
import { Button } from "./button";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: ReactNode;
  actions?: ReactNode;
}) {
  return (
    // The minimum height holds the action's space while the role loads, so nothing moves.
    <header className="flex min-h-14 flex-wrap items-start justify-between gap-x-6 gap-y-3 pb-5">
      <div className="max-w-[65ch] min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-0.5 text-sm text-fg-2">{description}</p>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className = "",
  flush = false,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Lets a table run to the panel's edges. */
  flush?: boolean;
}) {
  return (
    <section className={`min-w-0 rounded-lg border border-line bg-surface ${className}`}>
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{title}</h2>
            {description && <p className="text-xs text-fg-3">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {flush ? children : <div className="p-4">{children}</div>}
    </section>
  );
}

export type BadgeTone = "neutral" | "ok" | "warn" | "bad" | "info";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-neutral-soft text-fg-2",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-accent-soft text-accent",
};

const toneIcons: Partial<Record<BadgeTone, LucideIcon>> = {
  ok: CheckCircle2,
  warn: CircleDashed,
  bad: AlertCircle,
};

/** Status never relies on colour alone: every toned badge carries its text and an icon. */
export function Badge({
  tone = "neutral",
  icon = true,
  children,
}: {
  tone?: BadgeTone;
  icon?: boolean;
  children: ReactNode;
}) {
  const Icon = icon ? toneIcons[tone] : undefined;
  return (
    <span
      className={`inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-xs font-medium whitespace-nowrap ${tones[tone]}`}
    >
      {Icon && <Icon aria-hidden className="size-3" />}
      {children}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <Icon aria-hidden className="size-5 text-fg-3" />
      <h3 className="mt-1 text-sm font-semibold">{title}</h3>
      <p className="max-w-[52ch] text-sm text-fg-2">{children}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <AlertCircle aria-hidden className="size-5 text-bad" />
      <h3 className="mt-1 text-sm font-semibold">This could not be loaded</h3>
      <p className="max-w-[52ch] text-sm text-fg-2">{errorMessage(error)}</p>
      {onRetry && (
        <Button className="mt-2" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`fg-skeleton ${className}`} />;
}

export function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="divide-y divide-line">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-6 px-4 py-3.5">
          <Skeleton className="h-3.5 w-1/4" />
          <Skeleton className="h-3.5 w-1/3" />
          <Skeleton className="ml-auto h-3.5 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Says why there are no actions on this page, instead of leaving a viewer to wonder. */
export function ReadOnlyNote() {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-fg-3">
      <Lock aria-hidden className="size-3" />
      Read-only: an admin can change this
    </span>
  );
}
