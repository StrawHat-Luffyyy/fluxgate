"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { ApiError } from "@/lib/api";
import { useThemeChoice } from "@/lib/theme";

/** A 401 anywhere means the session ended, so go to login and come back afterwards. */
const redirectOnExpiredSession = (err: unknown) => {
  if (!(err instanceof ApiError) || err.status !== 401) return;
  const { pathname, search } = window.location;
  if (pathname === "/login" || pathname === "/signup") return;
  window.location.assign(`/login?next=${encodeURIComponent(pathname + search)}`);
};

const makeClient = () =>
  new QueryClient({
    queryCache: new QueryCache({ onError: redirectOnExpiredSession }),
    mutationCache: new MutationCache({ onError: redirectOnExpiredSession }),
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        // A client error will fail the same way again; only retry the rest.
        retry: (count, err) =>
          count < 2 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
      },
    },
  });

export default function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeClient);
  const theme = useThemeChoice();
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster
        theme={theme}
        position="bottom-right"
        closeButton
        toastOptions={{
          style: {
            background: "var(--surface)",
            color: "var(--fg)",
            borderColor: "var(--line-strong)",
            fontFamily: "var(--font-sans)",
            fontSize: "0.8125rem",
          },
        }}
      />
    </QueryClientProvider>
  );
}
