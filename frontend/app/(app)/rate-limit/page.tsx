import type { Metadata } from "next";
import { RateLimitView } from "./rate-limit-view";

export const metadata: Metadata = { title: "Rate limit" };

export default function RateLimitPage() {
  return <RateLimitView />;
}
