import type { Metadata } from "next";
import { Suspense } from "react";
import { OverviewView } from "./overview-view";

export const metadata: Metadata = { title: "Overview" };

export default function OverviewPage() {
  return (
    // The selected range lives in the URL, which needs a Suspense boundary to prerender.
    <Suspense>
      <OverviewView />
    </Suspense>
  );
}
