import type { Metadata } from "next";
import { RoutesView } from "./routes-view";

export const metadata: Metadata = { title: "Routes" };

export default function RoutesPage() {
  return <RoutesView />;
}
