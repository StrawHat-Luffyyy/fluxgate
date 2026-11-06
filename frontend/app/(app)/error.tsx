"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/primitives";

export default function PageError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <ErrorState error={error} onRetry={unstable_retry} />;
}
