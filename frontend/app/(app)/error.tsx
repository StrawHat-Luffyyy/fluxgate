"use client";

import { ErrorState } from "@/components/ui/primitives";

export default function PageError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorState error={error} onRetry={reset} />;
}
