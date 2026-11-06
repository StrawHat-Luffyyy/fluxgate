import type { ReactNode } from "react";
import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <Logo className="text-lg" />
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6">{children}</div>
    </main>
  );
}
