"use client";

import { useMutation } from "@tanstack/react-query";
import {
  Activity,
  BellRing,
  Gauge,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Route,
  Sun,
  Users,
  Webhook,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Logo } from "@/components/logo";
import { IconButton } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api";
import { useHasOpenAnomaly, useHealth, useMe } from "@/lib/queries";
import { setTheme, useThemeChoice, type ThemeChoice } from "@/lib/theme";

const NAV: { heading?: string; items: { href: string; label: string; icon: LucideIcon }[] }[] = [
  { items: [{ href: "/overview", label: "Overview", icon: LayoutDashboard }] },
  {
    heading: "Traffic",
    items: [
      { href: "/routes", label: "Routes", icon: Route },
      { href: "/keys", label: "API keys", icon: KeyRound },
      { href: "/rate-limit", label: "Rate limit", icon: Gauge },
    ],
  },
  {
    heading: "Signals",
    items: [
      { href: "/anomalies", label: "Anomalies", icon: Activity },
      { href: "/webhooks", label: "Webhooks", icon: Webhook },
    ],
  },
  { heading: "Workspace", items: [{ href: "/team", label: "Team", icon: Users }] },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { data: hasOpen } = useHasOpenAnomaly();
  return (
    <nav aria-label="Main" className="flex flex-col gap-4">
      {NAV.map((group, index) => (
        <div key={group.heading ?? index}>
          {group.heading && (
            <div className="px-2 pb-1 text-xs font-medium text-fg-3">{group.heading}</div>
          )}
          <ul className="flex flex-col gap-px">
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`flex h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors ${
                      active
                        ? "bg-neutral-soft font-medium text-fg"
                        : "text-fg-2 hover:bg-hover hover:text-fg"
                    }`}
                  >
                    <Icon aria-hidden className="size-4" />
                    {label}
                    {href === "/anomalies" && hasOpen && (
                      <span className="ml-auto inline-flex items-center gap-1 text-xs text-bad">
                        <BellRing aria-hidden className="size-3" />
                        Open
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

const HEALTH_COPY = {
  ok: { label: "Gateway operational", dot: "bg-ok" },
  degraded: { label: "Gateway degraded", dot: "bg-warn" },
  unavailable: { label: "Gateway unavailable", dot: "bg-bad" },
} as const;

/** From /health/ready, so "operational" is a real answer about this gateway's dependencies. */
function HealthLine() {
  const { data, isError, isPending } = useHealth();
  if (isPending) return <Skeleton className="my-0.5 h-3.5 w-32" />;
  if (isError || !data) {
    return (
      <p className="flex items-center gap-2 text-xs text-fg-2">
        <span aria-hidden className="size-1.5 rounded-full bg-bad" />
        Gateway unreachable
      </p>
    );
  }
  const copy = HEALTH_COPY[data.status];
  const down = Object.entries(data.checks)
    .filter(([, state]) => state === "down")
    .map(([name]) => name);
  return (
    <div className="min-w-0 text-xs text-fg-2" data-testid="gateway-health">
      <p className="flex items-center gap-2 whitespace-nowrap">
        <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${copy.dot}`} />
        {copy.label}
      </p>
      {down.length > 0 && <p className="pl-3.5 text-fg-3">{down.join(", ")} down</p>}
    </div>
  );
}

const THEMES: { value: ThemeChoice; label: string; icon: LucideIcon }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

function ThemeSwitcher() {
  const choice = useThemeChoice();
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex shrink-0 rounded-md border border-line p-px">
      {THEMES.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={choice === value}
          aria-label={label}
          title={label}
          onClick={() => setTheme(value)}
          className={`inline-flex size-6 items-center justify-center rounded-sm transition-colors ${
            choice === value ? "bg-neutral-soft text-fg" : "text-fg-3 hover:text-fg"
          }`}
        >
          <Icon aria-hidden className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

function Identity() {
  const { data: me } = useMe();
  const logout = useMutation({
    mutationFn: () => api("/auth/logout", { method: "POST" }),
    onSuccess: () => window.location.assign("/login"),
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1" data-testid="identity">
        {me ? (
          <>
            <p className="truncate text-xs font-medium" title={me.email}>
              {me.email}
            </p>
            <p className="text-xs text-fg-3">{me.role === "admin" ? "Admin" : "Viewer"}</p>
          </>
        ) : (
          <>
            <Skeleton className="my-[3px] h-3 w-28" />
            <Skeleton className="my-[3px] h-3 w-12" />
          </>
        )}
      </div>
      <IconButton
        label="Sign out"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
      >
        <LogOut aria-hidden className="size-4" />
      </IconButton>
    </div>
  );
}

function WorkspaceName() {
  const { data: me } = useMe();
  if (!me) return <Skeleton className="mt-1 h-3.5 w-24" />;
  return (
    <p className="mt-0.5 flex min-h-5 items-center gap-1.5 text-xs text-fg-2">
      <span className="truncate" title={me.tenantName} data-testid="workspace-name">
        {me.tenantName}
      </span>
      <span className="shrink-0 text-fg-3">· {me.plan}</span>
    </p>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <div className="px-2 pb-4">
        <Logo />
        <WorkspaceName />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <NavLinks onNavigate={onNavigate} />
      </div>
      <div className="flex flex-col gap-3 border-t border-line px-2 pt-3">
        <HealthLine />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-fg-3">Theme</span>
          <ThemeSwitcher />
        </div>
        <Identity />
      </div>
    </>
  );
}

function MobileDrawer({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label="Navigation"
      className="fg-drawer m-0 h-dvh max-h-none w-64 max-w-[85vw] border-r border-line bg-sunken"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="flex h-full flex-col p-3">
        <IconButton label="Close navigation" onClick={onClose} className="absolute top-3 right-3">
          <X aria-hidden className="size-4" />
        </IconButton>
        <SidebarContent onNavigate={onClose} />
      </div>
    </dialog>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <div className="min-h-dvh lg:pl-60">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-1.5 focus:text-sm"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line bg-sunken p-3 lg:flex">
        <SidebarContent />
      </aside>

      <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-line bg-sunken px-3 lg:hidden">
        <IconButton label="Open navigation" onClick={() => setDrawerOpen(true)}>
          <Menu aria-hidden className="size-4" />
        </IconButton>
        <Logo className="text-sm" />
      </header>
      {drawerOpen && <MobileDrawer onClose={() => setDrawerOpen(false)} />}

      <main id="main" className="mx-auto max-w-[1200px] px-4 py-5 sm:px-6 lg:py-6">
        {children}
      </main>
    </div>
  );
}
